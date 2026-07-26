# PRD: Scheduled Character Snapshot Aggregation

## Status

Implemented — see Post-implementation notes. Ticket: [CB-90](https://linear.app/romanzu/issue/CB-90/snapshot-tracked-characters-on-a-schedule).

## Summary

Adds the background job the project has been building toward: a scheduler that periodically polls every tracked character via Battle.net's Profile API and persists a durable snapshot row per character per poll. This is the first ticket in the project that writes fetched Battle.net data to the database — Phases 2 and 3 deliberately stayed live-only — and it is what turns the API from a request-time proxy into an actual progress tracker.

Polling cadence is **adaptive per character**: a character whose data is changing (i.e. someone is playing it) is polled every 30 minutes, while an unchanging character backs off toward a 6-hour floor. The job reads the `tracked_characters` selection added in Phase 3 ([wow-character-tracking.md](wow-character-tracking.md)) to know what to poll, and writes to a new `character_snapshots` table. Nothing reads that table over HTTP in this ticket; history and trend endpoints are Phase 5.

## Background / Context

### What exists

Phase 3 shipped three live character-detail endpoints (profile summary, achievements, equipment), all scoped by realm slug + lowercase character name, and a persisted per-user `tracked_characters` table. Both were built specifically so this phase would have (a) the fetch calls it needs and (b) a list of what to fetch. Neither persists any stat data.

### The constraint this phase inherits — and how it gets resolved

The OAuth PRD's post-implementation note ([battlenet-oauth-integration.md](battlenet-oauth-integration.md)) records that **Battle.net's Authorization Code flow issues no refresh token**. A user's stored access token is therefore only usable for roughly 24 hours after their last login, after which `users.needs_reauth` is set and per-user Profile API access stops until they log in again.

A background job built on per-user tokens would inherit this directly: it could only collect data for users who happened to log in within the last day, which largely defeats the purpose of "snapshot progress without the user being present." Phase 3's PRD explicitly deferred this problem to this ticket.

**The resolution is to poll with the app-level client-credentials token instead of per-user tokens.** The three character endpoints return public, armory-style data — the same data anyone can read without being the character's owner — unlike `/profile/user/wow`, which is account-scoped and genuinely requires the user's own token. Phase 3's PRD already noted this public-data property when it decided against ownership validation on `POST /tracked-characters`. The app token is obtained via Client Credentials, is cached in-process, and self-refreshes before expiry (`app/services/BattleNetAppToken.service.ts`), so it never goes stale the way user tokens do. A job built on it is permanently immune to `needs_reauth`.

**Verified by spike (2026-07-26).** Blizzard's documentation portal is JavaScript-rendered and could not confirm this during drafting, so it was tested directly against a live character: a client-credentials token with `namespace=profile-{region}` returns `200` for all three character endpoints (profile summary, achievements, equipment). The design below is therefore the real one, not a conditional branch.

Confirmed a second time with a raw `curl` against `https://eu.api.blizzard.com/profile/wow/character/dun-morogh/sixfootfour?namespace=profile-eu` using a token minted purely from the client id and secret — `200`, with no browser and no login anywhere in the flow.

**A note on why this looks wrong at first.** Fetching that URL by hand naturally leads through Battle.net's login screen, which makes a user token seem mandatory. That is an artifact of the authorization-code flow being the only convenient way to mint a token manually (and the only one the dev portal's tooling walks you through) — not a requirement of the endpoint. Both grants produce an access token that is indistinguishable in an `Authorization: Bearer` header. The `wow.profile` scope governs a _user's_ data and therefore only applies to `/profile/user/*`, where the account is identified by the token itself; a character endpoint names its subject in the URL, so there is no account to scope to. It needs _a_ token, not the character owner's token.

Worth stating explicitly, since it is the crux of the whole phase: the app token _also_ expires after ~24 hours, exactly like the user token. The difference is not lifetime but renewability. Client Credentials has no refresh token **by design** — the app simply requests another token with its own client id and secret, with no user involvement, which `getAppToken()` already does 60 seconds ahead of expiry (and the client interceptors force-refresh on a 401 as a backstop). The 24h on the app token is a cache TTL; the 24h on the user token is a grant that only a human logging in can renew. That asymmetry, not the duration, is what makes unattended polling possible.

