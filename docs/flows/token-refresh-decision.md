# `getValidAccessToken` Decision Logic

The decision tree inside `BattleNetUserToken.service.ts` that every per-user Battle.net API call goes through before a request is made (see [wow-profile-request.md](wow-profile-request.md) for it in context). `forceRefreshAccessToken` follows the same refresh/persist/`needsReauth` logic but skips the expiry check — it's invoked directly after Blizzard has already returned a `401`.

```mermaid
flowchart TD
    Start([getValidAccessToken userId]) --> Find[BattleNetTokenModel.findByUserId]
    Find --> HasRecord{token record exists?}
    HasRecord -- no --> ThrowNoToken[/throw: no token stored/]
    HasRecord -- yes --> CheckExpiry{expiresAt − 60s ≤ now?}
    CheckExpiry -- no, still valid --> ReturnCached[return cached accessToken]
    CheckExpiry -- yes, expired/expiring --> HasRefresh{refresh token on file?}
    HasRefresh -- no --> SetReauth1[UserModel.setNeedsReauth true]
    SetReauth1 --> ThrowNoRefresh[/throw: must re-authenticate/]
    HasRefresh -- yes --> Decrypt[decrypt refresh token]
    Decrypt --> CallBNet[POST /token grant_type=refresh_token]
    CallBNet --> RefreshOk{Battle.net accepts?}
    RefreshOk -- yes --> Persist[encrypt new refresh token if returned<br/>BattleNetTokenModel.upsert]
    Persist --> ReturnNew[return new accessToken]
    RefreshOk -- no, 400 --> SetReauth2[UserModel.setNeedsReauth true]
    SetReauth2 --> ThrowRefreshFailed[/throw: refresh rejected/]

    style ThrowNoToken fill:#5c1a1a,color:#fff
    style ThrowNoRefresh fill:#5c1a1a,color:#fff
    style ThrowRefreshFailed fill:#5c1a1a,color:#fff
    style ReturnCached fill:#1a4d2e,color:#fff
    style ReturnNew fill:#1a4d2e,color:#fff
```

Downstream, controllers that catch a rejected Battle.net call (e.g. `ProfileController.wow`) re-check `UserModel.findById(userId).needsReauth` to decide between surfacing `401 { error: "needs_reauth" }` and letting an unexpected error propagate to the centralized error handler.
