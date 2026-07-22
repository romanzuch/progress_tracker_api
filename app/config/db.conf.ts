import { z } from 'zod';
import { dbKeys } from './db.keys.js';

const dbConfigSchema = z.object({
  url: z.url({
    message: 'DATABASE_URL must be a valid Postgres connection string',
  }),
  poolMax: z.coerce.number().int().positive(),
  idleTimeoutMs: z.coerce.number().int().nonnegative(),
  connectTimeoutMs: z.coerce.number().int().positive(),
});

const parsed = dbConfigSchema.safeParse(dbKeys);

if (!parsed.success) {
  throw new Error(
    `Invalid database configuration: ${z.prettifyError(parsed.error)}`,
  );
}

export const dbConfig = parsed.data;
