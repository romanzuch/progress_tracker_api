export const aggregationKeys = {
  snapshotJobEnabled: process.env.SNAPSHOT_JOB_ENABLED ?? 'false',
  snapshotJobHeartbeatMinutes:
    process.env.SNAPSHOT_JOB_HEARTBEAT_MINUTES ?? '5',
  snapshotActiveIntervalMinutes:
    process.env.SNAPSHOT_ACTIVE_INTERVAL_MINUTES ?? '30',
  snapshotIdleIntervalMinutes:
    process.env.SNAPSHOT_IDLE_INTERVAL_MINUTES ?? '360',
  snapshotRawPayloadRetentionDays:
    process.env.SNAPSHOT_RAW_PAYLOAD_RETENTION_DAYS ?? '90',
  snapshotRetentionJobEnabled:
    process.env.SNAPSHOT_RETENTION_JOB_ENABLED ?? 'true',
  snapshotRetentionJobHeartbeatHours:
    process.env.SNAPSHOT_RETENTION_JOB_HEARTBEAT_HOURS ?? '24',
};
