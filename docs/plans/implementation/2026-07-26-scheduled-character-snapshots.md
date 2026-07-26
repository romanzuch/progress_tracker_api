# Scheduled Character Snapshots (CB-90) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A background job that polls every tracked WoW character on an adaptive schedule (30 minutes while the character is changing, backing off to 6 hours when it isn't) using the app-level Battle.net token, and persists one durable snapshot row per poll.

**Architecture:** Due-ness lives in the database, not in process memory: each `tracked_characters` row carries `next_poll_at` and `poll_interval_minutes`. A `setInterval` heartbeat (default every 5 minutes, off by default) calls one pure-ish service function, `runDueSnapshots()`, which selects only the due rows, fetches the three character endpoints per character through an app-token Axios client, hashes the three raw payloads to detect change, writes a `character_snapshots` row, and reschedules the character — active cadence on change, doubling toward the idle floor otherwise. The same service is exposed as a one-shot CLI entrypoint.

**Tech Stack:** Express 5, TypeScript (ESM), Postgres + Drizzle ORM, drizzle-kit migrations, Zod config validation, Axios, Vitest, `node:crypto` (sha256).

**Spec:** [docs/plans/prds/scheduled-character-snapshots.md](../prds/scheduled-character-snapshots.md) · Ticket: [CB-90](https://linear.app/romanzu/issue/CB-90/snapshot-tracked-characters-on-a-schedule)

## Global Constraints

- **Branch:** `romanzuchowski/cb-90-snapshot-tracked-characters-on-a-schedule` (the exact name Linear provides). Create it off `main` before Task 1.
- **ESM:** the project is `"type": "module"`. Every relative import ends in `.js` even though the source is `.ts`. No exceptions.
- **No `process.env` outside a `*.keys.ts` file.** New config is a `aggregation.keys.ts` / `aggregation.conf.ts` pair, zod-validated with `safeParse` and thrown with `z.prettifyError` at import time.
- **Region is a single source of truth.** Never hardcode `eu`/`us`/`profile-eu`. Everything region-scoped derives from `battlenet.conf.ts`'s `battlenetApiBaseUrl` / `battlenetProfileNamespace`.
- **All Battle.net traffic goes through `app/http/`.** No call site builds a Battle.net URL or handles a token.
- **The job uses the app-level (client-credentials) token only.** It must never read `battlenet_tokens`, call `getValidAccessToken`, or consult `needs_reauth`.
- **No custom error classes.** Errors are thrown as-is in the service and model layers; only the two job entrypoints (heartbeat tick, CLI script) catch and log.
- **`logger` has only `info` and `error`** (`app/utils/Logger.util.ts`). Where the PRD says "log a warning", use `logger.error`. Do not add a `warn` level in this ticket.
- **Config defaults:** `SNAPSHOT_JOB_ENABLED=false`, `SNAPSHOT_JOB_HEARTBEAT_MINUTES=5`, `SNAPSHOT_ACTIVE_INTERVAL_MINUTES=30`, `SNAPSHOT_IDLE_INTERVAL_MINUTES=360`. All defaulted so `tests/setup.ts` needs no new entries.
- **Tests are flat in `tests/`**, named `Xxx.<unit>.test.ts`, and mock at the module boundary with `vi.hoisted` + `vi.mock` + top-level `await import(...)`. No test DB, no real HTTP.
- **Before every commit:** `npm run build`, `npx eslint <changed files>`, `npm test` — all three must pass. Run `npm run format` if Prettier complains.
- **Commit messages:** imperative sentence-case summary, no `feat:`/`fix:` prefix, `(CB-90)` suffix on the first commit of a unit of work, and the trailer `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

## File Structure

**Create:**

| File | Responsibility |
| --- | --- |
| `app/config/aggregation.keys.ts` | Raw `process.env` reads for the four job vars |
| `app/config/aggregation.conf.ts` | Zod validation + cross-field interval checks; exports `aggregationConfig` |
| `app/http/BattleNetAppTokenClient.ts` | `createAppTokenClient()` — shared app-token attach + retry-once-on-401 interceptors |
| `app/http/BattleNetAppProfileClient.ts` | App-token Profile API client: the three character endpoint calls + path building |
| `app/models/CharacterSnapshot.model.ts` | `create()`, `findLatestHash()` over `character_snapshots` |
| `app/services/CharacterSnapshot.service.ts` | `runDueSnapshots()`, `nextPollInterval()`, metric extraction |
| `app/services/SnapshotScheduler.service.ts` | `startSnapshotScheduler()` — heartbeat timer, in-flight guard, error boundary |
| `app/utils/Hash.util.ts` | `sha256Json()` — the change-detection signal |
| `scripts/run-snapshot-job.ts` | One-shot CLI run (`npm run job:snapshot`) |
| `migrations/<tag>.sql` + `migrations/<tag>.down.sql` | Generated up migration + hand-written rollback |
| `tests/Aggregation.conf.test.ts` | Defaults and the two cross-field validation failures |
| `tests/Hash.util.test.ts` | Hash stability and sensitivity |
| `tests/BattleNetAppProfileClient.test.ts` | Path lowercasing/escaping |
| `tests/CharacterSnapshot.service.test.ts` | The run loop, adaptive rescheduling, failure isolation |
| `tests/SnapshotScheduler.service.test.ts` | Disabled no-op, in-flight skip, error boundary |

**Modify:**

| File | Change |
| --- | --- |
| `app/database/schema/index.ts` | Two new `trackedCharacters` columns + index; new `characterSnapshots` table |
| `app/models/TrackedCharacter.model.ts` | `listDue()`, `updateSchedule()`, two new interface fields |
| `app/http/BattleNetGameDataClient.ts` | Reduced to one line using the shared factory |
| `server.ts` | Call `startSnapshotScheduler()` |
| `package.json` | `"job:snapshot"` script |
| `README.md` | Env vars, manual run, off-by-default, adaptive cadence, single-instance caveat |
| `PRD.md` | Mark Phase 4 done; remove gold from the umbrella Goals |
| `docs/plans/prds/scheduled-character-snapshots.md` | Status → Implemented + post-implementation notes |

---

## Task 1: Aggregation config

**Files:**
- Create: `app/config/aggregation.keys.ts`, `app/config/aggregation.conf.ts`
- Test: `tests/Aggregation.conf.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `aggregationConfig: { snapshotJobEnabled: boolean; snapshotJobHeartbeatMinutes: number; snapshotActiveIntervalMinutes: number; snapshotIdleIntervalMinutes: number }` from `app/config/aggregation.conf.js`.

- [ ] **Step 1: Write the failing test**

`tests/Aggregation.conf.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';

// The conf module validates and throws at import time, so each case needs a
// fresh module graph with its own stubbed environment.
async function loadConfig() {
  vi.resetModules();
  return import('../app/config/aggregation.conf.js');
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('aggregationConfig', () => {
  it('defaults to a disabled job with a 5/30/360 minute cadence', async () => {
    const { aggregationConfig } = await loadConfig();

    expect(aggregationConfig).toEqual({
      snapshotJobEnabled: false,
      snapshotJobHeartbeatMinutes: 5,
      snapshotActiveIntervalMinutes: 30,
      snapshotIdleIntervalMinutes: 360,
    });
  });

  it('reads the environment when it is set', async () => {
    vi.stubEnv('SNAPSHOT_JOB_ENABLED', 'true');
    vi.stubEnv('SNAPSHOT_JOB_HEARTBEAT_MINUTES', '2');
    vi.stubEnv('SNAPSHOT_ACTIVE_INTERVAL_MINUTES', '15');
    vi.stubEnv('SNAPSHOT_IDLE_INTERVAL_MINUTES', '120');

    const { aggregationConfig } = await loadConfig();

    expect(aggregationConfig).toEqual({
      snapshotJobEnabled: true,
      snapshotJobHeartbeatMinutes: 2,
      snapshotActiveIntervalMinutes: 15,
      snapshotIdleIntervalMinutes: 120,
    });
  });

  it('rejects an active interval larger than the idle interval', async () => {
    vi.stubEnv('SNAPSHOT_ACTIVE_INTERVAL_MINUTES', '600');

    await expect(loadConfig()).rejects.toThrow(
      /SNAPSHOT_ACTIVE_INTERVAL_MINUTES/,
    );
  });

  it('rejects a heartbeat longer than the active interval', async () => {
    vi.stubEnv('SNAPSHOT_JOB_HEARTBEAT_MINUTES', '60');

    await expect(loadConfig()).rejects.toThrow(
      /SNAPSHOT_JOB_HEARTBEAT_MINUTES/,
    );
  });

  it('rejects a non-numeric interval', async () => {
    vi.stubEnv('SNAPSHOT_ACTIVE_INTERVAL_MINUTES', 'soon');

    await expect(loadConfig()).rejects.toThrow(
      /Invalid aggregation configuration/,
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run tests/Aggregation.conf.test.ts
```

Expected: FAIL — `Cannot find module '../app/config/aggregation.conf.js'`.

- [ ] **Step 3: Write the keys module**

`app/config/aggregation.keys.ts`:

```ts
export const aggregationKeys = {
  snapshotJobEnabled: process.env.SNAPSHOT_JOB_ENABLED ?? 'false',
  snapshotJobHeartbeatMinutes:
    process.env.SNAPSHOT_JOB_HEARTBEAT_MINUTES ?? '5',
  snapshotActiveIntervalMinutes:
    process.env.SNAPSHOT_ACTIVE_INTERVAL_MINUTES ?? '30',
  snapshotIdleIntervalMinutes:
    process.env.SNAPSHOT_IDLE_INTERVAL_MINUTES ?? '360',
};
```

- [ ] **Step 4: Write the conf module**

`app/config/aggregation.conf.ts`:

```ts
import { z } from 'zod';
import { aggregationKeys } from './aggregation.keys.js';

const booleanFromString = z
  .enum(['true', 'false'], {
    message: 'SNAPSHOT_JOB_ENABLED must be "true" or "false"',
  })
  .transform((value) => value === 'true');

const positiveMinutes = z.coerce.number().int().positive();

const aggregationConfigSchema = z
  .object({
    snapshotJobEnabled: booleanFromString,
    snapshotJobHeartbeatMinutes: positiveMinutes,
    snapshotActiveIntervalMinutes: positiveMinutes,
    snapshotIdleIntervalMinutes: positiveMinutes,
  })
  // A heartbeat longer than the active interval would silently cap the real
  // polling resolution, and an active interval above the idle floor would make
  // the backoff rule meaningless — both are config bugs, not preferences.
  .refine(
    (config) =>
      config.snapshotActiveIntervalMinutes <= config.snapshotIdleIntervalMinutes,
    {
      message:
        'SNAPSHOT_ACTIVE_INTERVAL_MINUTES must be less than or equal to SNAPSHOT_IDLE_INTERVAL_MINUTES',
    },
  )
  .refine(
    (config) =>
      config.snapshotJobHeartbeatMinutes <=
      config.snapshotActiveIntervalMinutes,
    {
      message:
        'SNAPSHOT_JOB_HEARTBEAT_MINUTES must be less than or equal to SNAPSHOT_ACTIVE_INTERVAL_MINUTES',
    },
  );

const parsed = aggregationConfigSchema.safeParse(aggregationKeys);

if (!parsed.success) {
  throw new Error(
    `Invalid aggregation configuration: ${z.prettifyError(parsed.error)}`,
  );
}

export const aggregationConfig = parsed.data;
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
npx vitest run tests/Aggregation.conf.test.ts
```

Expected: PASS (5 tests). If the two `.refine` messages don't reach the thrown string, check that `z.prettifyError` is being given `parsed.error` and not `parsed.error.issues`.

- [ ] **Step 6: Build, lint, full suite**

```bash
npm run build && npx eslint app/config/aggregation.keys.ts app/config/aggregation.conf.ts tests/Aggregation.conf.test.ts && npm test
```

- [ ] **Step 7: Commit**

```bash
git add app/config/aggregation.keys.ts app/config/aggregation.conf.ts tests/Aggregation.conf.test.ts && git commit -m "$(printf 'Add snapshot aggregation job config (CB-90)\n\nFour defaulted env vars behind the usual keys/conf split. The conf module\nvalidates heartbeat <= active <= idle, since a heartbeat longer than the\nactive interval would silently cap the real polling resolution.\n\nCo-Authored-By: Claude Opus 5 <noreply@anthropic.com>')"
```

---

## Task 2: App-token HTTP clients

**Files:**
- Create: `app/http/BattleNetAppTokenClient.ts`, `app/http/BattleNetAppProfileClient.ts`
- Modify: `app/http/BattleNetGameDataClient.ts` (replace the whole file)
- Test: `tests/BattleNetAppProfileClient.test.ts`

**Interfaces:**
- Consumes: `battlenetApiBaseUrl`, `battlenetProfileNamespace` (`app/config/battlenet.conf.js`); `getAppToken()`, `refreshAppToken()` (`app/services/BattleNetAppToken.service.js`).
- Produces:
  - `createAppTokenClient(): AxiosInstance` from `app/http/BattleNetAppTokenClient.js`
  - `type BattleNetPayload = Record<string, unknown>` and
    `battleNetAppProfileClient: { getCharacterProfile(realmSlug: string, characterName: string): Promise<BattleNetPayload>; getCharacterAchievements(realmSlug: string, characterName: string): Promise<BattleNetPayload>; getCharacterEquipment(realmSlug: string, characterName: string): Promise<BattleNetPayload> }`
    and `characterPath(realmSlug: string, characterName: string, suffix?: string): string` from `app/http/BattleNetAppProfileClient.js`

**Context:** `battleNetGameDataClient` has zero call sites in the repo today, so rewriting it on top of the shared factory cannot regress live behaviour. The interceptor logic being extracted is exactly what that file contains now — token attach on request, and on a 401 force-refresh the app token and retry once, guarded by `_retry`.

- [ ] **Step 1: Write the failing test**

`tests/BattleNetAppProfileClient.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';

// battlenet.conf throws at import time without BNET_* env vars, and the token
// service reads two more of its exports, so the mock has to be complete.
vi.mock('../app/config/battlenet.conf.js', () => ({
  battlenetConfig: {
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
    region: 'eu',
    redirectUri: 'http://localhost:3000/api/auth/battlenet/callback',
  },
  battlenetOauthBaseUrl: 'https://eu.battle.net/oauth',
  battlenetApiBaseUrl: 'https://eu.api.blizzard.com',
  battlenetProfileNamespace: 'profile-eu',
}));

const { characterPath } = await import(
  '../app/http/BattleNetAppProfileClient.js'
);

describe('characterPath', () => {
  it('lowercases the realm slug and character name', () => {
    expect(characterPath('Argent-Dawn', 'Thrall')).toBe(
      '/profile/wow/character/argent-dawn/thrall',
    );
  });

  it('appends a suffix for the sub-resources', () => {
    expect(characterPath('dun-morogh', 'sixfootfour', '/achievements')).toBe(
      '/profile/wow/character/dun-morogh/sixfootfour/achievements',
    );
  });

  it('escapes non-ASCII character names', () => {
    expect(characterPath('argent-dawn', 'Thörr', '/equipment')).toBe(
      '/profile/wow/character/argent-dawn/th%C3%B6rr/equipment',
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run tests/BattleNetAppProfileClient.test.ts
```

Expected: FAIL — `Cannot find module '../app/http/BattleNetAppProfileClient.js'`.

- [ ] **Step 3: Write the shared factory**

`app/http/BattleNetAppTokenClient.ts`:

```ts
import axios, {
  type AxiosInstance,
  type InternalAxiosRequestConfig,
} from 'axios';
import { battlenetApiBaseUrl } from '../config/battlenet.conf.js';
import {
  getAppToken,
  refreshAppToken,
} from '../services/BattleNetAppToken.service.js';

interface RetryableConfig extends InternalAxiosRequestConfig {
  _retry?: boolean;
}

// Shared by every app-level (client-credentials) Battle.net client: attach the
// cached app token, and if Battle.net rejects it, mint a fresh one and retry the
// request exactly once.
export function createAppTokenClient(): AxiosInstance {
  const client = axios.create({ baseURL: battlenetApiBaseUrl });

  client.interceptors.request.use(async (config) => {
    const token = await getAppToken();
    config.headers.set('Authorization', `Bearer ${token}`);
    return config;
  });

  client.interceptors.response.use(
    (response) => response,
    async (error: unknown) => {
      if (!axios.isAxiosError(error) || error.response?.status !== 401) {
        return Promise.reject(error);
      }

      const config = error.config as RetryableConfig | undefined;
      if (!config || config._retry) {
        return Promise.reject(error);
      }
      config._retry = true;

      const token = await refreshAppToken();
      config.headers.set('Authorization', `Bearer ${token}`);
      return client.request(config);
    },
  );

  return client;
}
```

- [ ] **Step 4: Rewrite the Game Data client on top of it**

Replace the entire contents of `app/http/BattleNetGameDataClient.ts` with:

```ts
import { createAppTokenClient } from './BattleNetAppTokenClient.js';

export const battleNetGameDataClient = createAppTokenClient();
```

- [ ] **Step 5: Write the app profile client**

`app/http/BattleNetAppProfileClient.ts`:

```ts
import { battlenetProfileNamespace } from '../config/battlenet.conf.js';
import { createAppTokenClient } from './BattleNetAppTokenClient.js';

export type BattleNetPayload = Record<string, unknown>;

const client = createAppTokenClient();

// Battle.net's character endpoints only match lowercase realm slugs and names,
// and character names can be non-ASCII (e.g. "Thörr").
function pathSegment(value: string): string {
  return encodeURIComponent(value.toLowerCase());
}

export function characterPath(
  realmSlug: string,
  characterName: string,
  suffix = '',
): string {
  return `/profile/wow/character/${pathSegment(realmSlug)}/${pathSegment(
    characterName,
  )}${suffix}`;
}

async function getProfilePath(path: string): Promise<BattleNetPayload> {
  const { data } = await client.get<BattleNetPayload>(path, {
    params: { namespace: battlenetProfileNamespace, locale: 'en_US' },
  });
  return data;
}

// The same three endpoints the live Phase 3 routes proxy, but read with the
// app-level token so no user session is involved.
export const battleNetAppProfileClient = {
  getCharacterProfile(
    realmSlug: string,
    characterName: string,
  ): Promise<BattleNetPayload> {
    return getProfilePath(characterPath(realmSlug, characterName));
  },

  getCharacterAchievements(
    realmSlug: string,
    characterName: string,
  ): Promise<BattleNetPayload> {
    return getProfilePath(
      characterPath(realmSlug, characterName, '/achievements'),
    );
  },

  getCharacterEquipment(
    realmSlug: string,
    characterName: string,
  ): Promise<BattleNetPayload> {
    return getProfilePath(characterPath(realmSlug, characterName, '/equipment'));
  },
};
```

- [ ] **Step 6: Run the test to verify it passes**

```bash
npx vitest run tests/BattleNetAppProfileClient.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 7: Build, lint, full suite**

```bash
npm run build && npx eslint app/http/BattleNetAppTokenClient.ts app/http/BattleNetAppProfileClient.ts app/http/BattleNetGameDataClient.ts tests/BattleNetAppProfileClient.test.ts && npm test
```

- [ ] **Step 8: Commit**

```bash
git add app/http tests/BattleNetAppProfileClient.test.ts && git commit -m "$(printf 'Add app-token Profile API client and share the token interceptors\n\nExtracts the app-token attach + retry-once-on-401 interceptors out of\nBattleNetGameDataClient into a createAppTokenClient() factory, and adds\nBattleNetAppProfileClient for the three character endpoints with the\nprofile-{region} namespace defaulted. The character endpoints serve public\narmory data, so a client-credentials token is enough — verified against\nlive endpoints during PRD drafting.\n\nCo-Authored-By: Claude Opus 5 <noreply@anthropic.com>')"
```

---

## Task 3: Schema, migration, and models

**Files:**
- Modify: `app/database/schema/index.ts`, `app/models/TrackedCharacter.model.ts`
- Create: `app/models/CharacterSnapshot.model.ts`, `migrations/<tag>.sql` (generated), `migrations/<tag>.down.sql` (hand-written)

**Interfaces:**
- Consumes: `getDb()` (`app/database/index.js`), `users` (`app/database/schema/index.js`).
- Produces:
  - `characterSnapshots` and the two new `trackedCharacters` columns from `app/database/schema/index.js`
  - `interface TrackedCharacter` gains `nextPollAt: Date` and `pollIntervalMinutes: number`
  - `TrackedCharacterModel.listDue(now: Date): Promise<TrackedCharacter[]>`
  - `TrackedCharacterModel.updateSchedule(id: string, schedule: { nextPollAt: Date; pollIntervalMinutes: number }): Promise<void>`
  - `CharacterSnapshotModel.create(data: CharacterSnapshotInput): Promise<CharacterSnapshot>`
  - `CharacterSnapshotModel.findLatestHash(identity: { userId: string; realmSlug: string; characterName: string }): Promise<string | undefined>`
  - `interface CharacterSnapshotInput` (see Step 4)

**Context:** `character_snapshots` deliberately has **no foreign key to `tracked_characters`** — a cascade there would delete a character's whole history the moment the user untracked it. It is keyed by the natural identity (`user_id` + `realm_slug` + `character_name`), with a `user_id` FK to `users` so cascade-on-user-delete still works. There is no unit-testable surface here (mocked modules can't reach Drizzle), so this task's verification is `npm run build` plus the manual Postgres check in Step 6.

- [ ] **Step 1: Extend `trackedCharacters`**

In `app/database/schema/index.ts`, add `index` and `integer` and `jsonb` to the `drizzle-orm/pg-core` import:

```ts
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
```

Then add the two columns and the index to the existing `trackedCharacters` table (leave `id`, `userId`, `realmSlug`, `characterName`, `createdAt` and the unique index exactly as they are):

```ts
export const trackedCharacters = pgTable(
  'tracked_characters',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    realmSlug: text('realm_slug').notNull(),
    characterName: text('character_name').notNull(),
    // Due immediately, at the active cadence: a newly tracked character is
    // picked up on the next heartbeat and polls fast until it proves idle.
    // The literal 30 mirrors SNAPSHOT_ACTIVE_INTERVAL_MINUTES' default — a
    // column default has to be a constant, so config can't be read here.
    nextPollAt: timestamp('next_poll_at').defaultNow().notNull(),
    pollIntervalMinutes: integer('poll_interval_minutes').notNull().default(30),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('tracked_characters_user_id_realm_slug_character_name_idx').on(
      table.userId,
      table.realmSlug,
      table.characterName,
    ),
    index('tracked_characters_next_poll_at_idx').on(table.nextPollAt),
  ],
);
```

- [ ] **Step 2: Add the `characterSnapshots` table**

Append to `app/database/schema/index.ts`:

```ts
// One row per character per successful poll. Typed columns keep Phase 5's trend
// queries cheap; the raw payloads mean a metric nobody thought of today can be
// extracted from existing history later — impossible otherwise, since Battle.net
// serves only current state. Metrics are nullable because payloads vary by
// character state and a missing field must degrade to null, not fail the write.
export const characterSnapshots = pgTable(
  'character_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    realmSlug: text('realm_slug').notNull(),
    characterName: text('character_name').notNull(),
    capturedAt: timestamp('captured_at').defaultNow().notNull(),
    payloadHash: text('payload_hash').notNull(),
    level: integer('level'),
    experience: integer('experience'),
    achievementPoints: integer('achievement_points'),
    achievementsCompleted: integer('achievements_completed'),
    averageItemLevel: integer('average_item_level'),
    equippedItemLevel: integer('equipped_item_level'),
    lastLoginAt: timestamp('last_login_at'),
    profilePayload: jsonb('profile_payload').notNull(),
    achievementsPayload: jsonb('achievements_payload').notNull(),
    equipmentPayload: jsonb('equipment_payload').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    // Serves both this ticket's "previous hash" lookup and Phase 5's history
    // queries. No FK to tracked_characters on purpose — see the PRD.
    index('character_snapshots_character_captured_at_idx').on(
      table.userId,
      table.realmSlug,
      table.characterName,
      table.capturedAt.desc(),
    ),
  ],
);
```

- [ ] **Step 3: Extend `TrackedCharacterModel`**

In `app/models/TrackedCharacter.model.ts`, widen the import to `import { and, eq, lte } from 'drizzle-orm';`, add the two fields to the interface, and add the two functions. Leave `listByUser`, `create`, and `deleteById` untouched.

```ts
export interface TrackedCharacter {
  id: string;
  userId: string;
  realmSlug: string;
  characterName: string;
  nextPollAt: Date;
  pollIntervalMinutes: number;
  createdAt: Date;
}
```

```ts
  // Every user's due characters in one query — the job is global, not per-user.
  async listDue(now: Date): Promise<TrackedCharacter[]> {
    return getDb()
      .select()
      .from(trackedCharacters)
      .where(lte(trackedCharacters.nextPollAt, now))
      .orderBy(trackedCharacters.nextPollAt);
  },

  async updateSchedule(
    id: string,
    schedule: { nextPollAt: Date; pollIntervalMinutes: number },
  ): Promise<void> {
    await getDb()
      .update(trackedCharacters)
      .set(schedule)
      .where(eq(trackedCharacters.id, id));
  },
