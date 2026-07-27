# PRD: Character Snapshot History Query & Retention

## Status

Implemented (CB-91).

## Summary

Adds the read side of the progress tracker: endpoints for a user to query the snapshot history Phase 4 ([scheduled-character-snapshots.md](scheduled-character-snapshots.md)) has been accumulating for their tracked characters, plus a concrete retention policy so that history doesn't grow storage cost unbounded. This is Phase 5 of the umbrella [PRD.md](../../../PRD.md) roadmap. Durable storage itself (`character_snapshots`) already exists as of Phase 4 — nothing here changes the write path or its schema; this PRD is query endpoints and a payload-pruning job read against that existing table.

## Background / Context

Phase 4 writes one `character_snapshots` row per tracked character per poll: typed metrics (`level`, `experience`, `achievement_points`, `achievements_completed`, `average_item_level`, `equipped_item_level`, `last_login_at`) plus the three raw Battle.net payloads as `jsonb`. Nothing reads that table over HTTP today — verification has been `psql` and unit tests only.

Two things were explicitly deferred to this phase:

- **An HTTP-readable interface** to that history, for a future frontend to graph.
- **Retention/downsampling policy**, open since `PRD.md` and reiterated in Phase 4's Open Questions. Phase 4's own post-implementation notes give real numbers from the local dev database: ~121 KB of raw payload per row, with `achievements_payload` alone accounting for ~113 KB of that (one level-84 character, 618 achievements). At the active cadence (30 min) that's up to ~17,500 rows/character/year; at ~121 KB/row that's multiple GB per actively-played character per year, dominated almost entirely by the achievements payload rather than the profile or equipment payloads.

## Decisions made for this ticket

