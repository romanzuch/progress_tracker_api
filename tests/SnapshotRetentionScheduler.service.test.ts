import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { pruneStalePayloadsMock, aggregationConfig } = vi.hoisted(() => ({
  pruneStalePayloadsMock: vi.fn(),
  aggregationConfig: {
    snapshotRetentionJobEnabled: true,
    snapshotRetentionJobHeartbeatHours: 24,
  },
}));

vi.mock('../app/config/aggregation.conf.js', () => ({ aggregationConfig }));
vi.mock('../app/services/SnapshotRetention.service.js', () => ({
  pruneStalePayloads: pruneStalePayloadsMock,
}));

const HEARTBEAT_MS = 24 * 60 * 60_000;

// The in-flight guard is module-level state, so each test gets a fresh module.
async function loadScheduler() {
  vi.resetModules();
  return import('../app/services/SnapshotRetentionScheduler.service.js');
}

let timer: NodeJS.Timeout | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  aggregationConfig.snapshotRetentionJobEnabled = true;
  aggregationConfig.snapshotRetentionJobHeartbeatHours = 24;
  pruneStalePayloadsMock.mockReset().mockResolvedValue({ prunedRows: 0 });
});

afterEach(() => {
  if (timer) {
    clearInterval(timer);
    timer = undefined;
  }
  vi.useRealTimers();
});

describe('startSnapshotRetentionScheduler', () => {
  it('registers no timer and prunes nothing when the job is disabled', async () => {
    aggregationConfig.snapshotRetentionJobEnabled = false;
    const { startSnapshotRetentionScheduler } = await loadScheduler();

    timer = startSnapshotRetentionScheduler();

    expect(timer).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS * 3);
    expect(pruneStalePayloadsMock).not.toHaveBeenCalled();
  });

  it('runs once per heartbeat when enabled', async () => {
    const { startSnapshotRetentionScheduler } = await loadScheduler();

    timer = startSnapshotRetentionScheduler();

    expect(pruneStalePayloadsMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
    expect(pruneStalePayloadsMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
    expect(pruneStalePayloadsMock).toHaveBeenCalledTimes(2);
  });

  it('skips a tick that fires while the previous run is still in flight', async () => {
    let finishRun: (() => void) | undefined;
    pruneStalePayloadsMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishRun = () => resolve({ prunedRows: 3 });
        }),
    );
    const { startSnapshotRetentionScheduler } = await loadScheduler();

    timer = startSnapshotRetentionScheduler();

    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
    expect(pruneStalePayloadsMock).toHaveBeenCalledTimes(1);

    finishRun?.();
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
    expect(pruneStalePayloadsMock).toHaveBeenCalledTimes(2);
  });

  it('catches a throwing run and keeps ticking', async () => {
    pruneStalePayloadsMock.mockRejectedValueOnce(new Error('db unavailable'));
    const { startSnapshotRetentionScheduler } = await loadScheduler();

    timer = startSnapshotRetentionScheduler();

    await expect(
      vi.advanceTimersByTimeAsync(HEARTBEAT_MS),
    ).resolves.toBeTruthy();
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
    expect(pruneStalePayloadsMock).toHaveBeenCalledTimes(2);
  });

  it('uses the configured heartbeat interval in hours', async () => {
    aggregationConfig.snapshotRetentionJobHeartbeatHours = 1;
    const { startSnapshotRetentionScheduler } = await loadScheduler();

    timer = startSnapshotRetentionScheduler();

    await vi.advanceTimersByTimeAsync(60 * 60_000 - 1);
    expect(pruneStalePayloadsMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(pruneStalePayloadsMock).toHaveBeenCalledTimes(1);
  });
});