```

- [ ] **Step 4: Write the snapshot model**

`app/models/CharacterSnapshot.model.ts`:

```ts
import { and, desc, eq } from 'drizzle-orm';
import { getDb } from '../database/index.js';
import { characterSnapshots } from '../database/schema/index.js';

export interface CharacterSnapshot {
  id: string;
  userId: string;
  realmSlug: string;
  characterName: string;
  capturedAt: Date;
  payloadHash: string;
  level: number | null;
  experience: number | null;
  achievementPoints: number | null;
  achievementsCompleted: number | null;
  averageItemLevel: number | null;
  equippedItemLevel: number | null;
  lastLoginAt: Date | null;
  profilePayload: unknown;
  achievementsPayload: unknown;
  equipmentPayload: unknown;
  createdAt: Date;
}

export interface CharacterSnapshotInput {
  userId: string;
  realmSlug: string;
  characterName: string;
  payloadHash: string;
  level: number | null;
  experience: number | null;
  achievementPoints: number | null;
  achievementsCompleted: number | null;
  averageItemLevel: number | null;
  equippedItemLevel: number | null;
  lastLoginAt: Date | null;
  profilePayload: unknown;
  achievementsPayload: unknown;
  equipmentPayload: unknown;
}

export const CharacterSnapshotModel = {
  async create(data: CharacterSnapshotInput): Promise<CharacterSnapshot> {
    const [snapshot] = await getDb()
      .insert(characterSnapshots)
      .values(data)
      .returning();
    return snapshot;
  },

  // The change signal: undefined on a character's first-ever poll, which the
  // service treats as "changed" so it starts at the active cadence.
  async findLatestHash(identity: {
    userId: string;
    realmSlug: string;
    characterName: string;
  }): Promise<string | undefined> {
    const [row] = await getDb()
      .select({ payloadHash: characterSnapshots.payloadHash })
      .from(characterSnapshots)
      .where(
        and(
          eq(characterSnapshots.userId, identity.userId),
          eq(characterSnapshots.realmSlug, identity.realmSlug),
          eq(characterSnapshots.characterName, identity.characterName),
        ),
      )
      .orderBy(desc(characterSnapshots.capturedAt))
      .limit(1);
    return row?.payloadHash;
  },
};
```

- [ ] **Step 5: Generate the migration and hand-write the rollback**

```bash
npm run db:migrate:generate
```

Note the generated tag (e.g. `0005_lively_moon`). Confirm the generated `migrations/<tag>.sql` contains `CREATE TABLE "character_snapshots"`, both `ALTER TABLE "tracked_characters" ADD COLUMN` statements, and both `CREATE INDEX` statements. Then write `migrations/<tag>.down.sql` — dropping the table takes its index with it, so only the `tracked_characters` index needs an explicit drop:

```sql
DROP TABLE "character_snapshots";--> statement-breakpoint
DROP INDEX "tracked_characters_next_poll_at_idx";--> statement-breakpoint
ALTER TABLE "tracked_characters" DROP COLUMN "next_poll_at";--> statement-breakpoint
ALTER TABLE "tracked_characters" DROP COLUMN "poll_interval_minutes";
```

- [ ] **Step 6: Verify the migration applies and rolls back**

```bash
npm run db:up && npm run db:migrate:up && npm run db:migrate:down && npm run db:migrate:up
```

Expected: the up applies cleanly, `db:migrate:down` prints `Rolled back migration: <tag>`, and the second up re-applies it. Then confirm the shape and the cascade behaviour by hand (`DATABASE_URL` is in `.env`):

```bash
psql "$DATABASE_URL" -c '\d character_snapshots' -c '\d tracked_characters'
```

Expected: `character_snapshots` shows the `user_id` FK with `ON DELETE CASCADE`, no FK to `tracked_characters`, and the composite index with `captured_at DESC`; `tracked_characters` shows `next_poll_at` defaulting to `now()`, `poll_interval_minutes` defaulting to `30`, and the new index.

- [ ] **Step 7: Build, lint, full suite**

```bash
npm run build && npx eslint app/database/schema/index.ts app/models/TrackedCharacter.model.ts app/models/CharacterSnapshot.model.ts && npm test
```

If `table.capturedAt.desc()` fails to typecheck, drop the `.desc()` — Postgres scans a btree backwards, so an all-ascending index serves `ORDER BY captured_at DESC` equally well — and record the deviation for the PRD post-implementation note in Task 8.

- [ ] **Step 8: Commit**

```bash
git add app/database/schema/index.ts app/models migrations && git commit -m "$(printf 'Add character_snapshots table and per-character poll schedule (CB-90)\n\ntracked_characters gains next_poll_at and poll_interval_minutes so due-ness\nlives in the database — a redeploy cannot cause a polling burst, and no\nbackfill is needed because the column defaults make existing rows due\nimmediately at the active cadence.\n\ncharacter_snapshots stores the typed metrics a frontend would graph plus all\nthree raw Battle.net payloads. It is keyed by user_id + realm_slug +\ncharacter_name with no FK to tracked_characters: a cascade there would\ndestroy a character history the moment it was untracked.\n\nCo-Authored-By: Claude Opus 5 <noreply@anthropic.com>')"
```

---

## Task 4: Change signal and the adaptive rule

**Files:**
- Create: `app/utils/Hash.util.ts`, `app/services/CharacterSnapshot.service.ts` (first slice: `nextPollInterval` only)
- Test: `tests/Hash.util.test.ts`, `tests/CharacterSnapshot.service.test.ts` (first slice)

**Interfaces:**
- Consumes: `aggregationConfig` (Task 1).
- Produces:
  - `sha256Json(value: unknown): string` from `app/utils/Hash.util.js`
  - `nextPollInterval(currentIntervalMinutes: number, changed: boolean): number` from `app/services/CharacterSnapshot.service.js`

- [ ] **Step 1: Write the failing hash test**

`tests/Hash.util.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { sha256Json } from '../app/utils/Hash.util.js';

