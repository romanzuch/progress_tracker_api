# PRD: Account-Wide Character Overview

## Status

Implemented (CB-92).

## Summary

Adds a single new endpoint, `GET /api/profile/wow/characters`, that returns the latest stored snapshot for every character the caller currently tracks, in one response — an account-wide rollup rather than the single-character views every prior phase has offered. This is Phase 6 of the umbrella [PRD.md](../../../PRD.md) roadmap. No new storage, no new write path, no live Battle.net calls: this is a read-only fan-out of the existing "latest snapshot" query (introduced in Phase 5, [character-history-query.md](character-history-query.md)) across a user's full `tracked_characters` list instead of one character at a time.

## Background / Context

Every endpoint so far — live character detail (Phase 3), snapshot history, and "latest snapshot" (Phase 5) — is scoped to one `realmSlug`/`characterName` pair at a time. A user with several tracked characters (common case: alts across realms) currently has to make one request per character to build any kind of "where do all my characters stand right now" view. `PRD.md`'s Phase 6 entry names this directly: "endpoints that aggregate across all of a user's characters and realms, not just a single character at a time."

`TrackedCharacterModel.listByUser(userId)` (Phase 3) already returns a user's full tracked-character list. `CharacterSnapshotModel.findLatest(identity)` (Phase 5) already returns the latest typed-metric snapshot for one character. Phase 6 is the fan-out that combines them.

## Decisions made for this ticket

