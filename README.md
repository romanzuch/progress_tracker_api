# World of Warcraft Progress Tracker API

## Prerequisites

- Node.js
- Docker (for the local Postgres instance)

## Setup

1. Install dependencies:

   ```sh
   npm install
   ```

2. Copy the example environment file and adjust values if needed:

   ```sh
   cp .env.example .env
   ```

3. Start a local Postgres instance:

   ```sh
   npm run db:up
   ```

4. Apply migrations:

   ```sh
   npm run db:migrate:up
   ```

5. Start the dev server:

   ```sh
   npm run dev
   ```

The server connects to Postgres on startup and exits with a clear error if it can't reach the database. Check `GET /api/health` to confirm connectivity — it returns `200` with `{ status: 'ok', database: 'connected' }` when healthy, or `503` when the database is unreachable.

To stop the database:

```sh
npm run db:down
```

## Database & Migrations

The app uses [Drizzle ORM](https://orm.drizzle.team/) with the `postgres` (postgres.js) driver, and Drizzle Kit for migrations.

- Schema lives in [app/database/schema/index.ts](app/database/schema/index.ts).
- Generated SQL migrations live in `migrations/`.
- Connection config is read from environment variables (see `.env.example`): `DATABASE_URL`, `DB_POOL_MAX`, `DB_IDLE_TIMEOUT_MS`, `DB_CONNECT_TIMEOUT_MS`.

### Commands

| Command                       | Description                                         |
| ----------------------------- | --------------------------------------------------- |
| `npm run db:up`               | Start the local Postgres container (docker-compose) |
| `npm run db:down`             | Stop the local Postgres container                   |
| `npm run db:migrate:generate` | Generate a migration from schema changes            |
| `npm run db:migrate:up`       | Apply all pending migrations                        |
| `npm run db:migrate:down`     | Roll back the most recently applied migration       |

### Creating a migration

1. Edit `app/database/schema/index.ts` (add/modify tables).
2. Run `npm run db:migrate:generate` — this writes a new `migrations/<tag>.sql` file.
3. Write a matching `migrations/<tag>.down.sql` alongside it, reversing the up migration. Drizzle Kit only generates "up" SQL, so a hand-written down file is what makes `npm run db:migrate:down` able to roll it back.
4. Run `npm run db:migrate:up` to apply it.

## Authentication (Sign in with Battle.net)

Battle.net login is the app's sole authentication mechanism — there is no email/password flow. Signing in also creates (or matches) the local user record.

### Flow

1. `GET /api/auth/battlenet` — redirects to Battle.net's OAuth consent screen (Authorization Code flow, scopes `openid wow.profile`).
2. `GET /api/auth/battlenet/callback` — Battle.net redirects here with a `code`. The server exchanges it for an access + refresh token, upserts the `users` row (matched by Battle.net account id), encrypts and stores the refresh token in `battlenet_tokens`, and sets a signed JWT session cookie.
3. Subsequent requests to endpoints behind `requireAuth` (see [RequireAuth.middleware.ts](app/middleware/RequireAuth.middleware.ts)) are authenticated via that cookie — no further contact with Battle.net is needed just to establish who's calling.
4. `POST /api/auth/logout` — clears the session cookie.

### Token refresh

- **Per-user (Profile API):** [BattleNetProfileClient](app/http/BattleNetProfileClient.ts) attaches a valid user access token to every request, transparently refreshing it (via the stored, encrypted refresh token) when expired, and retrying once on a `401`. If the refresh token itself is no longer valid, the user's `needs_reauth` flag is set — future features (e.g. a background aggregation job) should check this before calling the Profile API on that user's behalf, and the frontend should prompt a fresh login when it's set.
- **App-level (Game Data API):** [BattleNetGameDataClient](app/http/BattleNetGameDataClient.ts) attaches a shared, in-memory-cached client-credentials token, refreshed automatically before expiry.

No call site should manage Battle.net tokens manually — always go through one of these two clients.

### Required environment variables

In addition to the Postgres variables above, set:

| Variable                 | Description                                                                                                                                                                 |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BNET_CLIENT_ID`         | Battle.net OAuth client id (from the Battle.net developer portal)                                                                                                           |
| `BNET_CLIENT_SECRET`     | Battle.net OAuth client secret                                                                                                                                              |
| `BNET_REGION`            | `us` \| `eu` \| `kr` \| `tw` — selects the OAuth/API base URLs                                                                                                              |
| `BNET_REDIRECT_URI`      | Callback URL registered with Battle.net, e.g. `http://localhost:3000/api/auth/battlenet/callback`                                                                           |
| `SESSION_JWT_SECRET`     | Signing secret for session JWTs (min 32 characters)                                                                                                                         |
| `SESSION_JWT_EXPIRES_IN` | Session JWT lifetime, e.g. `7d`                                                                                                                                             |
| `TOKEN_ENCRYPTION_KEY`   | 64-character hex string (32 bytes) used for AES-256-GCM refresh-token encryption — generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |

### Manual prerequisite

Register the app in the [Battle.net developer portal](https://develop.battle.net/) to obtain `BNET_CLIENT_ID` / `BNET_CLIENT_SECRET`, and register `BNET_REDIRECT_URI` there. This is required before end-to-end testing but doesn't block writing or reviewing code.

## WoW Profile Summary

`GET /api/profile/wow` — behind `requireAuth`; returns the caller's Battle.net WoW Account Profile Summary (`id` + `wow_accounts[]`, each with its `characters[]`) unmodified.

- **`locale`** (optional query param): one of Battle.net's supported locales (`en_US`, `en_GB`, `de_DE`, `es_ES`, `fr_FR`, `it_IT`, `pl_PL`, `pt_PT`, `ru_RU`, `ko_KR`, `zh_TW`, `zh_CN`, `es_MX`, `pt_BR`). Defaults to `en_US`; an unsupported value returns `400` before any Battle.net call is made.
- **Region/namespace:** the `namespace` sent to Battle.net (`profile-{BNET_REGION}`) is always derived from the same `BNET_REGION` config used for the API base URL — never hardcoded.
- **Auth failures:** if the stored Battle.net token can't be refreshed (`needs_reauth`), the endpoint returns `401 { "error": "needs_reauth" }` instead of a generic `500`, so the frontend can prompt a fresh login.
- No data from this endpoint is persisted — it's a live proxy to Battle.net's Profile API via [BattleNetProfileClient](app/http/BattleNetProfileClient.ts).

## WoW Character Detail

Three live proxies to Battle.net's per-character Profile API endpoints, all behind `requireAuth`:

| Endpoint                                                                | Returns                                                                    |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `GET /api/profile/wow/character/:realmSlug/:characterName`              | Character Profile Summary (level, experience, achievement points, spec, …) |
| `GET /api/profile/wow/character/:realmSlug/:characterName/achievements` | Character Achievements Summary (totals earned/points)                      |
| `GET /api/profile/wow/character/:realmSlug/:characterName/equipment`    | Character Equipment Summary (equipped items per slot)                      |

- Responses are returned unmodified, exactly like `GET /api/profile/wow`.
- **`locale`** (optional query param): same supported set and `en_US` default as `GET /api/profile/wow` — the enum is shared via [battlenet.locales.ts](app/config/battlenet.locales.ts).
- **Casing:** `realmSlug` and `characterName` are lowercased before being sent to Battle.net, whose character endpoints only match lowercase values. This means names can be passed through verbatim from `GET /api/profile/wow` (which returns them capitalized).
- **Auth failures:** `needs_reauth` is surfaced as `401 { "error": "needs_reauth" }`, same as `GET /api/profile/wow`.
- **Not gated by the tracked list** — any realm/character-name pair can be fetched, so a character can be previewed before being tracked.
- Nothing fetched here is persisted.

## Tracked characters

A per-user, durable selection of which characters the future scheduled aggregation job should poll. Stored in `tracked_characters`; all endpoints are behind `requireAuth` and scoped to the caller.

| Endpoint                                         | Behaviour                                                              |
| ------------------------------------------------ | ---------------------------------------------------------------------- |
| `GET /api/profile/wow/tracked-characters`        | Lists the caller's tracked characters, oldest first                    |
| `POST /api/profile/wow/tracked-characters`       | Body `{ "realmSlug": "...", "characterName": "..." }` — adds one       |
| `DELETE /api/profile/wow/tracked-characters/:id` | Removes one by row id, only if it belongs to the caller (`404` if not) |

- **No ownership validation on `POST`:** any realm/character-name pair is accepted without checking it against the caller's account summary. Blizzard's character endpoints serve public, armory-style data, so no extra Battle.net call is made to enforce "your own characters only".
- **`POST` is idempotent:** re-adding an already-tracked character returns `200` with the existing row rather than an error, via a unique index on `(user_id, realm_slug, character_name)`.
- **Normalization:** `realmSlug` and `characterName` are trimmed and lowercased before storage, so `Thrall` and `thrall` are the same tracked character.
- **No cap** on how many characters a user may track.
- Rows are deleted automatically when their user is (`ON DELETE CASCADE`).
- Only the selection is stored — no character stat data (level/XP/achievements/equipment) is persisted anywhere.

## Scheduled character snapshots

A background job that polls every tracked character on an adaptive schedule and writes one `character_snapshots` row per poll, containing both the typed metrics (level, experience, achievement points, item level, last login) and all three raw Battle.net payloads (profile, achievements, equipment) as `jsonb`.

- **Runs on the app-level client-credentials token**, not a user's session — see [BattleNetAppProfileClient](app/http/BattleNetAppProfileClient.ts). A character keeps getting snapshotted even after its owner's Battle.net session has expired and `needs_reauth` is set, unlike the live `/api/profile/*` endpoints above, which require a valid per-user token.
- **Adaptive cadence, per character:** a character whose payload hash changed since its last poll is re-polled after `SNAPSHOT_ACTIVE_INTERVAL_MINUTES`; an unchanged one has its interval doubled, capped at `SNAPSHOT_IDLE_INTERVAL_MINUTES` (30 → 60 → 120 → 240 → 360 minutes by default). A newly tracked character is due immediately and starts at the active interval.
- **Off by default.** Enabling the in-process heartbeat (`SNAPSHOT_JOB_ENABLED=true`) is a deploy step, not something dev servers or test runs do implicitly.

| Variable                           | Default | Description                                   |
| ---------------------------------- | ------- | --------------------------------------------- |
| `SNAPSHOT_JOB_ENABLED`             | `false` | Start the in-process heartbeat on server boot |
| `SNAPSHOT_JOB_HEARTBEAT_MINUTES`   | `5`     | How often to look for due characters          |
| `SNAPSHOT_ACTIVE_INTERVAL_MINUTES` | `30`    | Re-poll interval after an observed change     |
| `SNAPSHOT_IDLE_INTERVAL_MINUTES`   | `360`   | Backoff ceiling for unchanging characters     |

- Config is validated at import time (`app/config/aggregation.conf.ts`) and requires `heartbeat <= active <= idle` — an invalid combination fails fast rather than silently capping the real polling resolution.
- **`npm run job:snapshot`** runs one due-characters pass immediately and exits, regardless of `SNAPSHOT_JOB_ENABLED` — useful for local verification, or for driving the job from an external scheduler instead of the in-process heartbeat.
- **Single-instance only:** the in-flight guard that stops a heartbeat tick from overlapping a slow run is per-process. Running more than one API instance with the job enabled has each instance poll the same due characters independently — there is no row-claiming or locking between instances.
- History and trend queries against these snapshots are covered below.

## Character snapshot history

Read-only, ownership-scoped access to the snapshot history `character_snapshots` has been accumulating, plus an automatic policy for keeping storage cost bounded. Both endpoints are behind `requireAuth`.

| Endpoint                                                                        | Behaviour                                                                                          |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `GET /api/profile/wow/character/:realmSlug/:characterName/history`             | Typed-metric snapshot history for the caller's own data, filterable and paginated (see below)      |
| `GET /api/profile/wow/character/:realmSlug/:characterName/history/latest`      | Just the most recent snapshot; `404` if none exists                                                |

- **Ownership-scoped, unlike the live `/api/profile/wow/character/*` passthrough endpoints above:** results are filtered by `character_snapshots.user_id = req.user.id`, not merely by realm/character-name. A snapshot is data the app collected on a specific user's behalf, so it's never returned to a different caller, even for the same realm/character-name pair. This scoping is independent of `tracked_characters` — history survives a character being untracked and re-tracked.
- **Query params on `history`:** `from` / `to` (optional, ISO-8601, filters on `captured_at`) and `limit` (optional, default `100`, max `1000` — values above the max are clamped rather than rejected). Results are ordered ascending by `captured_at` (oldest first), the natural order for graphing a trend.
- **Typed metrics only, never the raw payloads.** Both endpoints return `level`, `experience`, `achievementPoints`, `achievementsCompleted`, `averageItemLevel`, `equippedItemLevel`, `lastLoginAt`, `capturedAt`, and `payloadHash` — the three raw Battle.net `jsonb` payloads (`profile_payload`, `achievements_payload`, `equipment_payload`) are never sent over HTTP by any endpoint in this API.
- **`history` on a realm/character-name the caller has no snapshots for returns `200` with an empty array**, not a `404` — there's no ownership ambiguity to signal, since an unrelated character simply has no matching rows for that `user_id`.

### Raw payload retention

Because the raw payloads are the dominant storage cost (see the scheduled-snapshots section above) but are never read back over HTTP, a scheduled job prunes them once they're old enough to be unlikely to matter:

- After `SNAPSHOT_RAW_PAYLOAD_RETENTION_DAYS` (default 90) days, the three raw `jsonb` payload columns on a snapshot row are set to `NULL`. **The row itself and every typed metric column are kept forever** — nothing is deleted, and the history endpoints above are unaffected, since they never select the raw payload columns in the first place.
- **This is irreversible.** Once a raw payload is pruned, that snapshot's original Battle.net response is gone for good; only its extracted typed metrics remain. There's no way to recover it later even if a new metric worth extracting is identified.
- **On by default** (`SNAPSHOT_RETENTION_JOB_ENABLED=true`), unlike the snapshot-polling job — pruning makes no external Battle.net calls and only trims local data, so there's no reason to require an opt-in.
- Runs on its own heartbeat, independent of the snapshot-polling heartbeat.

| Variable                              | Default | Description                                              |
| -------------------------------------- | ------- | ---------------------------------------------------------- |
| `SNAPSHOT_RAW_PAYLOAD_RETENTION_DAYS` | `90`    | Age (days) after which a snapshot's raw payloads are pruned |
| `SNAPSHOT_RETENTION_JOB_ENABLED`      | `true`  | Start the in-process retention heartbeat on server boot     |
| `SNAPSHOT_RETENTION_JOB_HEARTBEAT_HOURS` | `24` | How often to look for prunable snapshots                   |

- **`npm run job:prune-snapshots`** runs one retention pass immediately and exits, regardless of `SNAPSHOT_RETENTION_JOB_ENABLED` — useful for local verification or for driving retention from an external scheduler instead of the in-process heartbeat.
- Re-running the job against already-pruned rows is a cheap no-op — a row whose payloads are already `NULL` isn't rewritten.

## Account-wide character overview

| Endpoint                          | Behaviour                                                                              |
| ---------------------------------- | ----------------------------------------------------------------------------------------- |
| `GET /api/profile/wow/characters` | One entry per tracked character, each with its latest snapshot (or `null`) — see below |

- **A fan-out, not a new data source:** behind `requireAuth`, merges the caller's `tracked_characters` list with the latest snapshot per `(realmSlug, characterName)` the caller has ever had snapshotted. Read-only — no live Battle.net calls.
- Response shape:

  ```json
  [
    {
      "id": "tracked_characters.id",
      "realmSlug": "...",
      "characterName": "...",
      "latestSnapshot": {
        "id": "...",
        "capturedAt": "...",
        "payloadHash": "...",
        "level": 80,
        "experience": 0,
        "achievementPoints": 0,
        "achievementsCompleted": 0,
        "averageItemLevel": 0,
        "equippedItemLevel": 0,
        "lastLoginAt": "..."
      }
    }
  ]
  ```

- **Every tracked character appears, even one never polled yet** — `latestSnapshot` is `null` in that case, distinguishing "tracked but pending first poll" from "not tracked at all" without a second request.
- **`200` with an empty array for a caller with zero tracked characters**, not `404` — same "no ambiguity to signal" reasoning as the history endpoints above.
- No pagination, no realm filtering, and no server-computed account-level aggregates (total achievement points, highest item level, etc.) — a raw per-character rollup only, consistent with every other read endpoint's "typed metrics, never raw payloads" scoping.

## Database schema note

The `schema_migration_check` placeholder table (from the initial Postgres setup) has been dropped — real tables (`users`, `battlenet_tokens`, `tracked_characters`) now live in `app/database/schema/index.ts`.
