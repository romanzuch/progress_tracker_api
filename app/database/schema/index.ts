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

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    battlenetId: text('battlenet_id').notNull(),
    battletag: text('battletag'),
    needsReauth: boolean('needs_reauth').notNull().default(false),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [uniqueIndex('users_battlenet_id_idx').on(table.battlenetId)],
);

export const battlenetTokens = pgTable(
  'battlenet_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accessToken: text('access_token').notNull(),
    accessTokenExpiresAt: timestamp('access_token_expires_at').notNull(),
    refreshTokenEncrypted: text('refresh_token_encrypted'),
    refreshTokenIv: text('refresh_token_iv'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [uniqueIndex('battlenet_tokens_user_id_idx').on(table.userId)],
);

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
    // Nullable, not notNull: the retention job (CB-91) nulls these out for
    // snapshots older than the configured window, keeping the row and its
    // typed metrics but dropping the raw payloads to bound storage cost.
    profilePayload: jsonb('profile_payload'),
    achievementsPayload: jsonb('achievements_payload'),
    equipmentPayload: jsonb('equipment_payload'),
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