- **Ownership-scoped reads.** Unlike the Phase 3 live passthrough endpoints (which accept any realm/character-name pair with no ownership check, because the underlying Battle.net data is public), history endpoints only return snapshots where `character_snapshots.user_id` matches the caller. Historical data is something the app collected on a specific user's behalf, not a live armory lookup — it should not leak another user's snapshot history for a character they happen to also poll. Ownership is checked directly against `character_snapshots.user_id` (already present on every row); it does **not** require the character still be present in `tracked_characters`, so history survives untrack, consistent with Phase 4's decision that snapshot history has no FK to `tracked_characters`.
- **Response shape: raw (uncomputed) snapshot history, not server-side trend/delta computation.** Endpoints return the typed metric columns for each matching row, ordered chronologically; a future frontend computes its own deltas/graphs. This matches Phase 4's own framing ("the data a future frontend would graph") and keeps this ticket from having to design a trend/aggregation API before there's a real consumer to validate it against.
- **Raw JSONB payloads are never returned over HTTP.** History responses include only the typed metric columns (plus `capturedAt`/`payloadHash`) — never `profile_payload`/`achievements_payload`/`equipment_payload`. Those exist for future metric extraction, not for shipping over the wire; excluding them also means the retention decision below has zero effect on this endpoint's behavior.
- **A `.../history/latest` convenience endpoint**, alongside the paginated/date-ranged history list, for the common case of "what's this character's current level/ilvl right now" without a Battle.net round-trip.
- **Retention policy: prune raw payloads after a fixed window; never delete rows or typed metrics.** After `SNAPSHOT_RAW_PAYLOAD_RETENTION_DAYS` (default 90) days, a scheduled job nulls the three `jsonb` payload columns on snapshots older than the window. Row count and every typed metric column are kept forever — trend queries (this ticket's own endpoints) only ever read typed columns, so pruning is invisible to them. This directly targets the actual cost Phase 4 measured (payload size, dominated by achievements) rather than row count, and preserves future ability to extract a metric from *recent* history while accepting that old raw payloads are gone for good. No row deletion or downsampling of poll cadence — that would need a product decision about acceptable history resolution loss, which is out of scope here (see Open Questions).
- **Retention job runs on its own schedule, independent of the snapshot polling heartbeat.** New `app/services/SnapshotRetention.service.ts` (`pruneStalePayloads()`, pure enough to unit test the same way `CharacterSnapshot.service.ts` is tested) plus a scheduler following the exact `SnapshotScheduler.service.ts` pattern (in-flight guard, catch-and-log at the boundary, no-op when disabled). **Enabled by default** (`SNAPSHOT_RETENTION_JOB_ENABLED=true`) — unlike the polling job, this makes no external Battle.net calls and only trims local data, so there's no reason to require an opt-in the way the API-hitting polling job does. A daily heartbeat (`SNAPSHOT_RETENTION_JOB_HEARTBEAT_HOURS`, default 24) is more than enough resolution for a 90-day window.
- **A small migration is required after all** — see Post-implementation notes. The history endpoints need no schema change, but the retention job does: the three raw payload columns were created `NOT NULL` in Phase 4, and pruning them (setting to `NULL`) requires dropping that constraint first.
- **Pagination: `limit` + `from`/`to` date-range filtering, not cursor-based.** `limit` (default 100, max 1000), `from`/`to` as ISO-8601 timestamps filtering `captured_at`, ordered ascending by `captured_at` (chronological — natural for a graph). Simpler than cursor pagination and matches this repo's preference for the simplest thing that satisfies the acceptance criteria; can be revisited if a real frontend's access pattern demands it.

## Goals

- A logged-in user can retrieve their own tracked character's snapshot history — typed metrics only, date-range and limit filterable — via a new endpoint.
- A logged-in user can retrieve just the most recent snapshot for a character, without re-hitting Battle.net.
- History is scoped strictly to the requesting user; no cross-user data exposure.
- Storage cost from raw payloads is bounded going forward via an automatic, default-on pruning job, without losing any typed metric history.
- No change to the Phase 4 write path, its schema, or its polling behavior.

## Non-Goals

- Server-computed trends/deltas (e.g. "XP gained this week") — raw history only; a future frontend's job.
- Deduplicating unchanged consecutive snapshots (still deferred, per Phase 4's Non-Goals).
- Downsampling poll cadence or deleting old rows entirely — only raw payload columns are pruned; every row and typed metric is retained forever.
- Any change to `tracked_characters`, the polling heartbeat, or the adaptive interval logic.
- Any endpoint that reads or exposes raw Battle.net payloads (`profile_payload`/`achievements_payload`/`equipment_payload`) over HTTP — those stay write-only-then-pruned, accessible only via direct DB access.
- A public/third-party API-key auth scheme — history endpoints reuse the existing cookie/session `requireAuth`, same as every other endpoint in the repo today (the broader "will external frontends need a different auth scheme" question from `PRD.md`'s Open Questions remains open, not answered here).
- Multi-character/account-wide aggregate views (rolling up multiple characters into one response) — that's Phase 6.

## Proposed Solution

### 1. Routes

Nested under the existing `/api/profile/wow/character/:realmSlug/:characterName` prefix, both behind `requireAuth`:

- `GET /api/profile/wow/character/:realmSlug/:characterName/history` — query params `from`, `to` (optional ISO-8601), `limit` (optional, default 100, max 1000).
- `GET /api/profile/wow/character/:realmSlug/:characterName/history/latest`

### 2. Controller

New `app/controllers/CharacterHistory.controller.ts` (own file, following the precedent set by `TrackedCharacter.controller.ts` splitting out from `Profile.controller.ts` once a resource has enough of its own logic):

- Validates `realmSlug`/`characterName` (trim + lowercase, matching the existing normalization) and query params via a zod schema (`from`/`to` as optional `z.iso.datetime()`, `limit` as optional coerced int clamped `[1, 1000]`).
- Calls `CharacterSnapshotModel.listHistory({ userId: req.user!.id, realmSlug, characterName, from, to, limit })` / `findLatest({ userId, realmSlug, characterName })`.
- `history`: always `200` with an array (empty if nothing matches — no ownership ambiguity to signal, since an unknown/foreign character simply has no rows for this `user_id`).
- `history/latest`: `404 { error: 'No snapshot found' }` when there's no row.

### 3. Model additions

`app/models/CharacterSnapshot.model.ts` gains two read methods, selecting only typed columns (never the three `jsonb` payload columns):

```
listHistory({ userId, realmSlug, characterName, from?, to?, limit }): Promise<CharacterSnapshotSummary[]>
findLatest({ userId, realmSlug, characterName }): Promise<CharacterSnapshotSummary | undefined>
```

Where `CharacterSnapshotSummary` is `{ id, capturedAt, payloadHash, level, experience, achievementPoints, achievementsCompleted, averageItemLevel, equippedItemLevel, lastLoginAt }`. `listHistory` filters `userId`/`realmSlug`/`characterName` equality plus optional `capturedAt` range, orders ascending by `capturedAt`, caps at `limit`. `findLatest` is the same filter, ordered descending, `limit(1)`.

### 4. Retention job

- `app/config/aggregation.keys.ts` / `aggregation.conf.ts`: add `SNAPSHOT_RAW_PAYLOAD_RETENTION_DAYS` (default `90`), `SNAPSHOT_RETENTION_JOB_ENABLED` (default `true`), `SNAPSHOT_RETENTION_JOB_HEARTBEAT_HOURS` (default `24`).
- `app/models/CharacterSnapshot.model.ts`: add `pruneRawPayloadsOlderThan(cutoff: Date): Promise<number>` — `UPDATE character_snapshots SET profile_payload = NULL, achievements_payload = NULL, equipment_payload = NULL WHERE captured_at < cutoff AND profile_payload IS NOT NULL` (the `IS NOT NULL` guard makes repeated runs cheap no-ops on already-pruned rows), returning rows-affected count.
- `app/services/SnapshotRetention.service.ts`: `pruneStalePayloads(): Promise<{ prunedRows: number }>` — computes the cutoff from config, calls the model method, logs and returns a summary. Pure enough for direct unit testing, mirroring `CharacterSnapshot.service.ts`.
- `app/services/SnapshotRetentionScheduler.service.ts`: `startSnapshotRetentionScheduler()` — same shape as `SnapshotScheduler.service.ts` (no-op when disabled, in-flight guard, catch-and-log at the boundary, returns the `NodeJS.Timeout`/`undefined`).
- `server.ts`: start it alongside the existing snapshot scheduler.
- `scripts/run-snapshot-retention-job.ts` + `"job:prune-snapshots"` in `package.json`, mirroring `job:snapshot`'s one-shot CLI entrypoint.

### 5. Tests

- `tests/CharacterHistory.controller.test.ts`: mocks `CharacterSnapshot.model.js` — history returns filtered/paginated typed rows scoped to `req.user.id`; empty array for a character with no matching rows; `from`/`to`/`limit` are passed through and validated (`limit` clamps, invalid dates rejected with `400`); `latest` returns `404` when nothing matches.
- `tests/CharacterSnapshot.model.test.ts` additions (or manual `psql` verification, consistent with how Phase 3/4 handled model-level behavior mocked modules can't reach): `listHistory`/`findLatest` never select the three `jsonb` columns; `pruneRawPayloadsOlderThan` nulls only rows older than cutoff and leaves typed columns untouched.
- `tests/SnapshotRetention.service.test.ts`: cutoff computed correctly from config; summary shape.
- `tests/SnapshotRetentionScheduler.service.test.ts`: same three cases as `SnapshotScheduler.service.test.ts` (disabled starts no timer, in-flight tick skipped, a throw is caught and a later tick still runs), using Vitest fake timers.

### 6. Documentation

- README: new env vars, `npm run job:prune-snapshots`, the fact that (unlike the polling job) this one is on by default, and that pruning is irreversible (raw payloads older than the window are gone, typed metrics are not).
- `PRD.md`: mark Phase 5 done on completion; fix the stale Phase 3 label (already done as of this PRD — see below).

## Acceptance Criteria

- [x] `GET /api/profile/wow/character/:realmSlug/:characterName/history` returns only snapshots owned by the caller (`character_snapshots.user_id`), as an array of typed-metric summaries — never the raw `jsonb` payload columns.
- [x] `history` supports `from`/`to` (ISO-8601) and `limit` (default 100, max 1000, clamped not rejected above the max) query params; results are ordered ascending by `captured_at`.
- [x] `history` for a realm/character-name with no snapshots owned by the caller returns `200` with an empty array, not a `404`.
- [x] `GET .../history/latest` returns the single most recent snapshot (typed metrics only) for the caller's character, or `404` if none exists.
- [x] Both endpoints require auth (`requireAuth`) and never return another user's snapshot rows even for the same realm/character-name.
- [x] A scheduled job prunes (nulls) the three raw `jsonb` payload columns on snapshots older than `SNAPSHOT_RAW_PAYLOAD_RETENTION_DAYS` (default 90), leaving every typed metric column and the row itself intact.
- [x] The retention job is enabled by default and runs on its own heartbeat (`SNAPSHOT_RETENTION_JOB_HEARTBEAT_HOURS`, default 24), independent of the snapshot-polling heartbeat.
- [x] `npm run job:prune-snapshots` performs one retention pass against a live database and logs a `{ prunedRows }` summary.
- [x] Re-running the retention job against already-pruned rows is a cheap no-op (no unnecessary writes).
- [x] Migration drops `NOT NULL` on `character_snapshots.profile_payload`/`achievements_payload`/`equipment_payload` (needed for pruning); no other schema changes.
- [x] `npm run build`, `npx eslint <changed files>`, and `npm test` all pass.
- [x] README documents the new endpoints, the new env vars, `job:prune-snapshots`, and the retention job's on-by-default/irreversible-pruning behavior.

## Post-implementation notes

- **The PRD's "no new migration required" claim was wrong.** `character_snapshots.profile_payload`/`achievements_payload`/`equipment_payload` were created `NOT NULL` in Phase 4 (CB-90), and the retention job in this ticket needs to set them to `NULL`. Caught during implementation before any code shipped against the wrong assumption. Fix: `app/database/schema/index.ts` drops `.notNull()` on the three columns; migration `0006_military_cassandra_nova.sql` (`ALTER TABLE ... DROP NOT NULL` on all three) plus a hand-written `.down.sql` restoring `SET NOT NULL`, applied to the local dev database. The down migration will fail to reapply once any row has actually been pruned (a `NULL` value can't satisfy `SET NOT NULL`) — acceptable, consistent with how other irreversible-in-practice down migrations in this repo are treated.

## Open Questions

- **Whether 90 days is the right raw-payload retention window.** Chosen as a reasonable default balancing "recent enough to still extract an unanticipated metric from raw payloads" against storage cost; no usage data yet to tune it. Worth revisiting once real per-user storage numbers exist at a larger scale than the one-character dev database Phase 4 measured.
- **Whether poll-cadence downsampling (reducing row count for old idle-era history, not just payload size) is ever needed.** Explicitly out of scope here (see Non-Goals) — payload pruning addresses the cost Phase 4 actually measured (payload size, not row count), but if row count itself becomes a problem at scale this would need its own follow-up.
- **Public API auth scheme for third-party frontend consumption** — carried over unresolved from `PRD.md`'s Open Questions; this PRD reuses existing session auth and doesn't answer it.

## Dependencies / Follow-ups

- **Depends on:** [scheduled-character-snapshots.md](scheduled-character-snapshots.md) (`character_snapshots` table, its typed columns, and the `CharacterSnapshotModel`/config conventions this extends).
- **Blocks:** Phase 6 (multi-character/account-wide views), which will likely build on the same ownership-scoped read pattern established here.
- **Requires a `PRD.md` update on completion:** mark Phase 5 done. Also corrects, as part of this PRD's drafting, the already-stale Phase 3 label (was "next, planned"; `wow-character-tracking.md`/CB-89 has been implemented and merged since).
- **Follow-up candidate:** completed-quest counts (`/profile/wow/character/{realm}/{name}/quests/completed`), still out of scope per Phase 4's PRD — would add a fourth metric to both the write path and this ticket's typed-summary shape.
