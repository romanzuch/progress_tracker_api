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

## Database schema note

The `schema_migration_check` placeholder table (from the initial Postgres setup) has been dropped — real tables (`users`, `battlenet_tokens`) now live in `app/database/schema/index.ts`.
