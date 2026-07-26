# PRD: WoW Character Progress Tracker API

## Status

Living document — reflects current scope and roadmap as of 2026-07-26. Individual features are specced in their own PRDs under [plans/prds/](plans/prds/); this document is the umbrella product view.

## Summary

An API that authenticates World of Warcraft players via Battle.net, periodically fetches their character data (level, quests, items, equipment, etc.), and stores it over time so that progress can be queried and eventually visualized. This repository (`progress_tracker`) is the **API only** — no frontend/graphing UI is built or planned here; a separate, not-yet-started project will consume this API's endpoints to render graphs and dashboards.

## Problem / Vision

WoW players who track their own (or friends'/guildmates') character progress currently have to rely on manual inspection in-game or third-party sites that don't retain history in a way the player controls. This project gives a player a durable, queryable record of their own characters' progress over time, sourced directly from Blizzard's official Battle.net APIs, with the player's own Battle.net login as the sole gate to their data.

## Goals

- Let a player authenticate with their own Battle.net account and have the API fetch data on their behalf (Profile API), while also using app-level access for static reference data (Game Data API).
- Periodically and automatically snapshot each authenticated player's character data, without requiring the player to be actively using a frontend at the time.
- Persist that history durably so trends over time (not just current-moment snapshots) become queryable.
- Expose the stored + live data through a public API interface suitable for a future frontend to consume and graph.

## Non-Goals

- Building any frontend, dashboard, or graph-rendering UI — that is a separate, not-yet-started project and out of scope for this repository entirely.
- Any login mechanism other than Battle.net.
- Guild-level or roster-wide tracking (not a confirmed roadmap item — see Open Questions).
- Real-time/live data (this is periodic-snapshot based, not a live event feed).

## Roadmap

Phases below are ordered; each maps to (or will map to) its own Linear ticket and PRD under [plans/prds/](plans/prds/).

### Phase 0 — Foundational infrastructure (done)

- Postgres + Drizzle ORM + migration tooling. ([CB-87](plans/prds/postgres-setup.md))

### Phase 1 — Battle.net OAuth & login (done)

- Battle.net as the sole login mechanism; per-user Authorization Code flow (Profile API) and app-level Client Credentials flow (Game Data API); encrypted token storage; `needs_reauth` handling. ([CB-86](plans/prds/battlenet-oauth-integration.md))

### Phase 2 — WoW Profile Summary fetch (done)

- First real data-fetching endpoint: `GET /api/profile/wow`, a live authenticated proxy to Battle.net's WoW Account Profile Summary, region/locale aware. No persistence yet. ([CB-88](plans/prds/wow-profile-summary.md))

### Phase 3 — Character detail fetch & tracking selection (next, planned)

- Live (non-persisted) character-level detail: profile summary (level, XP, achievement points, spec, etc.), achievements, and equipment, via three new Battle.net Profile API endpoints scoped by realm + character name. Plus a persisted per-user "tracked characters" selection so the scheduled aggregation job (Phase 4) knows which characters to poll. ([wow-character-tracking.md](plans/prds/wow-character-tracking.md))

### Phase 4 — Scheduled aggregation job (done)

- A background job that polls every tracked character on an adaptive cadence, using the app-level client-credentials token rather than the Profile API's per-user grant, so it is permanently immune to `needs_reauth` becoming true for any user (see [battlenet-oauth-integration.md](plans/prds/battlenet-oauth-integration.md) Post-implementation note). Persists a snapshot row — typed metrics plus the raw Battle.net payloads — per poll to a new `character_snapshots` table. ([CB-90](plans/prds/scheduled-character-snapshots.md))

### Phase 5 — Historical progress storage & query (planned)

- Durable storage of per-character snapshots over time (level, quests, items, etc.), plus API endpoints to query history/trends for a character — the data a future frontend would graph.

### Phase 6 — Multi-character / account-wide views (planned)

- Endpoints that aggregate across all of a user's characters and realms, not just a single character at a time.

## Open Questions

- Should guild-level/roster-wide tracking ever be in scope? Not currently planned — flag if this changes.
- What's the retention/granularity policy for historical snapshots once Phase 4 lands (keep every poll forever vs. downsampling old data)?
- Will the public API interface (Phase 4/5) require its own API-key/auth scheme for third-party frontend consumption, or will it reuse the existing Battle.net-backed session model?