### Why polling is adaptive rather than fixed

A single fixed interval is wrong in both directions. Six hours is generous for a character nobody is playing — the data is identical poll after poll — but it is far too coarse during an actual play session, where levels, XP, gear, and achievements all move within minutes and a 6-hour gap collapses an evening of progress into one data point.

Battle.net exposes no "character is currently online" flag, so activity cannot be read directly. It can, however, be **inferred from whether the fetched data changed since the previous poll**, which is a strictly better signal than any schedule-based guess: it needs no extra API calls, it catches a session that starts at an unpredictable hour, and it decays on its own when play stops. Each character therefore carries its own interval, reset to the fast cadence on any observed change and doubled toward the slow floor when nothing moves.

### What this phase does not attempt

Retention and downsampling policy for the accumulated snapshots is an open question on the umbrella [PRD.md](../../../PRD.md) and stays open — this ticket writes rows and nothing prunes them.

## Decisions made for this ticket

### Auth / token strategy

- **The job polls with the app-level client-credentials token**, not per-user tokens — verified working against live character endpoints (see Background). It never reads `battlenet_tokens` and never touches `needs_reauth`; a user with an expired Battle.net session still has their tracked characters snapshotted.
- **No new token-handling logic.** `getAppToken()` / `refreshAppToken()` already re-mint the app token indefinitely from the client id and secret; the job depends on that existing behaviour and adds nothing to it.
- **`needs_reauth` remains correct and untouched for the live Phase 2/3 endpoints**, which still use per-user tokens because `/profile/user/wow` genuinely requires the user's own grant. This ticket changes nothing about those paths — it just declines to build the background job on top of them.

### HTTP client

- **New `app/http/BattleNetAppProfileClient.ts`** — an app-token-backed client for Profile API paths, defaulting the namespace to `battlenetProfileNamespace`. Per the repo rule that `app/http/` clients are the only sanctioned way to call Battle.net, the job calls no Battle.net URL directly.
- **The app-token interceptor logic is extracted into a shared `createAppTokenClient()` factory**, used by both the new client and the existing `BattleNetGameDataClient`. The two would otherwise be near-identical copies of the same ~30 lines of token-attach + retry-once-on-401 interceptors. This is safe to do now: `battleNetGameDataClient` currently has **zero call sites** in the repo, so the refactor cannot regress live behaviour.
- Realm slug and character name are lowercased and `encodeURIComponent`-escaped when building paths, matching the normalization Phase 3 established.

### Adaptive polling

- **Each tracked character carries its own next-poll time and current interval**, stored as two new columns on `tracked_characters`: `next_poll_at` and `poll_interval_minutes`.
- **A short heartbeat drives the loop.** `setInterval` fires every `SNAPSHOT_JOB_HEARTBEAT_MINUTES` (default 5) and polls only the characters whose `next_poll_at <= now()` — not a global sweep of everything.
- **Change detected → interval resets to the active cadence** (`SNAPSHOT_ACTIVE_INTERVAL_MINUTES`, default 30).
- **No change → interval doubles, capped at the idle floor** (`SNAPSHOT_IDLE_INTERVAL_MINUTES`, default 360): 30 → 60 → 120 → 240 → 360. Backoff rather than a straight jump to 6h, so a brief lull mid-session doesn't immediately cost the rest of the session's resolution.
- **The change signal is a hash of the three raw payloads**, stored as `payload_hash` on each snapshot and compared against the previous snapshot's. Comparing only the typed metrics would fail in the case that matters most: a **max-level character has no XP gain and no level change**, so an evening of raiding would read as idle and stay pinned at 6-hour polling. Hashing the full payloads catches gear swaps, achievement ticks, spec changes, and fresh logins alike. If some field turns out to churn on its own, the only cost is polling that character every 30 minutes instead of every 6 hours — negligible.
- **A newly tracked character starts at `next_poll_at = now()` and the active interval**, so it is picked up on the next heartbeat and gets fast polling until it proves itself idle. The column defaults handle existing rows at migration time with no backfill script.
- **Restart safety is inherent.** Because due-ness lives in the database rather than in process memory, a redeploy cannot cause a polling burst — a character polled two minutes before a restart is simply not due yet. This is why the earlier "never run on boot" guard is unnecessary.
- **Rate limits are a non-issue.** Even with every tracked character in the active state, that is 3 calls per character per 30 minutes, against Blizzard's ~100 requests/second ceiling.

