# Authenticated WoW Profile Request (with token refresh)

Covers `GET /api/profile/wow`. See [wow-profile-summary.md](../../plans/prds/wow-profile-summary.md).

Two independent refresh paths exist and both are shown here:

1. **Proactive/lazy** — `getValidAccessToken`, called from a request interceptor on every call, refreshes if the stored token is within `EXPIRY_SAFETY_MARGIN_MS` (60s) of expiring.
2. **Reactive** — if Battle.net still returns `401` (e.g. token revoked early), a response interceptor calls `forceRefreshAccessToken` once and retries the original request (`_retry` flag prevents infinite loops).

If a refresh fails because Blizzard rejects the refresh token (`400`), or no refresh token is on file, `UserModel.needsReauth` is set to `true`; the controller checks this flag to return `401 { error: "needs_reauth" }` instead of a generic `500`.

```mermaid
sequenceDiagram
    autonumber
    actor Browser
    participant MW as requireAuth middleware
    participant Ctrl as ProfileController
    participant Client as BattleNetProfileClient<br/>(axios instance, per-request)
    participant TokenSvc as BattleNetUserToken.service
    participant TokenModel as BattleNetTokenModel
    participant UserModel
    participant BNet as Battle.net Profile API

    Browser->>MW: GET /api/profile/wow?locale=en_US<br/>Cookie: session=<jwt>
    alt no/invalid session cookie
        MW-->>Browser: 401 Not authenticated / Invalid or expired session
    else session valid
        MW->>MW: verifySession(jwt) → req.user.id
        MW->>Ctrl: next()
        Ctrl->>Ctrl: validate ?locale via zod

        Ctrl->>Client: createProfileClient(userId).get(/profile/user/wow)

        Note over Client,TokenSvc: request interceptor (proactive)
        Client->>TokenSvc: getValidAccessToken(userId)
        TokenSvc->>TokenModel: findByUserId(userId)
        TokenModel-->>TokenSvc: accessToken, expiresAt, encrypted refresh token
        alt token not expiring soon
            TokenSvc-->>Client: cached access_token
        else expiring/expired
            TokenSvc->>TokenSvc: decrypt refresh token
            TokenSvc->>BNet: POST /token (grant_type=refresh_token)
            alt refresh succeeds
                BNet-->>TokenSvc: new access_token, expires_in
                TokenSvc->>TokenModel: upsert(new token)
                TokenSvc-->>Client: new access_token
            else refresh fails (400) or no refresh token stored
                TokenSvc->>UserModel: setNeedsReauth(userId, true)
                TokenSvc-->>Client: throws
                Client-->>Ctrl: rejected promise
            end
        end

        Client->>BNet: GET /profile/user/wow?namespace&locale<br/>Bearer access_token

        alt 200 OK
            BNet-->>Client: profile data
            Client-->>Ctrl: data
            Ctrl-->>Browser: 200 profile JSON
        else 401 (token rejected by Blizzard)
            BNet-->>Client: 401
            Note over Client,TokenSvc: response interceptor (reactive, once per request)
            Client->>TokenSvc: forceRefreshAccessToken(userId)
            TokenSvc->>BNet: POST /token (grant_type=refresh_token)
            alt refresh succeeds
                BNet-->>TokenSvc: new access_token
                TokenSvc->>TokenModel: upsert(new token)
                TokenSvc-->>Client: new access_token
                Client->>BNet: retry GET /profile/user/wow (_retry=true)
                BNet-->>Client: 200 profile data
                Client-->>Ctrl: data
                Ctrl-->>Browser: 200 profile JSON
            else refresh fails
                TokenSvc->>UserModel: setNeedsReauth(userId, true)
                TokenSvc-->>Client: throws
                Client-->>Ctrl: rejected promise
                Ctrl->>UserModel: findById(userId)
                UserModel-->>Ctrl: user.needsReauth = true
                Ctrl-->>Browser: 401 { error: "needs_reauth" }
            end
        end
    end
```
