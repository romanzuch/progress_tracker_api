# PRD: WoW Character Detail Fetch & Tracking Selection

## Status

Implemented — see Post-implementation notes.

## Summary

Adds character-level detail fetching (profile summary, achievements, equipment) and a persisted "tracked characters" selection per user. Sits between the existing account-level profile summary (Phase 2, [wow-profile-summary.md](wow-profile-summary.md)) and the not-yet-built scheduled aggregation job: it lets a user, after fetching their WoW Account Profile Summary, drill into individual characters' level/XP/achievements/gear live, and mark specific characters for the future aggregation job to poll on their behalf.

## Background / Context

Phase 2 (`GET /api/profile/wow`) returns the Account Profile Summary: an id plus a list of WoW accounts, each with a bare list of characters (name, realm, class, faction — no level, XP, or gear). It calls no per-character endpoint. To let a player track meaningful progress over time, the API needs three more Battle.net Profile API endpoints, all scoped by realm slug + character name:

- **Character Profile Summary** — `/profile/wow/character/{realmSlug}/{characterName}`: level, experience, achievement points, name, gender, faction, race, class, active spec, realm.
- **Character Achievements Summary** — `/profile/wow/character/{realmSlug}/{characterName}/achievements`: total achievements earned, total achievement points.
- **Character Equipment Summary** — `/profile/wow/character/{realmSlug}/{characterName}/equipment`: equipped items per slot.

All three follow the region/namespace/auth pattern Phase 2 already established: `namespace=profile-{BNET_REGION}`, base `https://{BNET_REGION}.api.blizzard.com`, per-user Bearer token via `BattleNetProfileClient`.

Separately, the planned scheduled aggregation job (the phase after this one) needs to know, per user, _which_ characters to poll — the account summary lists everything on the account, but a user may only want a subset tracked. This ticket adds that persisted selection so the job has something to read.

Also relevant, not solved by this ticket: per the OAuth PRD's post-implementation note ([battlenet-oauth-integration.md](battlenet-oauth-integration.md)), Battle.net issues no refresh token for the Authorization Code flow, so a user's stored access token is only usable for ~24h after their last login. This ticket's endpoints are all live, in-session calls (always working with a fresh token from the caller's own cookie-authenticated request), so that staleness constraint doesn't affect it — it's a first-class concern for the _next_ phase (the scheduled job) and is called out here only as a known dependency for that follow-up PRD.

## Decisions made for this ticket

- **Three separate thin passthrough endpoints**, mirroring Phase 2's "no reshaping" precedent — one per Battle.net endpoint, not a single merged/aggregated response.
- **Route shape**, nested under the existing `/api/profile/wow` prefix:
  - `GET /api/profile/wow/character/:realmSlug/:characterName`
  - `GET /api/profile/wow/character/:realmSlug/:characterName/achievements`
  - `GET /api/profile/wow/character/:realmSlug/:characterName/equipment`
