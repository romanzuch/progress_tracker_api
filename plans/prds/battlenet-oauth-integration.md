# PRD: Battle.net OAuth Integration (Login + Game Data API Access)

## Status

Draft

## Summary

Add Battle.net as the sole login mechanism for the WoW progress tracker, and give the backend authenticated access to both Battle.net APIs it needs: the per-user Profile API (Authorization Code flow) and the app-level Game Data API (Client Credentials flow). This is foundational infrastructure — no character/progress data fetching is included; this ticket only lands the OAuth plumbing, user identity, token storage/refresh, and the Axios clients that future tickets will call into.

## Background / Context

The repo (`progress_tracker`, Express + TypeScript) has Postgres + Drizzle wired up (prior ticket), but nothing else this ticket needs exists yet:

- [Auth.routes.ts](../../app/routes/Auth.routes.ts) is a placeholder and isn't even mounted (`appRoutes.use('/auth', ...)` is commented out in [App.routes.ts](../../app/routes/App.routes.ts)).
- [User.model.ts](../../app/models/User.model.ts) is an in-memory array, not backed by the database.
- There is no `users` table — [schema/index.ts](../../app/database/schema/index.ts) only has the placeholder `schema_migration_check` table from the Postgres-setup ticket.
- No axios, no JWT library, no crypto/encryption helper, no OAuth client of any kind is in `package.json`.
- [Redis.database.ts](../../app/database/Redis.database.ts) is an unimplemented stub and stays out of scope here (per decision below).

Config in this repo follows a `*.keys.ts` (raw env access) → `*.conf.ts` (zod-validated, throws on invalid config at import time) split, e.g. [db.keys.ts](../../app/config/db.keys.ts) / [db.conf.ts](../../app/config/db.conf.ts). This ticket follows the same pattern for Battle.net and session config.

### Decisions made for this ticket

- **Session mechanism:** stateless JWT, set as an httpOnly cookie. No server-side session store; the JWT (signed with a session secret from env) carries the local user id and is validated on each request. Simplest option given no session store is wired up.
- **App-token cache:** in-memory module singleton (token + expiry held in a module-level variable, refreshed on demand). No Redis dependency added by this ticket. Acceptable for a single-instance deployment; revisit if/when the app scales horizontally.
- **Refresh token encryption:** AES-256-GCM using Node's built-in `crypto`, with a symmetric key sourced from env (`TOKEN_ENCRYPTION_KEY`). No KMS/secrets-manager dependency.
- **Battle.net region:** configurable (US/EU/KR/TW), read from env, used to derive OAuth and API base URLs. Not hardcoded to US.

## Goals

- A user can sign in with Battle.net; a local user record is created on first login and matched on return visits.
- After login, the API issues its own JWT session cookie so the frontend never re-hits Battle.net for subsequent requests.
- The Battle.net refresh token is stored encrypted at rest, tied to the user record.
- Expired Battle.net user access tokens are refreshed transparently using the stored refresh token.
- The app obtains and caches a client-credentials token for Game Data API calls, refreshed automatically before expiry.
- Two dedicated Axios clients (Profile API, Game Data API) attach valid tokens automatically via interceptors and retry once on a 401 after a refresh.
- All secrets (client id/secret, session signing secret, encryption key) come from env config, never hardcoded.

## Non-Goals

- Fetching or displaying any actual WoW character/progress/gear data (follow-up tickets).
- Any login method other than Battle.net.
- Full account management (profile editing, account deletion, linking multiple Battle.net accounts, etc.) — only the minimal user record needed to anchor sessions and tokens.
- Implementing `Redis.database.ts` or any shared/multi-instance token cache.
- Logout-everywhere / session revocation lists, refresh-token rotation policies beyond "store the latest one Battle.net issues."
- Rate limiting / retry-with-backoff for Battle.net API calls beyond the single 401-retry interceptor behavior.

## Proposed Solution

### 1. Database: `users` and `battlenet_tokens` tables

New Drizzle schema (in `app/database/schema/`, alongside the existing placeholder):

- **`users`**
  - `id` (uuid or serial, PK)
  - `battlenet_id` (Battle.net account/sub identifier, unique, not null) — the key used to match returning users
  - `battletag` (display name, nullable — nice to have from the OAuth userinfo response)
  - `needs_reauth` (boolean, default `false`) — set to `true` when a refresh attempt fails (revoked/expired refresh token); read by future background-aggregation tickets to skip the user and by the frontend to prompt a re-login. This ticket only adds and clears the column (on successful login/refresh); nothing in this ticket's scope sets it to `true` yet, since there's no background job here to trigger it — see Note below.
  - `created_at`, `updated_at`

