export const dbKeys = {
  url: process.env.DATABASE_URL ?? '',
  poolMax: process.env.DB_POOL_MAX ?? '10',
  idleTimeoutMs: process.env.DB_IDLE_TIMEOUT_MS ?? '30000',
  connectTimeoutMs: process.env.DB_CONNECT_TIMEOUT_MS ?? '5000',
};