### Storage

- **New `character_snapshots` table**, one row per character per successful poll: typed columns for the metrics a frontend would graph, the `payload_hash`, plus the three raw Battle.net payloads as `jsonb`. The typed columns keep Phase 5's trend queries cheap and indexable; the raw payloads mean a metric nobody thought of today can be extracted from existing history later, with no backfill and no re-poll (impossible anyway — Battle.net serves only current state).
- **Keyed by `user_id` + `realm_slug` + `character_name`, with no foreign key to `tracked_characters`.** A FK with cascade delete would destroy a character's entire history the moment a user untracked it; keying on the natural identity Phase 3 already uses means history survives untrack/re-track cycles. The `user_id` FK to `users` keeps cascade-on-user-delete correct.
- **No deduplication — every poll writes a row**, even when the hash is unchanged. The change signal now exists, so skipping identical writes would be a one-line option, but the rows are what prove the job actually ran, and dedupe/downsampling belongs with Phase 5's retention decision rather than being baked into the write path.
- **Metrics stored as typed columns**: `level`, `experience`, `achievement_points`, `achievements_completed`, `average_item_level`, `equipped_item_level`, `last_login_at`.
- **Gold and quest counts are not stored, because they are not available.** Blizzard exposes no character gold through any API endpoint, and completed quests require a separate `/profile/wow/character/{realm}/{name}/quests/completed` call that is out of this ticket's scope. `PRD.md`'s umbrella goals mention both — see Dependencies / Follow-ups.

### Scheduling mechanics

- **Job logic lives in a service** (`runDueSnapshots()`) with no timers in it, so it is unit-testable directly.
- **In-process `setInterval` heartbeat**, started from `server.ts` only when enabled by config, with an **in-flight guard** so a slow run can never overlap the next tick. No new runtime dependency — `node-cron` buys expressiveness this doesn't need.
- **Disabled by default** (`SNAPSHOT_JOB_ENABLED=false`), so test runs and dev servers never quietly start polling Blizzard. Enabling it is a documented deploy step.
- **`npm run job:snapshot` one-shot entrypoint** calling the same service, for manual runs, local verification, and any future external cron/platform scheduler. It is the answer to "I don't want to wait for the next heartbeat to see this work."

### Execution and error handling

- **Characters are polled sequentially**, with the three endpoint calls for a single character issued in parallel. Blizzard's rate ceiling is orders of magnitude above this volume, so concurrency buys nothing and sequential execution keeps failure attribution obvious.
- **Per-character isolation**: each character is wrapped in its own try/catch. A 404 (renamed, transferred, or deleted character — an entirely expected condition, since Phase 3 accepts any realm/name pair with no ownership validation) or a transient 5xx logs a warning and the run continues to the next character.
- **A failed poll still advances `next_poll_at`**, using the backoff rule as if nothing changed. Otherwise a permanently 404-ing character would be retried on every single heartbeat forever.
- **A run returns and logs a summary**: `{ due, succeeded, failed }`.
- **One deliberate departure from the repo's error convention.** The repo's pattern is to throw and let Express's centralized `errorHandler` respond. The job has no Express request around it, so an unhandled rejection in a `setInterval` callback would crash the API process. The two entrypoints — the heartbeat tick and the CLI script — therefore catch everything and log; the service and model layers keep throwing normally. This is a boundary difference, not a new error-handling philosophy, and introduces no custom error classes.

### Out-of-band

- No read endpoint. Verification during development is via `psql` plus unit tests.

## Goals

- Every tracked character is polled automatically, with no user session, browser, or recent login involved.
- Polling resolution follows actual activity: a character being played is captured every 30 minutes, while idle characters cost 4 polls a day.
- Each poll persists a durable, queryable snapshot containing both extracted metrics and the full raw Battle.net payloads.
- The job survives the failure modes it will actually hit: a character that no longer exists, a transient Battle.net error, an empty due list, and a Battle.net outage — without crashing the API process and without losing the other characters in the run.
- A snapshot run can be triggered manually, on demand, from the command line.
- The ~24h user-token staleness limitation stops being an obstacle to data collection.

## Non-Goals

