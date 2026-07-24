# Architecture Overview

Layering of the codebase per [CLAUDE.md](../CLAUDE.md)'s directory conventions, and how a request moves through it. `app/http/` clients are the only sanctioned way to call Battle.net — no other layer manages tokens or calls Battle.net directly.

```mermaid
flowchart LR
    subgraph Client
        Browser
    end

    subgraph Express["Express app"]
        Routes["app/routes<br/>Xxx.routes.ts"]
        MW["app/middleware<br/>requireAuth, errorHandler"]
        Controllers["app/controllers<br/>Xxx.controller.ts"]
    end

    subgraph Domain["Domain layer"]
        Services["app/services<br/>BattleNetAuth, BattleNetUserToken,<br/>BattleNetAppToken, Session"]
        Models["app/models<br/>User.model, BattleNetToken.model"]
    end

    subgraph External["Outbound HTTP"]
        HttpClients["app/http<br/>BattleNetProfileClient (per-user)<br/>BattleNetGameDataClient (app-level)"]
    end

    DB[(Postgres<br/>via Drizzle)]
    BNet[[Battle.net OAuth<br/>+ Profile/Game Data APIs]]

    Browser -->|HTTP request| Routes
    Routes --> MW
    MW --> Controllers
    Controllers --> HttpClients
    Controllers --> Models
    HttpClients --> Services
    Services --> Models
    Models --> DB
    HttpClients --> BNet
    Services --> BNet
```

## Flow docs

- [Battle.net login (OAuth authorization code)](flows/battlenet-login.md)
- [Authenticated WoW profile request, with token refresh](flows/wow-profile-request.md)
- [`getValidAccessToken` decision logic](flows/token-refresh-decision.md)
- [Game Data API app-level client credentials token](flows/game-data-app-token.md)