- **`battlenet_tokens`**
  - `id` (PK)
  - `user_id` (FK → `users.id`, unique — one Battle.net token set per user)
  - `access_token` (short-lived; can be stored plaintext or just not persisted — see Open Questions)
  - `refresh_token_encrypted` (bytea/text — AES-256-GCM ciphertext)
  - `refresh_token_iv` (bytea/text — GCM nonce, stored alongside ciphertext)
  - `access_token_expires_at`
  - `created_at`, `updated_at`

> **Note on session store vs. token store:** the JWT-cookie session (§4) only governs how a *browser* authenticates to our API — it has no bearing on background data aggregation. `battlenet_tokens` is the durable, server-side store that makes scheduled per-user polling possible: a future aggregation job reads it directly (no cookie/JWT involved), refreshing and calling the Profile API on a user's behalf independent of whether that user currently has a live session. `needs_reauth` is the hook that job will set when a stored refresh token stops working.

This migration replaces the placeholder `schema_migration_check` table introduced by the Postgres-setup ticket (that table was explicitly a throwaway proving the pipeline works).

The existing in-memory [User.model.ts](../../app/models/User.model.ts) and its `UserController`/routes get replaced with a Drizzle-backed model — the in-memory version was scaffolding, not a real dependency.

### 2. Config

New `app/config/battlenet.keys.ts` / `battlenet.conf.ts` (zod-validated) covering:

- `BNET_CLIENT_ID`, `BNET_CLIENT_SECRET`
- `BNET_REGION` (enum: `us` | `eu` | `kr` | `tw`, drives base URL selection)
- `BNET_REDIRECT_URI` (OAuth callback URL registered in the Battle.net dev portal)

New `app/config/session.keys.ts` / `session.conf.ts` covering:

- `SESSION_JWT_SECRET`
- `SESSION_JWT_EXPIRES_IN` (e.g. `7d`)
- `TOKEN_ENCRYPTION_KEY` (32-byte key, base64 or hex, for AES-256-GCM)

