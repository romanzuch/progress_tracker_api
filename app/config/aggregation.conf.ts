import { z } from 'zod';
import { aggregationKeys } from './aggregation.keys.js';

const booleanFromString = z
  .enum(['true', 'false'], {
    message: 'SNAPSHOT_JOB_ENABLED must be "true" or "false"',
  })
  .transform((value) => value === 'true');

const positiveMinutes = z.coerce.number().int().positive();

const aggregationConfigSchema = z
  .object({
    snapshotJobEnabled: booleanFromString,
    snapshotJobHeartbeatMinutes: positiveMinutes,
    snapshotActiveIntervalMinutes: positiveMinutes,
    snapshotIdleIntervalMinutes: positiveMinutes,
  })
  // A heartbeat longer than the active interval would silently cap the real
  // polling resolution, and an active interval above the idle floor would make
  // the backoff rule meaningless — both are config bugs, not preferences.
  .refine(
    (config) =>
      config.snapshotActiveIntervalMinutes <=
      config.snapshotIdleIntervalMinutes,
    {
      message:
        'SNAPSHOT_ACTIVE_INTERVAL_MINUTES must be less than or equal to SNAPSHOT_IDLE_INTERVAL_MINUTES',
    },
  )
  .refine(
    (config) =>
      config.snapshotJobHeartbeatMinutes <=
      config.snapshotActiveIntervalMinutes,
    {
      message:
        'SNAPSHOT_JOB_HEARTBEAT_MINUTES must be less than or equal to SNAPSHOT_ACTIVE_INTERVAL_MINUTES',
    },
  );

const parsed = aggregationConfigSchema.safeParse(aggregationKeys);

if (!parsed.success) {
  throw new Error(
    `Invalid aggregation configuration: ${z.prettifyError(parsed.error)}`,
  );
}

export const aggregationConfig = parsed.data;