- Any endpoint that reads snapshots — history, trends, or latest-snapshot. That is Phase 5.
- Retention, pruning, or downsampling of accumulated snapshots (Phase 5's open question).
- Deduplicating unchanged consecutive snapshots.
- Storing gold or quest data (unavailable / out of scope — see Dependencies).
- **User-configurable** intervals. Cadence adapts automatically per character; the active/idle bounds are global config, not per-user or per-character settings.
- Backfilling history. Battle.net serves current state only; history begins at the first poll.
- Distributed/multi-instance scheduling coordination (leader election, advisory locks). The in-flight guard is per-process; running two API instances with the job enabled would double-poll. Documented, not solved.
- Alerting or metrics beyond log lines.
- Any change to the Phase 3 live endpoints' behaviour.

## Proposed Solution

### 1. Config

New `app/config/aggregation.keys.ts` (raw `process.env`) and `app/config/aggregation.conf.ts` (zod `safeParse`, `z.prettifyError` on failure at import time), following the repo's keys/conf split:

| Variable                           | Default | Meaning                                         |
| ---------------------------------- | ------- | ----------------------------------------------- |
| `SNAPSHOT_JOB_ENABLED`             | `false` | Whether `server.ts` starts the heartbeat at all |
| `SNAPSHOT_JOB_HEARTBEAT_MINUTES`   | `5`     | How often to look for due characters            |
| `SNAPSHOT_ACTIVE_INTERVAL_MINUTES` | `30`    | Interval after an observed change               |
| `SNAPSHOT_IDLE_INTERVAL_MINUTES`   | `360`   | Backoff ceiling for unchanging characters       |

All defaulted, so `tests/setup.ts` needs no new entries and existing tests keep passing untouched. The conf module validates that active ≤ idle and that the heartbeat is ≤ the active interval, since a heartbeat longer than the active interval would silently cap the real resolution.

### 2. HTTP client

- Extract the shared app-token interceptor logic into a `createAppTokenClient()` factory (token attach on request; on a 401, force-refresh the app token and retry once, guarded by `_retry`).
- Rewrite `BattleNetGameDataClient.ts` to use it (no behaviour change, no call sites).
- New `BattleNetAppProfileClient.ts` using it, exposing helpers for the three character paths with `profile-{region}` namespace defaulted and path segments lowercased/escaped.

### 3. Schema and models

**`tracked_characters` — two new columns:**

| Column                  | Type      | Notes                                                                |
| ----------------------- | --------- | -------------------------------------------------------------------- |
| `next_poll_at`          | timestamp | not null, `defaultNow()` — new and existing rows are immediately due |
| `poll_interval_minutes` | integer   | not null, default `30` (the active cadence)                          |

Index on `next_poll_at` to keep the due query cheap.

**`character_snapshots` — new table**, following the existing `pgTable`/`uuid`/`timestamp` conventions:

| Column                   | Type      | Notes                                  |
| ------------------------ | --------- | -------------------------------------- |
| `id`                     | uuid PK   | `defaultRandom()`                      |
| `user_id`                | uuid      | FK → `users.id`, `onDelete: 'cascade'` |
| `realm_slug`             | text      | not null                               |
| `character_name`         | text      | not null, lowercase                    |
| `captured_at`            | timestamp | not null, `defaultNow()`               |
| `payload_hash`           | text      | not null — change-detection signal     |
| `level`                  | integer   | nullable — absent fields tolerated     |
| `experience`             | integer   | nullable                               |
| `achievement_points`     | integer   | nullable                               |
| `achievements_completed` | integer   | nullable                               |
| `average_item_level`     | integer   | nullable                               |
| `equipped_item_level`    | integer   | nullable                               |
| `last_login_at`          | timestamp | nullable                               |
| `profile_payload`        | jsonb     | not null                               |
| `achievements_payload`   | jsonb     | not null                               |
| `equipment_payload`      | jsonb     | not null                               |
| `created_at`             | timestamp | not null, `defaultNow()`               |

Index on `(user_id, realm_slug, character_name, captured_at desc)` — serves both Phase 5's queries and this ticket's "fetch the previous hash" lookup.

Metric columns are nullable because Battle.net payloads vary by character state and a missing field must degrade to a null, not fail the whole snapshot.

- `app/models/CharacterSnapshot.model.ts` — `CharacterSnapshotModel.create(...)` and `findLatestHash({ userId, realmSlug, characterName })`.
- `app/models/TrackedCharacter.model.ts` — add `listDue(now)` and `updateSchedule(id, { nextPollAt, pollIntervalMinutes })`.
- Migration generated via `npm run db:migrate:generate`, plus the hand-written `.down.sql` the README requires (dropping the table and both new columns).

### 4. Aggregation service

`app/services/CharacterSnapshot.service.ts`:

```
runDueSnapshots(): Promise<{ due, succeeded, failed }>
nextPollInterval(currentIntervalMinutes, changed): number   // pure, exported for tests
```

`nextPollInterval` is the whole adaptive rule in one pure function: `changed ? activeInterval : Math.min(currentInterval * 2, idleInterval)`.

`runDueSnapshots`:

1. `TrackedCharacterModel.listDue(new Date())`; return a zeroed summary immediately if empty.
2. For each due character, sequentially:
   - `Promise.all` the three endpoint calls,
   - hash the three payloads, compare against `findLatestHash(...)`,
   - extract the typed metrics and write one row via `CharacterSnapshotModel.create(...)`,
   - `updateSchedule(...)` with `nextPollInterval(current, changed)`.
3. On any per-character error: log a warning naming realm/character, increment `failed`, and still `updateSchedule(...)` using the unchanged-backoff path so a dead character isn't retried every heartbeat.
4. Log and return the summary.

### 5. Scheduler and CLI entrypoint

- `app/services/SnapshotScheduler.service.ts` — `startSnapshotScheduler()`: no-op when disabled; otherwise `setInterval` at the heartbeat, guarded by an in-flight boolean, catching and logging everything a tick throws.
- `server.ts` — call it after `connect()` and `app.listen()`.
- `scripts/run-snapshot-job.ts` + `"job:snapshot"` in `package.json` — `connect()`, one `runDueSnapshots()`, log the summary, exit `0`, or log and exit `1` on an unexpected throw. Mirrors the existing `scripts/db-migrate-down.ts` entrypoint style.

### 6. Tests

`tests/CharacterSnapshot.service.test.ts`, mocking `TrackedCharacter.model.js`, `BattleNetAppProfileClient.js`, and `CharacterSnapshot.model.js` at the module boundary with `vi.mock`/`vi.hoisted` (the repo's only mocking approach):

- persists one row per due character, with metrics correctly extracted and all three raw payloads stored;
- a changed payload hash reschedules at the active interval; an unchanged hash doubles the interval; the doubling is capped at the idle floor;
- a character whose fetch rejects does not abort the run — remaining characters still persist, the summary reports `failed: 1`, and the failed character is still rescheduled rather than left permanently due;
- an empty due list performs no fetches and no writes;
- `nextPollInterval` is covered directly across the change/no-change/cap cases.

`tests/SnapshotScheduler.service.test.ts`, with Vitest fake timers:

- disabled config starts no timer;
- a tick while a run is still in flight is skipped rather than overlapped;
- a run that throws is caught, and a later tick still runs.

Model-level behaviour unit tests can't reach with mocked modules (the `ON DELETE CASCADE`, the indexes, the `.down.sql` rollback) is verified manually against the local Postgres instance, as CB-89 did.

### 7. Documentation

- README: the four new env vars, `npm run job:snapshot`, the fact that the job is off by default, how the adaptive cadence behaves, and the single-instance caveat.
- `PRD.md`: mark Phase 4 done and record that gold is not obtainable (see below).

## Acceptance Criteria

- [x] The heartbeat polls only characters whose `next_poll_at` is due, across all users, with no dependency on any user's session or `needs_reauth` state.
- [x] Snapshots continue to be collected for a user whose `needs_reauth` is `true` — provable by setting the flag manually and running the job.
- [x] Each successfully polled character produces exactly one `character_snapshots` row per poll, containing the extracted metrics, the payload hash, **and** all three raw Battle.net payloads.
- [x] A character whose payload hash changed is rescheduled at the active interval (30 min by default).
- [x] A character whose payload hash is unchanged has its interval doubled, capped at the idle floor (360 min by default).
- [x] Change detection is based on a hash of the raw payloads, not on the typed metric columns — so a max-level character with no XP or level movement is still detected as active when its gear or achievements change.
- [x] A newly tracked character is due immediately and starts at the active interval.
- [x] A character whose Battle.net fetch fails (404 or 5xx) is logged, counted as failed, **and still rescheduled** via the backoff path; every other character in the same run is still persisted.
- [x] An empty due list is a clean no-op — no Battle.net calls, no writes, no error.
- [x] An error thrown anywhere inside a scheduled run is caught at the scheduler boundary and does not crash the API process; the next heartbeat still fires.
- [x] A heartbeat that fires while the previous run is still in flight is skipped, not run concurrently.
- [x] With `SNAPSHOT_JOB_ENABLED=false` (the default), starting the server registers no timer and performs no polling — verifiable in the test suite.
- [x] Invalid config (active interval > idle interval, or heartbeat > active interval) fails at import time with a readable error.
- [x] `npm run job:snapshot` performs exactly one due-characters run against a live database and logs the `{ due, succeeded, failed }` summary.
- [x] Snapshot history for a character survives that character being untracked and re-tracked, and is removed when the owning user is deleted. Untrack/re-track survival was exercised live; the user-delete cascade is the same `ON DELETE CASCADE` mechanism already proven for `battlenet_tokens`/`tracked_characters` and was verified via the migration rather than by deleting the shared dev database's only user — see Post-implementation notes.
- [x] All Battle.net traffic goes through an `app/http/` client; no call site builds a Battle.net URL or handles a token directly.
- [x] `battleNetGameDataClient` and the new app profile client share one token/retry implementation rather than duplicating it.
- [x] Migration applies and its hand-written `.down.sql` rolls back cleanly.
- [x] `npm run build`, `npx eslint <changed files>`, and `npm test` all pass.
- [x] README documents the new env vars, the manual run command, the off-by-default behaviour, the adaptive cadence, and the single-instance caveat.

## Post-implementation notes

Facts the plan didn't pin down, or that changed once real code and a live database were involved:

- **`sha256Json` lives in `app/utils/Hash.util.ts`**, not inside `CharacterSnapshot.service.ts`. Pulling it out as a standalone, pure helper lets the test suite compute the expected hash independently of the service under test, rather than needing to mock or duplicate the hashing logic.
- **The shared app-token factory is `app/http/BattleNetAppTokenClient.ts`**, exporting `createAppTokenClient()` — the plan sketched this as a function but hadn't named its file. `BattleNetGameDataClient.ts` was rewritten to `export const battleNetGameDataClient = createAppTokenClient();` with no other change, and `BattleNetAppProfileClient.ts` uses the same factory.
- **`startSnapshotScheduler()` returns the `NodeJS.Timeout` (or `undefined` when the job is disabled)** rather than being a fire-and-forget void function. `server.ts` doesn't currently use the return value, but `SnapshotScheduler.service.test.ts` does — each test captures it and `clearInterval`s it in `afterEach`, so a failed assertion mid-test can't leave a live timer running into the next test.
- **Metric extraction reads `average_item_level`, `equipped_item_level`, and `last_login_timestamp` from the profile payload**, not the equipment payload. The equipment payload only contains per-slot item data; Battle.net's character-profile-summary endpoint already aggregates item level and last-login into top-level fields, so `extractMetrics()` in `CharacterSnapshot.service.ts` reads all of `level`/`experience`/`achievement_points`/`average_item_level`/`equipped_item_level`/`last_login_timestamp` off `profile`, and only `achievements_completed` (`total_quantity`) off the achievements payload.
- **`tracked_characters.poll_interval_minutes`'s column default is the literal integer `30`**, duplicating `SNAPSHOT_ACTIVE_INTERVAL_MINUTES`'s default rather than reading it. A Postgres column default has to be a constant baked into the migration at generation time — it cannot reference application config — so the two `30`s are two independent sources of truth that happen to agree today. If `SNAPSHOT_ACTIVE_INTERVAL_MINUTES` is ever changed, this column default needs a matching migration or newly-tracked rows will start one poll interval out of step with the active cadence until their first successful poll corrects it.
- **The `table.capturedAt.desc()` index method needed no fallback.** Task 3's plan anticipated it might not typecheck against the installed Drizzle version and pre-authorized dropping to a plain ascending index (a btree scans backward equally well) if so. It typechecked fine on the first attempt, so the index was built exactly as specified in Proposed Solution; no deviation to record beyond noting the contingency wasn't needed.
- **The cascade-on-user-delete half of the "history survives untrack, is removed with the user" acceptance criterion was verified structurally, not by a live drill.** Task 7's end-to-end verification (see its report) deleted and re-created a `tracked_characters` row against the shared dev database to prove untrack survival, but deliberately did not delete the database's only `users` row to check the cascade, since that would have destroyed unrelated fixture data with no easy way back. The `character_snapshots_user_id_users_id_fk` constraint carries `ON DELETE CASCADE`, the identical mechanism already exercised for `battlenet_tokens` and `tracked_characters` in earlier phases, so this is a structural rather than an independently observed guarantee.
- **The single-instance limitation is real and undocumented at the infrastructure level.** The in-flight guard in `SnapshotScheduler.service.ts` is a module-level `boolean`, which only prevents overlap within one process. Nothing in this ticket adds row-claiming (`SELECT … FOR UPDATE SKIP LOCKED`) or an advisory lock, so running the job enabled on more than one API instance will have every instance poll the same due characters independently each heartbeat. This was already flagged as a Non-Goal and remains open below; it is now also called out as a caveat in `README.md`.

## Open Questions

- **Retention and granularity** — inherited from `PRD.md`, still open, and deliberately not answered here. Adaptive polling widens the range rather than fixing a number: a permanently idle character accrues ~1,460 rows a year, while a heavily played one approaches ~17,500, each row carrying three raw JSON payloads (equipment being the largest). Comfortable for one player's characters, uncomfortable at scale. The decision needs real payload sizes, which this ticket produces. Phase 5 should settle it.

  Observed numbers from the local dev database after Task 7's live verification (`psql "$DATABASE_URL" -c "select pg_size_pretty(pg_total_relation_size('character_snapshots'));"` and companion `pg_column_size` queries): 2 rows, 328 kB total relation size (table + indexes + TOAST). Per row, the three raw payloads together run ~121 KB — `achievements_payload` alone accounts for ~113 KB of that (one character at level 84 with 618 achievements completed), against ~1.1 KB for `profile_payload` and ~7 KB for `equipment_payload`. Achievements dominates by roughly an order of magnitude over the other two combined, and it can only grow as a character earns more achievements over its lifetime — worth weighing specifically (e.g. only storing the achievement _count_ delta, not the full unlocked-list payload) when Phase 5 revisits retention, rather than treating the three payloads as equally-sized.

- **Whether the idle floor should be lower than 6 hours.** With backoff in place, a lower floor is cheap in a way it wasn't under a fixed schedule — the cost only applies to characters that never change. Worth revisiting once there's data on how many tracked characters are actually dormant.
- **Multi-instance deployment** — the in-flight guard is per-process. If the API is ever run as more than one instance with the job enabled, every due character gets polled once per instance. A Postgres advisory lock (or `SELECT … FOR UPDATE SKIP LOCKED` on the due query) is the obvious fix; not worth building before there is a second instance.

## Dependencies / Follow-ups

- **Depends on:** [wow-character-tracking.md](wow-character-tracking.md) (the `tracked_characters` table this extends, and the three character endpoints' path/normalization conventions) and [battlenet-oauth-integration.md](battlenet-oauth-integration.md) (`users`, the app-token service, the `needs_reauth` constraint this ticket routes around).
- **Blocks:** Phase 5 (historical progress storage & query) — `character_snapshots` is the table its endpoints will read, and its retention decision depends on data this job generates.
- **Requires a `PRD.md` update on completion (done):** mark Phase 4 done, and **remove "gold" from the umbrella Goals** — Blizzard exposes no character gold through any API, so it is not a deferrable feature but an unachievable one, and leaving it in the roadmap implies otherwise.
- **Follow-up candidate:** completed-quest counts via `/profile/wow/character/{realm}/{name}/quests/completed`, which would need a fourth endpoint call per character and a new metric column. Deliberately excluded here to keep this ticket's payload set identical to Phase 3's.
- **Follow-up candidate:** the ~24h user-token staleness still affects the _live_ Phase 2/3 endpoints, which is now purely a frontend-facing concern (a "please log in again" signal) rather than a data-collection one. Worth its own ticket when the frontend project starts.
