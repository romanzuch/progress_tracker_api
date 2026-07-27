import { aggregationConfig } from '../config/aggregation.conf.js';
import { pruneStalePayloads } from './SnapshotRetention.service.js';
import { logger } from '../utils/Logger.util.js';

let running = false;

async function tick(): Promise<void> {
  if (running) {
    logger.info('[retention] previous run still in flight — skipping this tick');
    return;
  }

  running = true;
  try {
    await pruneStalePayloads();
  } catch (err) {
    // Same boundary rule as SnapshotScheduler.service.ts: no request wraps a
    // timer callback, so an unhandled rejection here would crash the process.
    logger.error(
      `[retention] run failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  } finally {
    running = false;
  }
}

// On by default (unlike the polling scheduler): this job makes no external
// Battle.net calls, only trims local data, so there's no reason to require
// an opt-in the way the API-hitting polling job does.
export function startSnapshotRetentionScheduler(): NodeJS.Timeout | undefined {
  if (!aggregationConfig.snapshotRetentionJobEnabled) {
    logger.info(
      '[retention] scheduler disabled (SNAPSHOT_RETENTION_JOB_ENABLED=false)',
    );
    return undefined;
  }

  const { snapshotRetentionJobHeartbeatHours } = aggregationConfig;
  logger.info(
    `[retention] scheduler started — heartbeat every ${snapshotRetentionJobHeartbeatHours}h`,
  );

  return setInterval(
    () => {
      void tick();
    },
    snapshotRetentionJobHeartbeatHours * 60 * 60_000,
  );
}