describe('sha256Json', () => {
  it('returns the same digest for identical payloads', () => {
    const payloads = [
      { level: 80, experience: 0 },
      { total_quantity: 1234 },
      { equipped_items: [{ slot: { type: 'HEAD' } }] },
    ];

    expect(sha256Json(payloads)).toBe(sha256Json(structuredClone(payloads)));
  });

  it('returns a different digest when any payload changes', () => {
    const before = sha256Json([{ level: 80 }, {}, {}]);
    const after = sha256Json([{ level: 81 }, {}, {}]);

    expect(after).not.toBe(before);
  });

  it('detects a change that moves no numeric metric', () => {
    const before = sha256Json([{ level: 80 }, {}, { item_level: 620 }]);
    const after = sha256Json([{ level: 80 }, {}, { item_level: 625 }]);

    expect(after).not.toBe(before);
  });

  it('produces a 64-character hex digest', () => {
    expect(sha256Json({})).toMatch(/^[0-9a-f]{64}$/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run tests/Hash.util.test.ts
```

Expected: FAIL — `Cannot find module '../app/utils/Hash.util.js'`.

- [ ] **Step 3: Write the hash util**

`app/utils/Hash.util.ts`:

```ts
import { createHash } from 'node:crypto';

// Change-detection signal for Battle.net payloads. JSON.stringify preserves the
// key order Blizzard sends, so two identical responses hash identically; if some
// field ever churns on its own, the only cost is polling that character every 30
// minutes instead of every 6 hours.
export function sha256Json(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
```

- [ ] **Step 4: Run it to verify it passes**

```bash
npx vitest run tests/Hash.util.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 5: Write the failing `nextPollInterval` test**

Create `tests/CharacterSnapshot.service.test.ts` with the full mock scaffolding (Task 5 adds more tests to this same file, so set it up completely now):

```ts
import { describe, expect, it, vi } from 'vitest';
// Not mocked — the tests compute the hash the service is expected to produce.
import { sha256Json } from '../app/utils/Hash.util.js';

const {
  listDueMock,
  updateScheduleMock,
  createSnapshotMock,
  findLatestHashMock,
  getCharacterProfileMock,
  getCharacterAchievementsMock,
  getCharacterEquipmentMock,
  aggregationConfig,
} = vi.hoisted(() => ({
  listDueMock: vi.fn(),
  updateScheduleMock: vi.fn(),
  createSnapshotMock: vi.fn(),
  findLatestHashMock: vi.fn(),
  getCharacterProfileMock: vi.fn(),
  getCharacterAchievementsMock: vi.fn(),
  getCharacterEquipmentMock: vi.fn(),
  aggregationConfig: {
    snapshotJobEnabled: false,
    snapshotJobHeartbeatMinutes: 5,
    snapshotActiveIntervalMinutes: 30,
    snapshotIdleIntervalMinutes: 360,
  },
}));

vi.mock('../app/config/aggregation.conf.js', () => ({ aggregationConfig }));

vi.mock('../app/models/TrackedCharacter.model.js', () => ({
  TrackedCharacterModel: {
    listDue: listDueMock,
    updateSchedule: updateScheduleMock,
  },
}));

vi.mock('../app/models/CharacterSnapshot.model.js', () => ({
  CharacterSnapshotModel: {
    create: createSnapshotMock,
    findLatestHash: findLatestHashMock,
  },
}));

// Mocking the client module means battlenet.conf is never loaded, so the suite
// needs no BNET_* env vars.
vi.mock('../app/http/BattleNetAppProfileClient.js', () => ({
  battleNetAppProfileClient: {
    getCharacterProfile: getCharacterProfileMock,
    getCharacterAchievements: getCharacterAchievementsMock,
    getCharacterEquipment: getCharacterEquipmentMock,
  },
}));

const { nextPollInterval } = await import(
  '../app/services/CharacterSnapshot.service.js'
);

describe('nextPollInterval', () => {
  it('resets to the active interval when the character changed', () => {
    expect(nextPollInterval(360, true)).toBe(30);
  });

  it('doubles the interval when nothing changed', () => {
    expect(nextPollInterval(30, false)).toBe(60);
    expect(nextPollInterval(120, false)).toBe(240);
  });

  it('caps the backoff at the idle floor', () => {
    expect(nextPollInterval(240, false)).toBe(360);
    expect(nextPollInterval(360, false)).toBe(360);
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

```bash
npx vitest run tests/CharacterSnapshot.service.test.ts
```

Expected: FAIL — `Cannot find module '../app/services/CharacterSnapshot.service.js'`.

- [ ] **Step 7: Write the first slice of the service**

`app/services/CharacterSnapshot.service.ts`:

```ts
import { aggregationConfig } from '../config/aggregation.conf.js';

export interface SnapshotRunSummary {
  due: number;
  succeeded: number;
  failed: number;
}

// The whole adaptive-cadence rule: a character that changed gets the fast
// cadence again, one that didn't backs off toward the idle floor. Doubling
// rather than jumping straight to the floor, so a brief lull mid-session
// doesn't cost the rest of the session's resolution.
export function nextPollInterval(
  currentIntervalMinutes: number,
  changed: boolean,
): number {
  if (changed) {
    return aggregationConfig.snapshotActiveIntervalMinutes;
  }

  return Math.min(
    currentIntervalMinutes * 2,
    aggregationConfig.snapshotIdleIntervalMinutes,
  );
}
```

`SnapshotRunSummary` is declared here because it's this service's public return
type; Task 5 adds the `runDueSnapshots` that produces it.

- [ ] **Step 8: Run it to verify it passes**

```bash
npx vitest run tests/CharacterSnapshot.service.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 9: Build, lint, commit**

```bash
npm run build && npx eslint app/utils/Hash.util.ts app/services/CharacterSnapshot.service.ts tests/Hash.util.test.ts tests/CharacterSnapshot.service.test.ts && npm test
```

```bash
git add app/utils/Hash.util.ts app/services/CharacterSnapshot.service.ts tests/Hash.util.test.ts tests/CharacterSnapshot.service.test.ts && git commit -m "$(printf 'Add the payload hash signal and the adaptive interval rule (CB-90)\n\nHashing the three raw payloads, rather than comparing the typed metrics,\nis what makes activity detection work for a max-level character: an evening\nof raiding moves no XP and no level, so metric comparison would read it as\nidle and pin it at 6-hour polling.\n\nCo-Authored-By: Claude Opus 5 <noreply@anthropic.com>')"
```

---

## Task 5: The snapshot run

**Files:**
- Modify: `app/services/CharacterSnapshot.service.ts` (add `runDueSnapshots` and its helpers)
- Test: `tests/CharacterSnapshot.service.test.ts` (append)

**Interfaces:**
- Consumes: `battleNetAppProfileClient`, `BattleNetPayload` (Task 2); `TrackedCharacterModel.listDue`/`updateSchedule`, `TrackedCharacter`, `CharacterSnapshotModel.create`/`findLatestHash` (Task 3); `sha256Json`, `nextPollInterval` (Task 4); `logger`.
- Produces: `runDueSnapshots(): Promise<SnapshotRunSummary>` where `SnapshotRunSummary = { due: number; succeeded: number; failed: number }`.

- [ ] **Step 1: Write the failing tests**

In `tests/CharacterSnapshot.service.test.ts`, add `beforeEach` to the `vitest`
import and `runDueSnapshots` to the destructured dynamic import:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
```

```ts
const { nextPollInterval, runDueSnapshots } = await import(
  '../app/services/CharacterSnapshot.service.js'
);
```

Then append:

```ts
const PROFILE = {
  level: 80,
  experience: 0,
  achievement_points: 14500,
  average_item_level: 632,
  equipped_item_level: 628,
  last_login_timestamp: 1_753_500_000_000,
};
const ACHIEVEMENTS = { total_quantity: 1234, total_points: 14500 };
const EQUIPMENT = { equipped_items: [{ slot: { type: 'HEAD' } }] };

function trackedCharacter(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: 'tracked-1',
    userId: 'user-1',
    realmSlug: 'dun-morogh',
    characterName: 'sixfootfour',
    nextPollAt: new Date('2026-07-26T10:00:00Z'),
    pollIntervalMinutes: 30,
    createdAt: new Date('2026-07-01T10:00:00Z'),
    ...overrides,
  };
}

function scheduleFor(id: string): {
  nextPollAt: Date;
  pollIntervalMinutes: number;
} {
  const call = updateScheduleMock.mock.calls.find(([callId]) => callId === id);
  if (!call) {
    throw new Error(`updateSchedule was never called for ${id}`);
  }
  return call[1];
}

describe('runDueSnapshots', () => {
  beforeEach(() => {
    listDueMock.mockReset();
    updateScheduleMock.mockReset().mockResolvedValue(undefined);
    createSnapshotMock.mockReset().mockResolvedValue({ id: 'snapshot-1' });
    findLatestHashMock.mockReset().mockResolvedValue(undefined);
    getCharacterProfileMock.mockReset().mockResolvedValue(PROFILE);
    getCharacterAchievementsMock.mockReset().mockResolvedValue(ACHIEVEMENTS);
    getCharacterEquipmentMock.mockReset().mockResolvedValue(EQUIPMENT);
  });

  it('is a clean no-op when nothing is due', async () => {
    listDueMock.mockResolvedValue([]);

    const summary = await runDueSnapshots();

    expect(summary).toEqual({ due: 0, succeeded: 0, failed: 0 });
    expect(getCharacterProfileMock).not.toHaveBeenCalled();
    expect(createSnapshotMock).not.toHaveBeenCalled();
    expect(updateScheduleMock).not.toHaveBeenCalled();
  });

  it('persists one row per due character with metrics and all three payloads', async () => {
    listDueMock.mockResolvedValue([trackedCharacter()]);

    const summary = await runDueSnapshots();

    expect(summary).toEqual({ due: 1, succeeded: 1, failed: 0 });
    expect(createSnapshotMock).toHaveBeenCalledTimes(1);
    expect(createSnapshotMock).toHaveBeenCalledWith({
      userId: 'user-1',
      realmSlug: 'dun-morogh',
      characterName: 'sixfootfour',
      payloadHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      level: 80,
      experience: 0,
      achievementPoints: 14500,
      achievementsCompleted: 1234,
      averageItemLevel: 632,
      equippedItemLevel: 628,
      lastLoginAt: new Date(1_753_500_000_000),
      profilePayload: PROFILE,
      achievementsPayload: ACHIEVEMENTS,
      equipmentPayload: EQUIPMENT,
    });
  });

  it('degrades missing metric fields to null instead of failing the snapshot', async () => {
    listDueMock.mockResolvedValue([trackedCharacter()]);
    getCharacterProfileMock.mockResolvedValue({ level: 12 });
    getCharacterAchievementsMock.mockResolvedValue({});

    const summary = await runDueSnapshots();

    expect(summary).toEqual({ due: 1, succeeded: 1, failed: 0 });
    expect(createSnapshotMock).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 12,
        experience: null,
        achievementPoints: null,
        achievementsCompleted: null,
        averageItemLevel: null,
        equippedItemLevel: null,
        lastLoginAt: null,
      }),
    );
  });

  it('reschedules a changed character at the active interval', async () => {
    listDueMock.mockResolvedValue([trackedCharacter({ pollIntervalMinutes: 360 })]);
    findLatestHashMock.mockResolvedValue('a-different-hash');

    await runDueSnapshots();

    const { nextPollAt, pollIntervalMinutes } = scheduleFor('tracked-1');
    expect(pollIntervalMinutes).toBe(30);
    expect(nextPollAt.getTime() - Date.now()).toBeGreaterThan(29 * 60_000);
    expect(nextPollAt.getTime() - Date.now()).toBeLessThanOrEqual(30 * 60_000);
  });

  it('doubles the interval when the payload hash is unchanged', async () => {
    listDueMock.mockResolvedValue([trackedCharacter()]);
    // The hash the service will compute from these same payloads.
    findLatestHashMock.mockResolvedValue(
      sha256Json([PROFILE, ACHIEVEMENTS, EQUIPMENT]),
    );

    await runDueSnapshots();

    expect(scheduleFor('tracked-1').pollIntervalMinutes).toBe(60);
  });

  it('treats a first-ever poll as changed', async () => {
    listDueMock.mockResolvedValue([trackedCharacter({ pollIntervalMinutes: 360 })]);
    findLatestHashMock.mockResolvedValue(undefined);

    await runDueSnapshots();

    expect(scheduleFor('tracked-1').pollIntervalMinutes).toBe(30);
  });

  it('isolates a failing character, still reschedules it, and finishes the run', async () => {
    listDueMock.mockResolvedValue([
      trackedCharacter({ id: 'tracked-gone', characterName: 'renamed' }),
      trackedCharacter({ id: 'tracked-ok' }),
    ]);
    getCharacterProfileMock.mockRejectedValueOnce(
      new Error('Request failed with status code 404'),
    );

    const summary = await runDueSnapshots();

    expect(summary).toEqual({ due: 2, succeeded: 1, failed: 1 });
    expect(createSnapshotMock).toHaveBeenCalledTimes(1);
    expect(createSnapshotMock).toHaveBeenCalledWith(
      expect.objectContaining({ characterName: 'sixfootfour' }),
    );
    // Backoff on failure — otherwise a permanently 404ing character is retried
    // on every single heartbeat forever.
    expect(scheduleFor('tracked-gone').pollIntervalMinutes).toBe(60);
    expect(scheduleFor('tracked-ok').pollIntervalMinutes).toBe(30);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run tests/CharacterSnapshot.service.test.ts
```

Expected: FAIL — `does not provide an export named 'runDueSnapshots'`.

- [ ] **Step 3: Implement the run**

Add `runDueSnapshots`, its helpers, and the new imports to `app/services/CharacterSnapshot.service.ts`. The finished file:

```ts
import { aggregationConfig } from '../config/aggregation.conf.js';
import {
  battleNetAppProfileClient,
  type BattleNetPayload,
} from '../http/BattleNetAppProfileClient.js';
import { CharacterSnapshotModel } from '../models/CharacterSnapshot.model.js';
import {
  TrackedCharacterModel,
  type TrackedCharacter,
} from '../models/TrackedCharacter.model.js';
import { sha256Json } from '../utils/Hash.util.js';
import { logger } from '../utils/Logger.util.js';

export interface SnapshotRunSummary {
  due: number;
  succeeded: number;
  failed: number;
}

// The whole adaptive-cadence rule: a character that changed gets the fast
// cadence again, one that didn't backs off toward the idle floor. Doubling
// rather than jumping straight to the floor, so a brief lull mid-session
// doesn't cost the rest of the session's resolution.
export function nextPollInterval(
  currentIntervalMinutes: number,
  changed: boolean,
): number {
  if (changed) {
    return aggregationConfig.snapshotActiveIntervalMinutes;
  }

  return Math.min(
    currentIntervalMinutes * 2,
    aggregationConfig.snapshotIdleIntervalMinutes,
  );
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}

function timestampOrNull(value: unknown): Date | null {
  return typeof value === 'number' ? new Date(value) : null;
}

function extractMetrics(
  profile: BattleNetPayload,
  achievements: BattleNetPayload,
) {
  return {
    level: numberOrNull(profile.level),
    experience: numberOrNull(profile.experience),
    achievementPoints: numberOrNull(profile.achievement_points),
    achievementsCompleted: numberOrNull(achievements.total_quantity),
    averageItemLevel: numberOrNull(profile.average_item_level),
    equippedItemLevel: numberOrNull(profile.equipped_item_level),
    lastLoginAt: timestampOrNull(profile.last_login_timestamp),
  };
}

async function reschedule(
  character: TrackedCharacter,
  changed: boolean,
): Promise<void> {
  const pollIntervalMinutes = nextPollInterval(
    character.pollIntervalMinutes,
    changed,
  );

  await TrackedCharacterModel.updateSchedule(character.id, {
    nextPollAt: new Date(Date.now() + pollIntervalMinutes * 60_000),
    pollIntervalMinutes,
  });
}

async function snapshotCharacter(character: TrackedCharacter): Promise<void> {
  const { userId, realmSlug, characterName } = character;

  const [profile, achievements, equipment] = await Promise.all([
    battleNetAppProfileClient.getCharacterProfile(realmSlug, characterName),
    battleNetAppProfileClient.getCharacterAchievements(
      realmSlug,
      characterName,
    ),
    battleNetAppProfileClient.getCharacterEquipment(realmSlug, characterName),
  ]);

  const payloadHash = sha256Json([profile, achievements, equipment]);
  const previousHash = await CharacterSnapshotModel.findLatestHash({
    userId,
    realmSlug,
    characterName,
  });

  await CharacterSnapshotModel.create({
    userId,
    realmSlug,
    characterName,
    payloadHash,
    ...extractMetrics(profile, achievements),
    profilePayload: profile,
    achievementsPayload: achievements,
    equipmentPayload: equipment,
  });

  // No previous hash means a first-ever poll, which counts as changed so the
  // character starts out on the fast cadence.
  await reschedule(character, payloadHash !== previousHash);
}

// Polls every tracked character whose next_poll_at has come due, across all
// users, using the app-level token — no user session, login, or needs_reauth
// state is involved. Characters are polled sequentially (Blizzard's rate ceiling
// is orders of magnitude above this volume, and sequential execution keeps
// failure attribution obvious), with each character's three endpoint calls
// issued in parallel.
export async function runDueSnapshots(): Promise<SnapshotRunSummary> {
  const due = await TrackedCharacterModel.listDue(new Date());

  if (due.length === 0) {
    logger.info('[snapshots] no characters due');
    return { due: 0, succeeded: 0, failed: 0 };
  }

  let succeeded = 0;
  let failed = 0;

  for (const character of due) {
    try {
      await snapshotCharacter(character);
      succeeded += 1;
    } catch (err) {
      failed += 1;
      logger.error(
        `[snapshots] ${character.realmSlug}/${character.characterName} failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      // A renamed, transferred, or deleted character 404s forever. Back it off
      // anyway, or it stays due on every heartbeat.
      await reschedule(character, false);
    }
  }

  const summary = { due: due.length, succeeded, failed };
  logger.info(
    `[snapshots] run complete: due=${summary.due} succeeded=${summary.succeeded} failed=${summary.failed}`,
  );
  return summary;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run tests/CharacterSnapshot.service.test.ts
```

Expected: PASS (10 tests).

- [ ] **Step 5: Build, lint, full suite**

```bash
npm run build && npx eslint app/services/CharacterSnapshot.service.ts tests/CharacterSnapshot.service.test.ts && npm test
```

- [ ] **Step 6: Commit**

```bash
git add app/services/CharacterSnapshot.service.ts tests/CharacterSnapshot.service.test.ts && git commit -m "$(printf 'Snapshot due characters with per-character isolation (CB-90)\n\nrunDueSnapshots polls only the characters whose next_poll_at has come due,\nacross all users, with the app-level token — so snapshots keep flowing for a\nuser whose Battle.net session expired. Each character is wrapped in its own\ntry/catch and is rescheduled even when its fetch fails, so one dead character\nneither aborts the run nor stays permanently due.\n\nCo-Authored-By: Claude Opus 5 <noreply@anthropic.com>')"
```

---

## Task 6: Scheduler and server wiring

**Files:**
- Create: `app/services/SnapshotScheduler.service.ts`
- Modify: `server.ts`
- Test: `tests/SnapshotScheduler.service.test.ts`

**Interfaces:**
- Consumes: `aggregationConfig` (Task 1), `runDueSnapshots` (Task 5), `logger`.
- Produces: `startSnapshotScheduler(): NodeJS.Timeout | undefined` from `app/services/SnapshotScheduler.service.js` — returns `undefined` when the job is disabled, otherwise the heartbeat timer (returned so tests can clear it).

- [ ] **Step 1: Write the failing test**

`tests/SnapshotScheduler.service.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { runDueSnapshotsMock, aggregationConfig } = vi.hoisted(() => ({
  runDueSnapshotsMock: vi.fn(),
  aggregationConfig: {
    snapshotJobEnabled: true,
    snapshotJobHeartbeatMinutes: 5,
    snapshotActiveIntervalMinutes: 30,
    snapshotIdleIntervalMinutes: 360,
  },
}));

vi.mock('../app/config/aggregation.conf.js', () => ({ aggregationConfig }));
vi.mock('../app/services/CharacterSnapshot.service.js', () => ({
  runDueSnapshots: runDueSnapshotsMock,
}));

const HEARTBEAT_MS = 5 * 60_000;

// The in-flight guard is module-level state, so each test gets a fresh module.
async function loadScheduler() {
  vi.resetModules();
  return import('../app/services/SnapshotScheduler.service.js');
}

let timer: NodeJS.Timeout | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  aggregationConfig.snapshotJobEnabled = true;
  runDueSnapshotsMock.mockReset().mockResolvedValue({
    due: 0,
    succeeded: 0,
    failed: 0,
  });
});

afterEach(() => {
  if (timer) {
    clearInterval(timer);
    timer = undefined;
  }
  vi.useRealTimers();
});

describe('startSnapshotScheduler', () => {
  it('registers no timer and polls nothing when the job is disabled', async () => {
    aggregationConfig.snapshotJobEnabled = false;
    const { startSnapshotScheduler } = await loadScheduler();

    timer = startSnapshotScheduler();

    expect(timer).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS * 3);
    expect(runDueSnapshotsMock).not.toHaveBeenCalled();
  });

  it('runs once per heartbeat when enabled', async () => {
    const { startSnapshotScheduler } = await loadScheduler();

    timer = startSnapshotScheduler();

    expect(runDueSnapshotsMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
    expect(runDueSnapshotsMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
    expect(runDueSnapshotsMock).toHaveBeenCalledTimes(2);
  });

  it('skips a tick that fires while the previous run is still in flight', async () => {
    let finishRun: (() => void) | undefined;
    runDueSnapshotsMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishRun = () => resolve({ due: 1, succeeded: 1, failed: 0 });
        }),
    );
    const { startSnapshotScheduler } = await loadScheduler();

    timer = startSnapshotScheduler();

    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
    expect(runDueSnapshotsMock).toHaveBeenCalledTimes(1);

    finishRun?.();
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
    expect(runDueSnapshotsMock).toHaveBeenCalledTimes(2);
  });

  it('catches a throwing run and keeps ticking', async () => {
    runDueSnapshotsMock.mockRejectedValueOnce(new Error('Battle.net is down'));
    const { startSnapshotScheduler } = await loadScheduler();

    timer = startSnapshotScheduler();

    await expect(
      vi.advanceTimersByTimeAsync(HEARTBEAT_MS),
    ).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
    expect(runDueSnapshotsMock).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run tests/SnapshotScheduler.service.test.ts
```

Expected: FAIL — `Cannot find module '../app/services/SnapshotScheduler.service.js'`.

- [ ] **Step 3: Write the scheduler**

`app/services/SnapshotScheduler.service.ts`:

```ts
import { aggregationConfig } from '../config/aggregation.conf.js';
import { runDueSnapshots } from './CharacterSnapshot.service.js';
import { logger } from '../utils/Logger.util.js';

let running = false;

async function tick(): Promise<void> {
  if (running) {
    logger.info('[snapshots] previous run still in flight — skipping this tick');
    return;
  }

  running = true;
  try {
    await runDueSnapshots();
  } catch (err) {
    // The repo's convention is to throw and let Express's errorHandler respond,
    // but no request wraps a timer callback: an unhandled rejection here would
    // take the whole API process down. This boundary catches everything.
    logger.error(
      `[snapshots] run failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  } finally {
    running = false;
  }
}

// Off unless SNAPSHOT_JOB_ENABLED=true, so dev servers and test runs never
// quietly start polling Blizzard. Due-ness lives in the database, so a restart
// can't cause a polling burst and no "skip the first tick" guard is needed.
export function startSnapshotScheduler(): NodeJS.Timeout | undefined {
  if (!aggregationConfig.snapshotJobEnabled) {
    logger.info('[snapshots] scheduler disabled (SNAPSHOT_JOB_ENABLED=false)');
    return undefined;
  }

  const { snapshotJobHeartbeatMinutes } = aggregationConfig;
  logger.info(
    `[snapshots] scheduler started — heartbeat every ${snapshotJobHeartbeatMinutes}m`,
  );

  return setInterval(() => {
    void tick();
  }, snapshotJobHeartbeatMinutes * 60_000);
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run tests/SnapshotScheduler.service.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 5: Wire it into the server**

In `server.ts`, add the import and one call at the end of `main()`:

```ts
import 'dotenv/config';
import { createApp } from './app/config/app.conf.js';
import { connect } from './app/database/index.js';
import { startSnapshotScheduler } from './app/services/SnapshotScheduler.service.js';
import { logger } from './app/utils/Logger.util.js';

const port = Number(process.env.PORT ?? 3000);

async function main(): Promise<void> {
  await connect();

  const app = createApp();
  app.listen(port, () => {
    logger.info(`Server listening on port ${port}`);
  });

  startSnapshotScheduler();
}
```

- [ ] **Step 6: Verify the server boots without polling**

```bash
npm run db:up && npm run dev
```

Expected: the log shows `Connected to Postgres`, `Server listening on port 3000`, and `[snapshots] scheduler disabled (SNAPSHOT_JOB_ENABLED=false)`. Stop it with Ctrl-C.

- [ ] **Step 7: Build, lint, full suite**

```bash
npm run build && npx eslint app/services/SnapshotScheduler.service.ts server.ts tests/SnapshotScheduler.service.test.ts && npm test
```

- [ ] **Step 8: Commit**

```bash
git add app/services/SnapshotScheduler.service.ts server.ts tests/SnapshotScheduler.service.test.ts && git commit -m "$(printf 'Run the snapshot job on an in-process heartbeat (CB-90)\n\nsetInterval at SNAPSHOT_JOB_HEARTBEAT_MINUTES, off by default, with an\nin-flight guard so a slow run can never overlap the next tick. The tick\ncatches everything it throws: unlike the rest of the codebase there is no\nExpress request to forward an error to, and an unhandled rejection in a timer\ncallback would crash the API process.\n\nCo-Authored-By: Claude Opus 5 <noreply@anthropic.com>')"
```

---

## Task 7: One-shot CLI entrypoint

**Files:**
- Create: `scripts/run-snapshot-job.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `connect()`, `disconnect()` (`app/database/index.js`), `runDueSnapshots` (Task 5), `logger`.
- Produces: `npm run job:snapshot`.

- [ ] **Step 1: Write the script**

`scripts/run-snapshot-job.ts` — mirrors `scripts/db-migrate-down.ts`'s entrypoint style (`dotenv/config`, an async `main`, a `.catch` that logs and sets a non-zero exit):

```ts
// Performs exactly one snapshot run against the configured database and exits:
// polls every tracked character that is currently due, then reports the summary.
// Same service the in-process heartbeat calls — useful for local verification
// without waiting for a heartbeat, and the hook for an external scheduler.
//
// Usage: npm run job:snapshot
import 'dotenv/config';
import { connect, disconnect } from '../app/database/index.js';
import { runDueSnapshots } from '../app/services/CharacterSnapshot.service.js';
import { logger } from '../app/utils/Logger.util.js';

async function main(): Promise<void> {
  await connect();

  try {
    const { due, succeeded, failed } = await runDueSnapshots();
    logger.info(
      `Snapshot run finished: due=${due} succeeded=${succeeded} failed=${failed}`,
    );
  } finally {
    await disconnect();
  }
}

main().catch((err) => {
  logger.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
```

- [ ] **Step 2: Add the npm script**

In `package.json`, add to `"scripts"` after `"db:migrate:down"`:

```json
    "job:snapshot": "tsx scripts/run-snapshot-job.ts"
```

- [ ] **Step 3: Run it against the local database**

```bash
npm run db:up && npm run db:migrate:up && npm run job:snapshot
```

Expected with an empty `tracked_characters`: `Connected to Postgres`, `[snapshots] no characters due`, `Snapshot run finished: due=0 succeeded=0 failed=0`, exit 0.

- [ ] **Step 4: Verify a real snapshot end to end**

This is the acceptance check that the app token really carries the job. Log in via the Battle.net flow, track a character, then flip the re-auth flag and run the job anyway:

```bash
psql "$DATABASE_URL" -c "update users set needs_reauth = true;"
npm run job:snapshot
psql "$DATABASE_URL" -c "select realm_slug, character_name, level, average_item_level, achievements_completed, left(payload_hash, 8) as hash, captured_at from character_snapshots order by captured_at desc limit 5;"
psql "$DATABASE_URL" -c "select realm_slug, character_name, poll_interval_minutes, next_poll_at from tracked_characters;"
```

Expected: `due=1 succeeded=1 failed=0` despite `needs_reauth = true`; one snapshot row with populated metrics; `poll_interval_minutes = 30` and `next_poll_at` about 30 minutes out (first poll counts as changed). Run `npm run job:snapshot` a second time immediately — expected `due=0`, because the character is no longer due. Then force it due and confirm the backoff:

```bash
psql "$DATABASE_URL" -c "update tracked_characters set next_poll_at = now();"
npm run job:snapshot
psql "$DATABASE_URL" -c "select character_name, poll_interval_minutes from tracked_characters;"
```

Expected: a second snapshot row, and `poll_interval_minutes = 60` — the payload hash was unchanged, so the interval doubled. Finally, confirm history survives untracking (delete the tracked row via `DELETE /api/profile/wow/tracked-characters/:id` or `psql`, then re-count `character_snapshots` — the rows must still be there).

- [ ] **Step 5: Build, lint, full suite**

```bash
npm run build && npx eslint scripts/run-snapshot-job.ts && npm test
```

- [ ] **Step 6: Commit**

```bash
git add scripts/run-snapshot-job.ts package.json && git commit -m "$(printf 'Add npm run job:snapshot for one-shot snapshot runs (CB-90)\n\nCalls the same runDueSnapshots the heartbeat does, then exits — for local\nverification without waiting for a heartbeat, and as the hook for an external\nscheduler later.\n\nCo-Authored-By: Claude Opus 5 <noreply@anthropic.com>')"
```

---

## Task 8: Documentation

**Files:**
- Modify: `README.md`, `PRD.md`, `docs/plans/prds/scheduled-character-snapshots.md`

**Interfaces:**
- Consumes: everything above. Produces no code.

- [ ] **Step 1: Document the job in the README**

Add a `## Scheduled character snapshots` section after `## Tracked characters`, matching the existing sections' prose-plus-table style. It must cover:

- What the job does: polls every tracked character and writes a `character_snapshots` row per poll, with the typed metrics and all three raw Battle.net payloads.
- That it uses the **app-level client-credentials token**, so it keeps collecting data for users whose Battle.net session has expired (`needs_reauth`) — unlike the live `/api/profile/*` endpoints.
- The adaptive cadence: a character whose payload hash changed is polled again after `SNAPSHOT_ACTIVE_INTERVAL_MINUTES`; an unchanged one doubles its interval up to `SNAPSHOT_IDLE_INTERVAL_MINUTES` (30 → 60 → 120 → 240 → 360). A newly tracked character is due immediately.
- That it is **off by default** and enabling it is a deploy step.
- The env-var table:

  | Variable | Default | Description |
  | --- | --- | --- |
  | `SNAPSHOT_JOB_ENABLED` | `false` | Start the in-process heartbeat on server boot |
  | `SNAPSHOT_JOB_HEARTBEAT_MINUTES` | `5` | How often to look for due characters |
  | `SNAPSHOT_ACTIVE_INTERVAL_MINUTES` | `30` | Re-poll interval after an observed change |
  | `SNAPSHOT_IDLE_INTERVAL_MINUTES` | `360` | Backoff ceiling for unchanging characters |

  Note that the config is validated at import time and requires `heartbeat <= active <= idle`.
- `npm run job:snapshot` for a one-shot run (works regardless of `SNAPSHOT_JOB_ENABLED`).
- The **single-instance caveat**: the in-flight guard is per-process, so running more than one API instance with the job enabled double-polls every due character.
- That no endpoint reads snapshots yet — that's the next phase.

- [ ] **Step 2: Update `PRD.md`**

- Mark Phase 4 (scheduled aggregation job) as done, in whatever style the file already uses for completed phases.
- **Remove "gold" from the umbrella Goals.** Blizzard exposes no character gold through any API, so leaving it in the roadmap implies a deferrable feature rather than an unachievable one. If the surrounding sentence needs rewording, keep quest counts as a genuine follow-up (they need a fourth endpoint call, `/quests/completed`).

- [ ] **Step 3: Close out the PRD**

In `docs/plans/prds/scheduled-character-snapshots.md`:

- Change **Status** to `Implemented — see Post-implementation notes.` keeping the CB-90 link.
- Tick every box in **Acceptance Criteria** that the work actually satisfies. Any box that isn't ticked needs a sentence saying why.
- Add a **Post-implementation notes** section (PRDs are living documents here) recording what the PRD didn't specify, at minimum:
  - the `sha256Json` helper landed in `app/utils/Hash.util.ts` rather than inside the service, so tests can compute the expected hash;
  - the shared factory is `app/http/BattleNetAppTokenClient.ts`, exporting `createAppTokenClient()`;
  - `startSnapshotScheduler()` returns the timer (or `undefined` when disabled) so tests can clear it;
  - metric extraction reads `average_item_level` / `equipped_item_level` / `last_login_timestamp` from the **profile** payload, not the equipment payload;
  - the `poll_interval_minutes` column default is the literal `30`, duplicating `SNAPSHOT_ACTIVE_INTERVAL_MINUTES`' default because a column default must be a constant;
  - plus anything the implementation actually deviated on (e.g. the index `.desc()` fallback from Task 3, Step 7).
- Leave the three **Open Questions** open — they're Phase 5's, and the retention one now has real payload sizes available to answer it: note the observed row size from `psql "$DATABASE_URL" -c "select pg_size_pretty(pg_total_relation_size('character_snapshots'));"` alongside the row count.

- [ ] **Step 4: Verify and commit**

```bash
npx prettier --check README.md PRD.md docs/plans/prds/scheduled-character-snapshots.md || npm run format
```

```bash
git add README.md PRD.md docs/plans/prds/scheduled-character-snapshots.md && git commit -m "$(printf 'Document the scheduled snapshot job (CB-90)\n\nREADME covers the four env vars, the adaptive cadence, the off-by-default\nbehaviour, npm run job:snapshot, and the single-instance caveat. Drops gold\nfrom the PRD.md goals: no Blizzard API exposes character gold, so listing it\nas a roadmap goal implies it is merely deferred.\n\nCo-Authored-By: Claude Opus 5 <noreply@anthropic.com>')"
```

- [ ] **Step 5: Final gate before opening the PR**

```bash
npm run build && npm run lint && npm test
```

Expected: all three clean. Then push the branch and open the PR against `main`, titled `Snapshot tracked characters on a schedule (CB-90)`.

---

## Notes for the implementer

- **Don't build the job on per-user tokens.** It's the one decision the whole ticket rests on, and it was verified twice against live endpoints (spike script + raw `curl`, both `200`). If you find yourself importing `BattleNetUserToken.service.js` or `createProfileClient`, stop — the job is on the wrong track. The reasoning is in the PRD's Background section.
- **`scripts/spike-app-token-character.ts`** is an uncommitted throwaway from PRD drafting. Its answer is recorded in the PRD; delete it rather than committing it.
- **Don't add a read endpoint.** Snapshots are write-only in this ticket; history and trend endpoints are Phase 5.
- **Don't add `logger.warn`, a custom error class, or a cron dependency.** All three were considered and declined in the PRD.
