import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { runDueSnapshotsMock, aggregationConfig } = vi.hoisted(() => ({
  runDueSnapshotsMock: vi.fn(),
  aggregationConfig: {
    snapshotJobEnabled: true,
    snapshotJobHeartbeatMinutes: 5,
    snapshotActiveIntervalMinutes: 30,
    snapshotIdleIntervalMinutes: 360,
  },
}));

vi.mock('../app/config/aggregation.conf.js', () => ({ aggregationConfig }));
vi.mock('../app/services/CharacterSnapshot.service.js', () => ({
  runDueSnapshots: runDueSnapshotsMock,
}));

const HEARTBEAT_MS = 5 * 60_000;

// The in-flight guard is module-level state, so each test gets a fresh module.
async function loadScheduler() {
  vi.resetModules();
  return import('../app/services/SnapshotScheduler.service.js');
}

let timer: NodeJS.Timeout | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  aggregationConfig.snapshotJobEnabled = true;
  runDueSnapshotsMock.mockReset().mockResolvedValue({
    due: 0,
    succeeded: 0,
    failed: 0,
  });
});

afterEach(() => {
  if (timer) {
    clearInterval(timer);
    timer = undefined;
  }
  vi.useRealTimers();
});

describe('startSnapshotScheduler', () => {
  it('registers no timer and polls nothing when the job is disabled', async () => {
    aggregationConfig.snapshotJobEnabled = false;
    const { startSnapshotScheduler } = await loadScheduler();

    timer = startSnapshotScheduler();

    expect(timer).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS * 3);
    expect(runDueSnapshotsMock).not.toHaveBeenCalled();
  });

  it('runs once per heartbeat when enabled', async () => {
    const { startSnapshotScheduler } = await loadScheduler();

    timer = startSnapshotScheduler();

    expect(runDueSnapshotsMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
    expect(runDueSnapshotsMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
    expect(runDueSnapshotsMock).toHaveBeenCalledTimes(2);
  });

  it('skips a tick that fires while the previous run is still in flight', async () => {
    let finishRun: (() => void) | undefined;
    runDueSnapshotsMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishRun = () => resolve({ due: 1, succeeded: 1, failed: 0 });
        }),
    );
    const { startSnapshotScheduler } = await loadScheduler();

    timer = startSnapshotScheduler();

    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
    expect(runDueSnapshotsMock).toHaveBeenCalledTimes(1);

    finishRun?.();
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
    expect(runDueSnapshotsMock).toHaveBeenCalledTimes(2);
  });

  it('catches a throwing run and keeps ticking', async () => {
    runDueSnapshotsMock.mockRejectedValueOnce(new Error('Battle.net is down'));
    const { startSnapshotScheduler } = await loadScheduler();

    timer = startSnapshotScheduler();

    // vitest 4's advanceTimersByTimeAsync resolves to the VitestUtils object
    // (for chaining), not void — assert it resolves at all (i.e. the rejected
    // run doesn't escape the tick as an unhandled rejection).
    await expect(
      vi.advanceTimersByTimeAsync(HEARTBEAT_MS),
    ).resolves.toBeTruthy();
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
    expect(runDueSnapshotsMock).toHaveBeenCalledTimes(2);
  });
});
