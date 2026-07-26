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
    });
  });

  it('reads the environment when it is set', async () => {
    vi.stubEnv('SNAPSHOT_JOB_ENABLED', 'true');
    vi.stubEnv('SNAPSHOT_JOB_HEARTBEAT_MINUTES', '2');
    vi.stubEnv('SNAPSHOT_ACTIVE_INTERVAL_MINUTES', '15');
    vi.stubEnv('SNAPSHOT_IDLE_INTERVAL_MINUTES', '120');

    const { aggregationConfig } = await loadConfig();

    expect(aggregationConfig).toEqual({
      snapshotJobEnabled: true,
      snapshotJobHeartbeatMinutes: 2,
      snapshotActiveIntervalMinutes: 15,
      snapshotIdleIntervalMinutes: 120,
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
});
