# Battle.net Login (OAuth Authorization Code)

Covers `GET /api/auth/battlenet` → `GET /api/auth/battlenet/callback`. See [battlenet-oauth-integration.md](../../plans/prds/battlenet-oauth-integration.md) for the full spec.

- State is a random value stored in a short-lived, `httpOnly` cookie (`bnet_oauth_state`) and echoed back by Battle.net; the callback rejects the request if it's missing or doesn't match, preventing CSRF on the callback.
- The refresh token (if Battle.net returns one) is AES-256-GCM encrypted (`Crypto.util.ts`) before being persisted — it's never stored in plaintext.
- `upsertByBattlenetId` both creates new users and clears `needsReauth` on returning users who complete a fresh login.

```mermaid
sequenceDiagram
    autonumber
    actor Browser
    participant Auth as AuthController
    participant BNAuth as BattleNetAuth.service
    participant BNet as Battle.net OAuth
    participant UserModel
    participant TokenModel as BattleNetTokenModel
    participant Session as Session.service

    Browser->>Auth: GET /api/auth/battlenet
    Auth->>Auth: generate random state
    Auth-->>Browser: Set-Cookie bnet_oauth_state<br/>302 → Battle.net authorize URL
    Browser->>BNet: GET /authorize?client_id&redirect_uri&scope&state
    BNet-->>Browser: user approves
    BNet-->>Browser: 302 → /api/auth/battlenet/callback?code&state

    Browser->>Auth: GET /api/auth/battlenet/callback?code&state
    Auth->>Auth: compare state vs bnet_oauth_state cookie
    alt state missing or mismatched, or code missing
        Auth-->>Browser: 400 Invalid or missing OAuth state/code
    else state valid
        Auth->>BNAuth: exchangeCodeForToken(code)
        BNAuth->>BNet: POST /token (grant_type=authorization_code)
        BNet-->>BNAuth: access_token, refresh_token, expires_in
        BNAuth-->>Auth: token response

        Auth->>BNAuth: getUserInfo(access_token)
        BNAuth->>BNet: GET /userinfo (Bearer access_token)
        BNet-->>BNAuth: sub, battletag
        BNAuth-->>Auth: user info

        Auth->>UserModel: upsertByBattlenetId(battlenetId, battletag)
        UserModel-->>Auth: user (needsReauth reset to false)

        Auth->>Auth: encrypt(refresh_token)
        Auth->>TokenModel: upsert(userId, accessToken, expiresAt, encrypted refresh token)

        Auth->>Session: signSession(userId)
        Session-->>Auth: JWT session token
        Auth-->>Browser: Set-Cookie session=<jwt><br/>200 { battletag }
    end
```
