# PRD: WoW Profile Summary Endpoint

## Status

Draft

## Summary

Add the first real WoW data endpoint, `GET /api/profile/wow`, which fetches the authenticated user's WoW Account Profile Summary from Battle.net's Profile API and returns it unmodified to the frontend. This builds directly on [battlenet-oauth-integration.md](battlenet-oauth-integration.md): it is the first caller of `BattleNetProfileClient`, and has no persistence or transformation logic of its own — a thin, authenticated proxy.

## Background / Context

The OAuth PRD landed `BattleNetProfileClient` (per-user Axios client, attaches/refreshes the caller's Battle.net access token) but nothing calls it yet — no route in this repo fetches actual WoW data. This ticket is that first caller.

Battle.net's Profile API for this resource:

- Endpoint: `/profile/user/wow`
- Required query params: `namespace` (e.g. `profile-eu`), `locale` (e.g. `de_DE`)
- Base URL: `https://{region}.api.blizzard.com`, where `{region}` is the same value used in the `namespace` (e.g. base `https://eu.api.blizzard.com` pairs with `namespace=profile-eu`)
- Auth: `Authorization: Bearer <user access token>` (the per-user token from the Authorization Code flow, not the app-level client-credentials token)

Per the OAuth PRD's decisions, `BNET_REGION` (`us` | `eu` | `kr` | `tw`) is already a configured env value driving the OAuth/API base URLs. This ticket reuses it rather than hardcoding `eu`, so `namespace` becomes `profile-{BNET_REGION}` and the base URL stays `https://{BNET_REGION}.api.blizzard.com` — consistent with how `BattleNetProfileClient` is already constructed.

## Decisions made for this ticket

- **Region:** derived from the existing `BNET_REGION` config (not hardcoded to `eu`), keeping `namespace` region and base-URL region in lockstep as Battle.net requires.
- **Locale:** a query param on our own endpoint (`?locale=de_DE`), passed through to Battle.net's `locale` param. Validated against a zod enum of Battle.net's supported locales (`en_US`, `en_GB`, `de_DE`, `es_ES`, `fr_FR`, `it_IT`, `pl_PL`, `pt_PT`, `ru_RU`, `ko_KR`, `zh_TW`, `zh_CN`, `es_MX`, `pt_BR`); defaults to `en_US` if omitted. Invalid values → `400`.
- **Persistence:** none. This is a live proxy; the response is not stored in the database. Storage/aggregation is out of scope (see Non-Goals).
- **Response shape:** passthrough — Battle.net's WoW Account Profile Summary JSON body (`id` + `wow_accounts[]`, each with `characters[]`) is returned to the frontend unmodified, no reshaping.
- **Auth:** requires an authenticated session (`RequireAuth` middleware from the OAuth PRD); the request is made using that session's user's stored Battle.net access token via `BattleNetProfileClient`.

## Goals

- A logged-in user can call `GET /api/profile/wow` and receive their Battle.net WoW Account Profile Summary as JSON.
- The frontend can request a specific locale via a query param; the backend validates it and defaults sensibly if omitted.
- The namespace/region pairing is always internally consistent, driven by one source of config (`BNET_REGION`), never hardcoded per-endpoint.
- Token attachment, refresh-on-401, and `needs_reauth` handling all come for free from the existing `BattleNetProfileClient` — this ticket adds no new token-handling logic.

## Non-Goals

- Persisting the profile summary (or any derived character data) to the database.
- Fetching character-level detail beyond what the Account Profile Summary endpoint itself returns (e.g. no follow-up calls to per-character equipment/mythic-plus/etc. endpoints).
- Any background/scheduled aggregation job (tracked as a future ticket per the OAuth PRD's Dependencies section).
- Supporting regions other than what `BNET_REGION` is configured to (no per-request region override).
- Caching Battle.net responses (e.g. in Redis) — out of scope, `Redis.database.ts` remains unimplemented per the OAuth PRD.

## Proposed Solution

### 1. Route: `GET /api/profile/wow`

New `app/routes/Profile.routes.ts`, mounted in [App.routes.ts](../../app/routes/App.routes.ts) as `appRoutes.use('/profile', ...)`.

- Behind `RequireAuth` middleware — 401 if no valid session cookie.
- Reads `req.query.locale`, validates against the supported-locale zod enum, defaults to `en_US` if absent; 400 on an invalid value.
- Builds `namespace = profile-${BNET_REGION}` from config (same config the OAuth PRD's `battlenet.conf.ts` already exposes).
- Calls `BattleNetProfileClient` (constructed/factory'd for `req.user.id`, per the OAuth PRD's §7) with:
  - `GET /profile/user/wow`
  - query params `namespace`, `locale`
- Returns Battle.net's JSON response body as-is with a `200`.
- Propagates `BattleNetProfileClient`'s existing error behavior unchanged: a `needs_reauth`-triggering failure (revoked/expired refresh token, no refresh token available) surfaces as the client's existing "must re-authenticate" error; the route maps that to a `401` with a clear error body (e.g. `{ error: "needs_reauth" }`) for the frontend to detect and prompt re-login.

### 2. Locale validation

Add a small zod schema (e.g. in `Profile.routes.ts` or a shared `app/config/battlenet.locales.ts`) enumerating Battle.net's supported locales. Reused here only; not wired into `battlenet.conf.ts` since it's per-request, not app config.

### 3. No schema changes

No new tables, no migration. This ticket only adds a route and a thin service call using infrastructure the OAuth PRD already built.

## Acceptance Criteria

- [ ] `GET /api/profile/wow` requires a valid session cookie (`RequireAuth`); unauthenticated requests get `401`.
- [ ] A valid request without `?locale` defaults to `en_US`; Battle.net's response is returned unmodified with `200`.
- [ ] A valid request with `?locale=de_DE` (or any other supported locale) passes that locale through to Battle.net and returns its response unmodified.
- [ ] A request with an unsupported/malformed `?locale` value gets `400` before any call to Battle.net is made.
- [ ] The `namespace` sent to Battle.net is always `profile-{BNET_REGION}` and the request always targets `https://{BNET_REGION}.api.blizzard.com` — both driven by the same config value, never hardcoded to `eu`.
- [ ] The request is authenticated with the calling user's own Battle.net access token (via `BattleNetProfileClient`), not the app-level Game Data token.
- [ ] If the underlying token can't be refreshed (`needs_reauth` case), the endpoint returns a distinguishable error (not a generic 500) so the frontend can prompt re-login.
- [ ] No new database tables or persisted rows are introduced by this ticket.

## Open Questions

- Should the supported-locale list be sourced from a shared constant if other future WoW endpoints (item/media/etc., which also take `locale`) need the same validation, or is duplicating it per-endpoint fine until a second consumer exists?
- Does the frontend need the raw Battle.net error body on non-2xx responses (for debugging) or just a generic error envelope?

## Dependencies / Follow-ups

- **Depends on:** [battlenet-oauth-integration.md](battlenet-oauth-integration.md) — `RequireAuth` middleware, `BattleNetProfileClient`, and the `BNET_REGION` config it introduced.
- **Blocks:** any future ticket that persists or aggregates character data, which will likely build on this endpoint's shape (or call `BattleNetProfileClient` directly, bypassing the HTTP hop).
