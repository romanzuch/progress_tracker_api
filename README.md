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

The `schema_migration_check` table in the schema/migrations is a placeholder proving the generate/apply/rollback pipeline works end to end — replace it with real tables as features (e.g. OAuth) are built.
