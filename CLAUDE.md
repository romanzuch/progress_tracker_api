# CLAUDE.md

Guidance for working in this repository. See [PRD.md](PRD.md) for product goals/roadmap and [plans/prds/](plans/prds/) for per-feature specs.

## Stack

- Express 5 + TypeScript, ESM (`"type": "module"` — relative imports use `.js` extensions even though source is `.ts`).
- Postgres via Drizzle ORM (schema in `app/database/schema/`), migrations via `drizzle-kit`.
- Zod for config validation (and, as of CB-88, request query validation).
- Axios for outbound HTTP (Battle.net APIs).
- Vitest for tests.
- ESLint (`@typescript-eslint` recommended + `eslint-config-prettier`) + Prettier.

## Directory conventions

- `app/routes/` — one `Xxx.routes.ts` per resource, exporting a `Router()` named `xxxRoutes`. Mounted in `app/routes/App.routes.ts` via `appRoutes.use('/xxx', xxxRoutes)`. Unmounted/placeholder routers are kept as commented-out imports/mounts rather than deleted until ready.
- `app/controllers/` — one `Xxx.controller.ts` per resource, exporting a plain object of named handler functions (`export const XxxController = { methodName(req, res) {...} }`) — not classes.
- `app/models/` — one `Xxx.model.ts` per table, exporting a plain object (`XxxModel`) of async functions wrapping Drizzle queries via `getDb()`. Domain types (e.g. `User`) are defined alongside the model.
- `app/services/` — business logic that isn't a direct HTTP-client wrapper or a DB model (e.g. `Session.service.ts`, `BattleNetAuth.service.ts`, `BattleNetUserToken.service.ts`).
- `app/http/` — dedicated Axios client factories/instances for external APIs (e.g. `BattleNetProfileClient.ts`, `BattleNetGameDataClient.ts`). These are the **only** sanctioned way to call Battle.net — no call site manages tokens manually.
- `app/middleware/` — Express middleware (e.g. `RequireAuth.middleware.ts`, `ErrorHandler.middleware.ts`). Not everything is re-exported from `app/middleware/index.ts` — check the barrel before assuming a middleware isn't already exported elsewhere, and import directly from the file when it isn't.
- `app/config/` — a `*.keys.ts` (raw `process.env` access, no validation) paired with a `*.conf.ts` (zod schema, `safeParse`, throws with `z.prettifyError` on invalid config at import time, and exports derived values like base URLs). Follow this split for any new config; don't read `process.env` directly outside a `*.keys.ts` file.
- `app/utils/` — small standalone helpers (e.g. `Crypto.util.ts`).
- `app/helpers/` — response-shaping helpers (e.g. `successResponse`). Not used everywhere yet (some controllers hand-build `{ success, data }`); prefer it for new success responses but don't refactor unrelated code to adopt it.
- `tests/` — flat, top-level, **not** colocated with source. Named `Xxx.<unit>.test.ts` (e.g. `Profile.controller.test.ts`, `Session.service.test.ts`). Shared env setup in `tests/setup.ts` (sets required config env vars so `*.conf.ts` files don't throw on import during tests).

## Patterns worth following

- **Error handling:** expected/validation errors (bad input, 401s, etc.) are handled inline in the controller/middleware via `res.status(N).json({ error })`. Unexpected errors are just thrown/rejected and left to propagate — Express 5 forwards async rejections to the centralized `errorHandler` (`app/middleware/ErrorHandler.middleware.ts`) automatically, which returns a flat `500 { error: message }`. There are no custom error classes — don't introduce one without discussing it first.
- **Region/locale:** Battle.net region is a single source of truth (`BNET_REGION` in `battlenet.conf.ts`, validated `us|eu|kr|tw`). Any Battle.net URL or namespace that's region-scoped (OAuth base, API base, `profile-{region}` namespace, etc.) must derive from that one config value — never hardcode a region.
- **Token handling:** `getValidAccessToken` / `forceRefreshAccessToken` (`app/services/BattleNetUserToken.service.ts`) are the only places that read/refresh a user's Battle.net token, and they set `users.needsReauth = true` as a side effect when a refresh fails. Callers that need to distinguish "must re-authenticate" from a generic failure should re-check `UserModel.findById(userId).needsReauth` after catching an error from a Battle.net client call — see `app/controllers/Profile.controller.ts` for the pattern.
- **Testing external calls:** no mocking library/helpers exist beyond Vitest's own `vi.mock`/`vi.hoisted`. Mock at the module boundary (e.g. mock `BattleNetProfileClient.js`, `User.model.js`) rather than reaching for a test DB or real HTTP calls in unit tests.
- **Config barrel:** `app/config/index.ts` only re-exports `app.conf`/`app.keys` — `battlenet.conf.ts`, `session.conf.ts`, `db.conf.ts` etc. are imported directly by their consumers, not through the barrel.

## Workflow

This project follows a PRD-first, Linear-ticket-driven flow:

1. **PRD first.** Before implementing a non-trivial feature, write (or ask for) a PRD under `plans/prds/<kebab-slug>.md`. Clear up ambiguities with the user (ask, don't assume) before writing it. A PRD includes: Status, Summary, Background/Context, Decisions made for this ticket, Goals, Non-Goals, Proposed Solution, Acceptance Criteria, Open Questions, Dependencies/Follow-ups.
2. **Linear ticket.** Create the corresponding Linear ticket in the "World of Warcraft Character Progress Tracker" project (team `codebox`, prefix `CB-`), matching the structure of existing tickets (Problem/Context, Goal, Scope, Dependencies, Out of Scope, Acceptance Criteria, Notes) and linking back to the PRD file. Confirm the drafted ticket content with the user before creating it (it's visible to the whole team).
3. **Branch naming.** Use the exact branch name Linear provides for the ticket: `romanzuchowski/cb-<n>-<kebab-title>`.
4. **Before committing:** run `npm run build` (typecheck), `npx eslint <changed files>`, and `npm test` — all three must pass. Update the README when the ticket's acceptance criteria call for it.
5. **PRDs and tickets are living documents** — if implementation deviates from a PRD's assumptions (see `battlenet-oauth-integration.md`'s "Post-implementation note" for an example), update the PRD to record what actually happened and why, rather than leaving it silently stale.
