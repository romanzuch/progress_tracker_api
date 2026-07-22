import postgres from 'postgres';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import { dbConfig } from '../config/db.conf.js';
import { logger } from '../utils/Logger.util.js';

let client: postgres.Sql | undefined;
let db: PostgresJsDatabase | undefined;

export function getDb(): PostgresJsDatabase {
  if (!db) {
    throw new Error('Postgres client accessed before connect() was called');
  }
  return db;
}

export async function connect(): Promise<void> {
  client = postgres(dbConfig.url, {
    max: dbConfig.poolMax,
    idle_timeout: dbConfig.idleTimeoutMs / 1000,
    connect_timeout: dbConfig.connectTimeoutMs / 1000,
  });
  db = drizzle(client);

  try {
    await client`select 1`;
    logger.info('Connected to Postgres');
  } catch (err) {
    const code = (err as { code?: string }).code;
    const message =
      err instanceof Error && err.message ? err.message : (code ?? String(err));
    throw new Error(`Failed to connect to Postgres: ${message}`, {
      cause: err,
    });
  }
}

export async function disconnect(): Promise<void> {
  await client?.end();
  client = undefined;
  db = undefined;
}

export async function checkHealth(): Promise<boolean> {
  try {
    await getDb().execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}