- **Scope: overview only, no computed aggregates.** The response is a per-character array — each tracked character's identity plus its latest snapshot (or `null` if never polled). No account-level rollup math (e.g. total achievement points across characters, highest item level, character count by realm). This keeps the ticket to a straightforward fan-out of an existing, already-tested read pattern rather than designing a new aggregation API against a still-unvalidated set of consumer needs. Computed aggregates are an explicit Open Question / follow-up candidate, not this ticket's job.
- **Endpoint: `GET /api/profile/wow/characters`.** Plural, sitting alongside the existing singular `GET /api/profile/wow/character/:realmSlug/:characterName` (Phase 3) and the CRUD `GET/POST/DELETE /api/profile/wow/tracked-characters` (Phase 3) routes — the plural noun signals "rollup across characters" without overloading either existing route family.
- **Untracked-but-not-yet-polled characters are included, with a `null` latest snapshot.** A character can be tracked (present in `tracked_characters`) before the scheduled job has ever polled it (Phase 4's adaptive cadence can leave a freshly-tracked character briefly unpolled). Omitting it from the overview would make "tracked but pending first poll" indistinguishable from "not tracked" without a second request against the tracked-characters list; a frontend building a dashboard needs to render a "pending" row for it instead. So every tracked character appears in the response, and `latestSnapshot` is `null` when no snapshot row exists yet.
- **No pagination.** Tracked-character lists are expected to stay small (a handful of alts, not hundreds); this matches the existing (unpaginated) `GET /wow/tracked-characters` list endpoint. Revisit only if real usage shows otherwise (see Open Questions).
- **No realm filtering on this endpoint.** Always returns the full tracked list for the caller; a frontend can filter client-side. Keeps the first version of this endpoint minimal — can be added as a query param later without a breaking change if it turns out to matter.
- **Read-only, no live Battle.net calls.** Like Phase 5's history endpoints, this reads only `character_snapshots` (via a new latest-per-character query) joined against `tracked_characters` — never hits the Battle.net Profile API directly. Consistent with keeping "live passthrough" (Phase 3) and "stored history" (Phase 5/6) as separate, clearly-bounded endpoint families.

## Goals

- A logged-in user can retrieve, in a single request, the latest known state (level, item level, achievement points, etc.) of every character they currently track.
- Characters tracked but not yet polled appear in the response distinctly from characters that aren't tracked at all.
- The endpoint is strictly scoped to the caller's own tracked characters and snapshot history — no cross-user data exposure, consistent with every other endpoint in this repo.
- No change to how characters are tracked, how snapshots are written, or any existing single-character endpoint's behavior or response shape.

## Non-Goals

- Server-computed account-level aggregates (total achievement points, highest item level across characters, per-realm counts, etc.) — raw per-character rollup only; a future frontend's job, same framing as Phase 5's "no server-computed trends" decision.
- Live Battle.net data — this reads only what the scheduled job has already persisted, never a live API call.
- Pagination or realm-based filtering — out of scope for this first version; revisit if usage demands it.
- Any change to `tracked_characters`, `character_snapshots`, the polling heartbeat, or the retention job introduced in Phase 5.
- Multi-character *history* (e.g. graphing several characters' progress over time on one chart) — this ticket is a current-state snapshot rollup only, not a history query; a multi-character history endpoint remains a possible future follow-up, not this ticket's scope.
- A public/third-party API-key auth scheme — reuses the existing cookie/session `requireAuth`, same as every other endpoint (the broader question from `PRD.md`'s Open Questions remains open, not answered here).

## Proposed Solution

### 1. Route

Added to `app/routes/Profile.routes.ts`, behind `requireAuth`, alongside the existing tracked-characters and per-character routes:

- `GET /api/profile/wow/characters`

### 2. Controller

New `app/controllers/CharacterOverview.controller.ts` (own file, following the precedent set by `CharacterHistory.controller.ts` splitting resource-specific logic out of `Profile.controller.ts`):

- Calls `TrackedCharacterModel.listByUser(req.user!.id)` to get the caller's tracked characters.
- Calls a new `CharacterSnapshotModel.findLatestForUser(req.user!.id)` to get the latest typed-metric snapshot per distinct `(realmSlug, characterName)` the caller owns, in one query.
- Merges the two in-memory by `(realmSlug, characterName)`: each tracked character becomes one response entry; `latestSnapshot` is the matching snapshot summary or `null` if none exists.
- Always `200`, even for a caller with zero tracked characters (empty array — same "no ambiguity to signal" reasoning Phase 5 used for its `history` endpoint).

Response shape:

```
[
  {
    id: string;              // tracked_characters.id
    realmSlug: string;
    characterName: string;
    latestSnapshot: CharacterSnapshotSummary | null;
  },
  ...
]
```

reusing the existing `CharacterSnapshotSummary` type (`capturedAt`, `payloadHash`, `level`, `experience`, `achievementPoints`, `achievementsCompleted`, `averageItemLevel`, `equippedItemLevel`, `lastLoginAt`) — never the raw `jsonb` payload columns, consistent with every other read endpoint.

### 3. Model addition

`app/models/CharacterSnapshot.model.ts` gains:

```
findLatestForUser(userId: string): Promise<(CharacterSnapshotSummary & { realmSlug: string; characterName: string })[]>
```

Implemented as a `DISTINCT ON (realm_slug, character_name)` query (Drizzle raw/partial SQL, following how this file already composes Drizzle query-builder calls) scoped to `userId`, ordered by `realm_slug, character_name, captured_at DESC` — one row per distinct character the user has ever tracked/snapshotted, each row the most recent by `capturedAt`. Selects only typed columns, same `summaryColumns` set already used by `listHistory`/`findLatest`.

### 4. Tests

- `tests/CharacterOverview.controller.test.ts`: mocks `TrackedCharacter.model.js` and `CharacterSnapshot.model.js` —
  - merges tracked characters with their latest snapshot correctly;
  - a tracked character with no snapshot rows gets `latestSnapshot: null`;
  - a caller with zero tracked characters gets `200` with an empty array;
  - both model calls are scoped to `req.user.id`.
- `tests/CharacterSnapshot.model.test.ts` additions (or manual `psql` verification, consistent with how this file's other model-level behavior has been verified): `findLatestForUser` returns exactly one row per distinct `(realmSlug, characterName)` for the given `userId`, the most recent by `capturedAt`; never selects the three `jsonb` payload columns; excludes other users' snapshots entirely.

### 5. Documentation

- README: document the new endpoint, its response shape, and the "tracked but not yet polled → `latestSnapshot: null`" behavior.
- `PRD.md`: mark Phase 6 done on completion.

## Acceptance Criteria

- [x] `GET /api/profile/wow/characters` returns, for the authenticated caller, one entry per tracked character (`id`, `realmSlug`, `characterName`) with its latest snapshot's typed metrics, or `null` if the character has never been polled.
- [x] The endpoint never returns another user's tracked characters or snapshot data.
- [x] A caller with zero tracked characters receives `200` with an empty array, not a `404`.
- [x] Response entries never include the raw `jsonb` payload columns (`profilePayload`/`achievementsPayload`/`equipmentPayload`).
- [x] The endpoint requires auth (`requireAuth`) and makes no live Battle.net API calls.
- [x] No change to `tracked_characters`, `character_snapshots`, the polling heartbeat, the retention job, or any existing endpoint's behavior.
- [x] `npm run build`, `npx eslint <changed files>`, and `npm test` all pass.
- [x] README documents the new endpoint and its response shape.

## Open Questions

- **Whether account-level computed aggregates (total achievement points, highest item level, per-realm breakdowns, etc.) will be wanted later.** Explicitly deferred by this ticket's scope decision (see Non-Goals) — worth revisiting once a real frontend consumer exists to validate what's actually useful to compute server-side vs. client-side.
- **Whether pagination or realm filtering will be needed** once real usage shows how many characters a typical user tracks — deferred as unnecessary complexity for a first version (see Non-Goals).
- **Whether a multi-character *history* endpoint (not just latest state) is ever needed**, e.g. to graph several characters' progress together — out of scope here; current per-character `history` endpoint (Phase 5) is unaffected either way.
- **Public API auth scheme for third-party frontend consumption** — carried over unresolved from `PRD.md`'s Open Questions; this PRD reuses existing session auth and doesn't answer it.

## Dependencies / Follow-ups

- **Depends on:** [wow-character-tracking.md](wow-character-tracking.md) (`TrackedCharacterModel`, Phase 3, CB-89) and [character-history-query.md](character-history-query.md) (`CharacterSnapshotModel`'s typed-summary read pattern, Phase 5, CB-91).
- **Requires a `PRD.md` update on completion:** mark Phase 6 done.
- **Follow-up candidate:** server-computed account-level aggregates, if a future frontend consumer needs them (see Open Questions).
- **Follow-up candidate:** multi-character history query, if graphing several characters together turns out to be a real need beyond per-character history.
