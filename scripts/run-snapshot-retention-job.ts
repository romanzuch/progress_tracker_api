// Performs exactly one retention pass against the configured database and exits:
// nulls the raw payload columns on snapshots older than the configured window.
// Same service the in-process heartbeat calls — useful for local verification
// without waiting for a heartbeat, and the hook for an external scheduler.
//
// Usage: npm run job:prune-snapshots
import 'dotenv/config';
import { connect, disconnect } from '../app/database/index.js';
import { pruneStalePayloads } from '../app/services/SnapshotRetention.service.js';
import { logger } from '../app/utils/Logger.util.js';

async function main(): Promise<void> {
  await connect();

  try {
    const { prunedRows } = await pruneStalePayloads();
    logger.info(`Retention run finished: prunedRows=${prunedRows}`);
  } finally {
    await disconnect();
  }
}

main().catch((err) => {
  logger.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