- **Auth/client:** all three reuse `BattleNetProfileClient` (per-user token, existing refresh/`needs_reauth` handling) — no new HTTP client.
- **Locale:** same validated zod enum as Phase 2, `?locale=`, defaulting to `en_US`. Since this is now the _second_ consumer of that validation, extract the enum into a shared module (`app/config/battlenet.locales.ts`) rather than duplicating it — resolves the open question left in [wow-profile-summary.md](wow-profile-summary.md).
- **Region:** unchanged pattern — always `profile-{BNET_REGION}` / `https://{BNET_REGION}.api.blizzard.com`, never per-request.
- **Character identity:** realm slug + character name is the natural key (Blizzard's own URL convention) — no surrogate Blizzard character ID exists in these payloads.
- **Passthrough endpoints are ungated:** they work for any realm/character-name pair the caller supplies (letting a user preview a character's detail before deciding to track it), same as Phase 2's scope. They are not restricted to characters already on the tracked list.
- **Tracked-character selection is a new, small table**, `tracked_characters` (distinct from the future historical-snapshot schema in Phase 4): `id` (uuid, PK), `user_id` (uuid, FK → `users.id`, cascade delete), `realm_slug` (text), `character_name` (text), `created_at`; unique index on `(user_id, realm_slug, character_name)`.
- **Tracking endpoints:**
  - `GET /api/profile/wow/tracked-characters` — list the caller's tracked characters.
  - `POST /api/profile/wow/tracked-characters` — body `{ realmSlug, characterName }`; adds one.
  - `DELETE /api/profile/wow/tracked-characters/:id` — removes one (only if owned by the caller).
- **No ownership validation on `POST`:** any `realmSlug`/`characterName` pair can be tracked, without checking it against the caller's account summary. Blizzard's character endpoints return public, armory-style data (not account-restricted), so this ticket doesn't add an extra Battle.net call to enforce "your own characters only."
- **Duplicate `POST`:** idempotent — re-adding an already-tracked `(user, realmSlug, characterName)` returns `200` with the existing row, not an error.
- **`DELETE` keyed by row id** (`/tracked-characters/:id`), not by realm/name — simpler and RESTful; the frontend is expected to have the id from a prior `GET`.
- **No cap** on the number of tracked characters per user for now.
- **No persistence of fetched character stat data** in this ticket — level/XP/achievements/gear stay live-only. Durable snapshot storage is Phase 4 (renumbered), consistent with how Phase 2 stayed persistence-free for the account summary.

## Goals

- A logged-in user can fetch level/XP/achievement-points/spec detail, achievement totals, and equipped gear for any of their characters via three new live endpoints.
- A logged-in user can persist a selection of which of their characters should be tracked, for the future scheduled job to read.
- The selection is durable (survives across sessions) and scoped to the owning user.
- Everything reuses existing auth, client, region/locale, and error-handling infrastructure — no new token-handling logic.

## Non-Goals

- Persisting any fetched character stat data (level, XP, achievements, equipment) — that's Phase 4 (historical storage), renumbered from the original roadmap.
- The scheduled aggregation job itself that will read `tracked_characters` and poll — that's the next phase after this one.
- Any UI/frontend for character selection.
- Solving the ~24h Battle.net access-token staleness constraint — acknowledged, deferred to the scheduled-job phase.
- A cap/limit on tracked characters per user.

## Proposed Solution

### 1. New Battle.net-backed routes (live, no persistence)

Extend `app/controllers/Profile.controller.ts` with `character`, `characterAchievements`, `characterEquipment` handlers, following `wow`'s existing shape (validate `locale`, call `BattleNetProfileClient`, passthrough JSON, map `needs_reauth` failures to `401`). Wire into `app/routes/Profile.routes.ts`, all behind `requireAuth`.

### 2. Shared locale validation

Move the locale zod enum out of `Profile.controller.ts` into `app/config/battlenet.locales.ts`; both existing and new handlers import it.

### 3. Tracked-characters persistence

- `app/database/schema/index.ts`: add `trackedCharacters` table (see shape above), matching the existing `pgTable`/`uuid`/`uniqueIndex` conventions used by `users`/`battlenetTokens`.
- `app/models/TrackedCharacter.model.ts`: `TrackedCharacterModel` with `listByUser(userId)`, `create({ userId, realmSlug, characterName })`, `deleteById(id, userId)` — Drizzle-backed, following `User.model.ts`'s pattern of plain async functions wrapping `getDb()`.
- New migration via `npm run db:migrate:generate`, plus a hand-written `.down.sql` per the README convention.

### 4. Tracking routes/controller

Add `listTrackedCharacters`, `addTrackedCharacter`, `removeTrackedCharacter` to `Profile.controller.ts` (or a new `TrackedCharacter.controller.ts` if it grows large enough to warrant splitting — tbd during implementation). `addTrackedCharacter` upserts on `(user_id, realm_slug, character_name)` — no Battle.net call, no ownership check.

## Acceptance Criteria

- [x] `GET /api/profile/wow/character/:realmSlug/:characterName` returns Battle.net's Character Profile Summary unmodified for a valid realm/name; requires auth; supports `?locale=`.
- [x] `GET .../achievements` and `GET .../equipment` behave the same way for their respective Battle.net endpoints.
- [x] All three propagate `needs_reauth` the same way `GET /api/profile/wow` does today.
- [x] `POST /api/profile/wow/tracked-characters` persists a `(user, realmSlug, characterName)` row with no validation against the caller's account summary — any realm/name pair is accepted.
- [x] Re-`POST`ing an already-tracked `(user, realmSlug, characterName)` is idempotent — returns `200` with the existing row, not an error.
- [x] `GET /api/profile/wow/tracked-characters` returns only the caller's own tracked characters.
- [x] `DELETE /api/profile/wow/tracked-characters/:id` removes a row only if it belongs to the caller (404 otherwise).
- [x] No character stat data (level/XP/achievements/equipment) is persisted anywhere by this ticket — only the tracking-selection rows.
- [x] Locale validation is shared across all four `/profile/wow*` GET endpoints via one constant, not duplicated per handler.

## Post-implementation notes

Recorded per the repo convention that PRDs are living documents. Four things were decided during implementation that the PRD above didn't specify:

- **Realm/character-name casing is normalized to lowercase**, in two places. Battle.net's character endpoints only match lowercase `characterName`, while Phase 2's account summary returns names capitalized — so a literal passthrough would 404 on the most natural frontend flow (read a name from `GET /api/profile/wow`, fetch its detail). Both the three live endpoints and the tracked-characters `POST` therefore lowercase (and, for the `POST`, trim) before use. Lowercasing is a no-op on already-lowercase input, so nothing is lost, and it makes the unique index behind the idempotency criterion meaningful — without it `Thrall` and `thrall` would occupy two rows.
- **Path segments are `encodeURIComponent`-escaped** when building the Battle.net URL, so non-ASCII character names (e.g. `Thörr`) work.
- **Tracking handlers live in their own `TrackedCharacter.controller.ts`**, not in `Profile.controller.ts` (the PRD left this "tbd during implementation"). They share no Battle.net/token machinery with the profile handlers, and `tracked-characters` is its own resource under the repo's one-controller-per-resource convention.
- **A malformed (non-UUID) `:id` on `DELETE` returns `404`, not `400`.** It keeps the handler to a single "no such row for you" path and avoids a Postgres `invalid input syntax for type uuid` error surfacing as a `500`.

Also of note:

- The shared `wow`/`character`/`characterAchievements`/`characterEquipment` behaviour (locale validation → client call → `needs_reauth` mapping) was extracted into one private `proxyProfileRequest` helper in `Profile.controller.ts` rather than duplicated four times. `ProfileController.wow`'s external behaviour is unchanged and its original tests still pass untouched.
- The `PRD.md` roadmap renumbering called for under Dependencies / Follow-ups was already applied before implementation started.
- Model-level behaviour that unit tests can't reach with mocked modules (idempotent `ON CONFLICT` insert, user-scoped delete, `ON DELETE CASCADE`, and the `.down.sql` rollback) was verified manually against the local Postgres instance.

## Open Questions

None outstanding — the three items raised during drafting (ownership validation, duplicate-`POST` behavior, `DELETE` key) are resolved above.

## Dependencies / Follow-ups

- **Depends on:** [wow-profile-summary.md](wow-profile-summary.md) (`BattleNetProfileClient`, region/locale pattern) and [battlenet-oauth-integration.md](battlenet-oauth-integration.md) (`RequireAuth`, `users` table).
- **Blocks:** the scheduled aggregation job (renumbered Phase 4), which will read `tracked_characters` to know what to poll, and must handle the ~24h `needs_reauth` staleness constraint noted above.
- **Requires a `PRD.md` roadmap update:** insert this ticket as the new Phase 3, renumbering the current Phase 3 ("Scheduled aggregation job") → Phase 4, Phase 4 ("Historical progress storage & query") → Phase 5, Phase 5 ("Multi-character/account-wide views") → Phase 6.
