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
