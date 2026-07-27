import { aggregationConfig } from '../config/aggregation.conf.js';
import { CharacterSnapshotModel } from '../models/CharacterSnapshot.model.js';
import { logger } from '../utils/Logger.util.js';

export interface RetentionRunSummary {
  prunedRows: number;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Nulls the three raw payload columns on snapshots older than the configured
// window. Row count and every typed metric column are untouched — only
// storage cost from the raw payloads (the thing actually measured as
// expensive in Phase 4) is bounded.
export async function pruneStalePayloads(): Promise<RetentionRunSummary> {
  const cutoff = new Date(
    Date.now() -
      aggregationConfig.snapshotRawPayloadRetentionDays * MS_PER_DAY,
  );

  const prunedRows =
    await CharacterSnapshotModel.pruneRawPayloadsOlderThan(cutoff);

  logger.info(`[retention] pruned raw payloads on ${prunedRows} row(s)`);
  return { prunedRows };
}
