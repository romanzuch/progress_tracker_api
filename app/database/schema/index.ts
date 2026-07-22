import { pgTable, serial, timestamp } from 'drizzle-orm/pg-core';

// Template table proving the migration pipeline (generate/apply/rollback) works end to end.
// Replace with real tables (e.g. the OAuth ticket's users/sessions/tokens) and drop this one.
export const schemaMigrationCheck = pgTable('schema_migration_check', {
  id: serial('id').primaryKey(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