Region → base URL mapping (Battle.net's documented pattern):
- OAuth: `https://{region}.battle.net/oauth/authorize`, `https://{region}.battle.net/oauth/token`
- Profile/Game Data API: `https://{region}.api.blizzard.com`

### 3. Battle.net OAuth client (Authorization Code flow + login)

New module, e.g. `app/services/BattleNetAuth.service.ts`:

- `getAuthorizationUrl(state)`: builds the Battle.net consent-screen URL (client id, redirect uri, scope `wow.profile`, `state` for CSRF protection).
- `exchangeCodeForToken(code)`: POSTs to Battle.net's token endpoint, returns access token, refresh token, expiry.
- `refreshUserToken(refreshToken)`: POSTs a refresh-token grant, returns new access token (+ possibly rotated refresh token).

Routes, replacing the placeholder [Auth.routes.ts](../../app/routes/Auth.routes.ts) (and mounting it in [App.routes.ts](../../app/routes/App.routes.ts)):

- `GET /api/auth/battlenet` — generates and stores a `state` value (short-lived, e.g. signed cookie), redirects to Battle.net's consent screen.
- `GET /api/auth/battlenet/callback` — validates `state`, exchanges `code` for tokens, upserts the `users` row (match by `battlenet_id`, create if new), encrypts + stores the refresh token in `battlenet_tokens`, issues the JWT session cookie, redirects to the frontend.
- `POST /api/auth/logout` — clears the session cookie (no Battle.net-side revocation call needed for this ticket's scope).

### 4. Session issuance & auth middleware

- `app/services/Session.service.ts`: `signSession(userId)` → JWT; `verifySession(token)` → userId or throws.
- `app/middleware/RequireAuth.middleware.ts`: reads the session cookie, verifies the JWT, attaches `req.user = { id }` (or 401s).
- Cookie: httpOnly, `secure` in production, `sameSite=lax` (same-site frontend assumed; revisit if cross-origin).

### 5. Encryption helper

`app/utils/Crypto.util.ts`: `encrypt(plaintext) -> { ciphertext, iv }` / `decrypt({ ciphertext, iv }) -> plaintext`, using Node's `crypto.createCipheriv('aes-256-gcm', ...)` with the key from `session.conf.ts`. Auth tag stored appended to ciphertext (standard GCM practice).

### 6. Client Credentials flow (Game Data API, app-level)

New module `app/services/BattleNetAppToken.service.ts`:

- In-memory singleton: `{ token: string, expiresAt: number } | undefined`.
- `getAppToken()`: returns cached token if not near expiry (e.g. refresh 60s before actual expiry); otherwise POSTs `client_credentials` grant to Battle.net's token endpoint, caches, returns.
- No persistence — acceptable since this is app-level and cheap to refetch on process restart.

### 7. Axios clients + interceptors

Add `axios` as a dependency. Two dedicated instances in `app/http/`:

- **`BattleNetProfileClient`** (per-user): needs the requesting user's access token, so it's constructed per-request (e.g. a factory `createProfileClient(userId)` or a request interceptor that pulls the token via a passed context) rather than a single shared instance — user tokens differ per caller. Interceptor:
  - Request: attach `Authorization: Bearer <user access token>` (fetching from `battlenet_tokens`, refreshing via `refreshUserToken` first if `access_token_expires_at` has passed).
  - Response: on 401, refresh once via `refreshUserToken`, update stored token, retry the original request once; if it 401s again, propagate the error. If the *refresh call itself* fails (invalid_grant — revoked/expired refresh token), set `users.needs_reauth = true` for that user before propagating, so callers (including future background jobs) can distinguish "transient failure" from "user must log in again."

- **`BattleNetGameDataClient`** (app-level): a single shared Axios instance.
  - Request: attach `Authorization: Bearer <app token>` via `getAppToken()`.
  - Response: on 401, force-refresh the app token once and retry; otherwise propagate.

Both clients are the only sanctioned way future tickets call Battle.net — call sites never touch tokens directly, satisfying the "no call site manually manages tokens" acceptance criterion.

### 8. Env vars

Add to `.env.example` (and document in README): `BNET_CLIENT_ID`, `BNET_CLIENT_SECRET`, `BNET_REGION`, `BNET_REDIRECT_URI`, `SESSION_JWT_SECRET`, `SESSION_JWT_EXPIRES_IN`, `TOKEN_ENCRYPTION_KEY`.

## Acceptance Criteria

- [ ] A new user can sign in with Battle.net and a local `users` record is created on first login.
- [ ] A returning user signing in with Battle.net is matched to their existing `users` record (by `battlenet_id`), not duplicated.
- [ ] After a successful login, the API sets a signed JWT session cookie; subsequent requests are authenticated via `RequireAuth` middleware without contacting Battle.net.
- [ ] The Battle.net refresh token is stored AES-256-GCM-encrypted in `battlenet_tokens`, tied to the user record — never stored or logged in plaintext.
- [ ] Expired Battle.net user access tokens are refreshed automatically (via the Profile client's request/response interceptors) with no user-facing interruption.
- [ ] The app obtains and caches a client-credentials token for Game Data API calls, shared across requests (not refetched per call).
- [ ] The app-level token is refreshed automatically before expiry (checked lazily on each `getAppToken()` call).
- [ ] Both the Profile client and Game Data client attach tokens automatically and retry once on a 401 — no call site manages tokens manually.
- [ ] All Battle.net credentials, session secret, and encryption key are read from env config (via `*.keys.ts`/`*.conf.ts`), never hardcoded.
- [ ] `state` parameter is validated on OAuth callback to mitigate CSRF.
- [ ] `users.needs_reauth` is set to `true` if a stored refresh token fails to refresh (invalid/revoked), and cleared on a successful login/refresh — giving future background jobs a way to skip that user and the frontend a way to prompt re-login.

## Open Questions

- Should the Profile API's user access token be persisted in `battlenet_tokens` at all, or only the refresh token (re-deriving the access token via refresh on every use)? Storing it avoids an extra round-trip when it's still valid; not storing it is simpler and reduces the plaintext-secret surface. Leaning toward storing it (plaintext is fine — it's short-lived, ~24h) alongside its expiry, to avoid refreshing on every single call.
- What scopes does the Profile API require beyond `wow.profile` — is `openid` needed for a userinfo endpoint to get the BattleTag/account id, or does the token exchange response already include enough identity info?
- Redirect target after callback: is there a frontend URL/route to redirect to yet, or should the callback just return JSON for now (frontend doesn't exist in this repo)?
- `SESSION_JWT_EXPIRES_IN` vs. Battle.net refresh token lifetime — should our session outlive Battle.net's refresh token, or should session expiry be tied to it?

## Dependencies / Follow-ups

- **Manual prerequisite (non-code, doesn't block writing code):** register the app in the Battle.net developer portal to obtain `BNET_CLIENT_ID` / `BNET_CLIENT_SECRET` and register `BNET_REDIRECT_URI`. Required before end-to-end testing.
- **Depends on:** Postgres-setup ticket (already landed) for the DB connection and migration tooling this ticket's `users`/`battlenet_tokens` tables build on.
- **Blocks:** all future WoW character/progress-data-fetching tickets, which will call through `BattleNetProfileClient` / `BattleNetGameDataClient`. Notably, the planned scheduled aggregation job (polling each user's characters on a rhythm) depends on this ticket's `battlenet_tokens` table and `needs_reauth` flag — that job itself, and its scheduling mechanism (cron, queue, etc.), is not part of this ticket.
- **Deferred:** `Redis.database.ts` implementation (only needed if the app-token cache or sessions move to a shared store for horizontal scaling).
