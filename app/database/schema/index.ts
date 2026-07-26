import {
  boolean,
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
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('tracked_characters_user_id_realm_slug_character_name_idx').on(
      table.userId,
      table.realmSlug,
      table.characterName,
    ),
  ],
);
