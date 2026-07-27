import { afterEach, describe, expect, it, vi } from 'vitest';

// The conf module validates and throws at import time, so each case needs a
// fresh module graph with its own stubbed environment.
async function loadConfig() {
  vi.resetModules();
  return import('../app/config/aggregation.conf.js');
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('aggregationConfig', () => {
  it('defaults to a disabled job with a 5/30/360 minute cadence', async () => {
    const { aggregationConfig } = await loadConfig();

    expect(aggregationConfig).toEqual({
      snapshotJobEnabled: false,
      snapshotJobHeartbeatMinutes: 5,
      snapshotActiveIntervalMinutes: 30,
      snapshotIdleIntervalMinutes: 360,
      snapshotRawPayloadRetentionDays: 90,
      snapshotRetentionJobEnabled: true,
      snapshotRetentionJobHeartbeatHours: 24,
    });
  });

  it('reads the environment when it is set', async () => {
    vi.stubEnv('SNAPSHOT_JOB_ENABLED', 'true');
    vi.stubEnv('SNAPSHOT_JOB_HEARTBEAT_MINUTES', '2');
    vi.stubEnv('SNAPSHOT_ACTIVE_INTERVAL_MINUTES', '15');
    vi.stubEnv('SNAPSHOT_IDLE_INTERVAL_MINUTES', '120');
    vi.stubEnv('SNAPSHOT_RAW_PAYLOAD_RETENTION_DAYS', '30');
    vi.stubEnv('SNAPSHOT_RETENTION_JOB_ENABLED', 'false');
    vi.stubEnv('SNAPSHOT_RETENTION_JOB_HEARTBEAT_HOURS', '6');

    const { aggregationConfig } = await loadConfig();

    expect(aggregationConfig).toEqual({
      snapshotJobEnabled: true,
      snapshotJobHeartbeatMinutes: 2,
      snapshotActiveIntervalMinutes: 15,
      snapshotIdleIntervalMinutes: 120,
      snapshotRawPayloadRetentionDays: 30,
      snapshotRetentionJobEnabled: false,
      snapshotRetentionJobHeartbeatHours: 6,
    });
  });

  it('rejects an active interval larger than the idle interval', async () => {
    vi.stubEnv('SNAPSHOT_ACTIVE_INTERVAL_MINUTES', '600');

    await expect(loadConfig()).rejects.toThrow(
      /SNAPSHOT_ACTIVE_INTERVAL_MINUTES/,
    );
  });

  it('rejects a heartbeat longer than the active interval', async () => {
    vi.stubEnv('SNAPSHOT_JOB_HEARTBEAT_MINUTES', '60');

    await expect(loadConfig()).rejects.toThrow(
      /SNAPSHOT_JOB_HEARTBEAT_MINUTES/,
    );
  });

  it('rejects a non-numeric interval', async () => {
    vi.stubEnv('SNAPSHOT_ACTIVE_INTERVAL_MINUTES', 'soon');

    await expect(loadConfig()).rejects.toThrow(
      /Invalid aggregation configuration/,
    );
  });

  it('rejects a non-numeric retention window', async () => {
    vi.stubEnv('SNAPSHOT_RAW_PAYLOAD_RETENTION_DAYS', 'forever');

    await expect(loadConfig()).rejects.toThrow(
      /Invalid aggregation configuration/,
    );
  });

  it('rejects a non-boolean retention job enabled flag', async () => {
    vi.stubEnv('SNAPSHOT_RETENTION_JOB_ENABLED', 'maybe');

    await expect(loadConfig()).rejects.toThrow(
      /SNAPSHOT_RETENTION_JOB_ENABLED/,
    );
  });
});
