# Game Data API — App-Level Client Credentials Token

Covers `battleNetGameDataClient` (`app/http/BattleNetGameDataClient.ts`), the shared axios instance for Battle.net's **Game Data API** (static reference data — item/spell/talent lookups, etc., not tied to any one player). No route currently calls this client; it exists as sanctioned infrastructure for when game-data endpoints are added.

Unlike the per-user Profile API flow, this uses OAuth **Client Credentials** grant — a single app-wide token, cached in memory (module-level `cachedToken`) and shared across all requests/users, not stored per-user in the database.

```mermaid
sequenceDiagram
    autonumber
    participant Caller as any call site
    participant Client as battleNetGameDataClient<br/>(shared axios instance)
    participant AppToken as BattleNetAppToken.service
    participant BNet as Battle.net Game Data API

    Caller->>Client: client.get('/some/game-data/endpoint')

    Note over Client,AppToken: request interceptor
    Client->>AppToken: getAppToken()
    alt cached token valid (>60s from expiry)
        AppToken-->>Client: cached access_token
    else no cached token, or expiring/expired
        AppToken->>BNet: POST /token (grant_type=client_credentials)
        BNet-->>AppToken: access_token, expires_in
        AppToken->>AppToken: cache token + expiry
        AppToken-->>Client: access_token
    end

    Client->>BNet: GET /some/game-data/endpoint<br/>Bearer access_token

    alt 200 OK
        BNet-->>Client: data
        Client-->>Caller: data
    else 401 (token rejected)
        BNet-->>Client: 401
        Note over Client,AppToken: response interceptor (reactive, once per request)
        Client->>AppToken: refreshAppToken()
        AppToken->>BNet: POST /token (grant_type=client_credentials)
        BNet-->>AppToken: new access_token
        AppToken->>AppToken: replace cached token
        AppToken-->>Client: new access_token
        Client->>BNet: retry GET /some/game-data/endpoint (_retry=true)
        BNet-->>Client: data
        Client-->>Caller: data
    end
```
