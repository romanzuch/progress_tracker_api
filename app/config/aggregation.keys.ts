export const aggregationKeys = {
  snapshotJobEnabled: process.env.SNAPSHOT_JOB_ENABLED ?? 'false',
  snapshotJobHeartbeatMinutes:
    process.env.SNAPSHOT_JOB_HEARTBEAT_MINUTES ?? '5',
  snapshotActiveIntervalMinutes:
    process.env.SNAPSHOT_ACTIVE_INTERVAL_MINUTES ?? '30',
  snapshotIdleIntervalMinutes:
    process.env.SNAPSHOT_IDLE_INTERVAL_MINUTES ?? '360',
};
