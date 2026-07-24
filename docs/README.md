# Docs

Diagrams of the API's request/data flows, kept alongside the code they describe. For product scope and roadmap see [PRD.md](../PRD.md); for per-feature specs see [plans/prds/](../plans/prds/).

- [architecture-overview.md](architecture-overview.md) — layering (routes → middleware → controllers → services/models → HTTP clients → Battle.net/Postgres)
- [flows/battlenet-login.md](flows/battlenet-login.md) — `GET /api/auth/battlenet` OAuth authorization-code login
- [flows/wow-profile-request.md](flows/wow-profile-request.md) — `GET /api/profile/wow`, including lazy and reactive token refresh
- [flows/token-refresh-decision.md](flows/token-refresh-decision.md) — `getValidAccessToken` refresh/`needsReauth` decision tree
- [flows/game-data-app-token.md](flows/game-data-app-token.md) — app-level client-credentials token for the (not-yet-used) Game Data client

Diagrams are Mermaid, rendered natively by GitHub. Update the relevant diagram alongside any change to auth, token handling, or routing — per [CLAUDE.md](../CLAUDE.md), keep living docs in sync with implementation rather than letting them go stale.
