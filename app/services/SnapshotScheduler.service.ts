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
