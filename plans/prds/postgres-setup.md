# PRD: PostgreSQL Setup & Migration Tooling

## Status

Draft

## Summary

Stand up a working PostgreSQL setup for the API — connection handling, migration tooling, and a local dev workflow — so the upcoming OAuth ticket (and future work) has a database to build its tables on. This is foundational infrastructure, not a feature in itself: no application tables are introduced by this ticket.

## Background / Context

The repo (`progress_tracker`, an Express + TypeScript API) currently has no working database. `app/database/` and `app/config/db.conf.ts` / `db.keys.ts` are placeholder stubs left over from project scaffolding — `Mongo.database.ts` and `Redis.database.ts` exist but are unimplemented, and neither is wired into `app/config/app.conf.ts`. There is no `docker-compose.yml`. Environment config currently follows a simple `dotenv` pattern (`import 'dotenv/config'` in [server.ts](server.ts), with `process.env.PORT` read directly).

We're choosing Postgres as the datastore. This ticket only covers the plumbing: getting a Postgres instance running locally, connecting to it from the app, and having a repeatable way to evolve the schema. Table design (OAuth users/sessions/tokens, etc.) is out of scope and belongs to the OAuth ticket.

## Goals

- App can connect to Postgres using config sourced from environment variables.
- A migration can be created, applied, and rolled back via `npm` scripts.
- A fresh clone can get a working local Postgres running in one documented command (docker-compose).
- Connection failures are surfaced clearly (loud failure, not silent).
- README documents local DB setup and migration workflow.

## Non-Goals

- Defining any application/domain tables (users, sessions, OAuth tokens, etc.) — that's the OAuth ticket's job.
- Production infrastructure/provisioning (managed Postgres, backups, IaC).
- Connection pooling tuning beyond exposing basic config (pool size, timeouts).
- Read replicas, sharding, or any multi-instance topology.
- ORM-level data modeling patterns / seed data strategy beyond what's needed to prove migrations work.

## Proposed Solution

### Technology choice

Use **Drizzle ORM** with `postgres` (the `postgres` npm package, aka `postgres.js`) as the driver, and Drizzle Kit for migrations.

Rationale:

- Lightweight, SQL-centric — fits a small Express API better than a heavier ORM (Prisma's client generation step and engine binary add complexity this project doesn't need yet).
- Migration tooling (`drizzle-kit`) is a first-class part of the same toolchain, not a bolt-on — satisfies "migration tooling wired up" without adding a second, unrelated tool.
- Type-safe query building without a separate schema DSL/codegen step.
- Plain `.sql` migration files are generated and readable, easy to review in PRs and to hand-roll when needed (e.g. for the OAuth ticket's tables).

This is a recommendation; alternatives considered were Prisma (heavier, extra build step) and raw `pg` + `node-pg-migrate` (more manual wiring, less type safety for the eventual query layer). Confirm before implementation if there's a preference.

### Connection handling

- New `app/database/Postgres.database.ts` implementing connect/disconnect and exposing the Drizzle client instance, following the same shape already stubbed out in `Mongo.database.ts` / `Redis.database.ts`.
- Wire into `app/database/index.ts` and call from `app/config/app.conf.ts` (or `server.ts`) at startup — connection is established before the server starts accepting traffic.
- Config (connection string or discrete host/port/user/password/db, pool size, connection timeout) read via `app/config/db.conf.ts`, with env var names centralized in `app/config/db.keys.ts` — matching the existing placeholder structure and the `dotenv` pattern already in use.
- Env vars added to `.env` (and a new `.env.example` if one doesn't exist) — e.g. `DATABASE_URL`, `DB_POOL_MAX`, `DB_POOL_IDLE_TIMEOUT_MS`.

### Migration tooling

- `drizzle-kit` config at repo root (`drizzle.config.ts`) pointing at a `app/database/schema/` (or similar) directory and a `migrations/` output directory.
- npm scripts:
  - `db:migrate:generate` — generate a new migration from schema changes
  - `db:migrate:up` — apply pending migrations
  - `db:migrate:down` — roll back the last migration
- A trivial placeholder table/migration (or none at all, if Drizzle Kit can generate/apply/rollback against an empty schema) to prove the round-trip in acceptance testing — this should be removed or left as a template, not shipped as real schema, since table design is out of scope.

### Local dev workflow

- `docker-compose.yml` at repo root defining a single Postgres service (pinned version, e.g. `postgres:16-alpine`), with a named volume for persistence and port mapping to a configurable host port.
- `.env` / `.env.example` updated with matching defaults so `docker-compose up -d` + `npm run dev` works with zero additional manual steps on a fresh clone.
- Optionally a `db:up` / `db:down` npm script wrapping `docker-compose` for convenience, consistent with the existing `makefile`/npm-script conventions in the repo.

### Connectivity check

- A `/health` route (added under existing `app/routes/` and `app/controllers/App.controller.ts` conventions, or extending it if a health route already exists) that pings the DB (e.g. `SELECT 1`) and returns 200/503 accordingly.
- Startup check: if the initial connection fails, log a clear, actionable error (via the existing `Logger.util.ts`) and exit non-zero rather than starting the server in a half-working state.

### Documentation

- README updated with:
  - Prerequisites (Docker)
  - One-command local DB startup (`docker-compose up -d`)
  - Required `.env` values
  - Migration commands (generate / apply / rollback)
  - How to verify the setup (`/health` endpoint)

## Acceptance Criteria

- [ ] App connects to a local Postgres instance using config sourced from environment variables (no hardcoded connection details).
- [ ] A migration can be created, applied, and rolled back via `npm run db:migrate:*` scripts.
- [ ] A fresh clone can get a working local database running via one documented command (`docker-compose up -d`), with no other manual setup.
- [ ] Connection failures produce a clear, logged error at startup (and via `/health`) rather than failing silently or crashing with an opaque stack trace.
- [ ] README includes local DB setup and migration instructions sufficient for a new contributor to follow unassisted.

## Open Questions

- Confirm Drizzle + `postgres.js` as the chosen stack, or prefer Prisma / raw `pg` + `node-pg-migrate` instead?
- Should the `/health` endpoint be public, or gated behind auth/internal-only access?
- Do we need a seed script for local dev data, or is that deferred to the OAuth ticket / later work?

## Dependencies / Follow-ups

- **Blocks:** OAuth ticket (needs users/sessions/tokens tables on top of this setup).
- **Related:** Existing `Mongo.database.ts` / `Redis.database.ts` stubs remain unused placeholders unless/until a future ticket picks them up — out of scope here.
