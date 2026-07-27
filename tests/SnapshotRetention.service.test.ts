import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { pruneRawPayloadsOlderThanMock, aggregationConfig } = vi.hoisted(() => ({
  pruneRawPayloadsOlderThanMock: vi.fn(),
  aggregationConfig: {
    snapshotRawPayloadRetentionDays: 90,
  },
}));

vi.mock('../app/config/aggregation.conf.js', () => ({ aggregationConfig }));

vi.mock('../app/models/CharacterSnapshot.model.js', () => ({
  CharacterSnapshotModel: {
    pruneRawPayloadsOlderThan: pruneRawPayloadsOlderThanMock,
  },
}));

const { pruneStalePayloads } = await import(
  '../app/services/SnapshotRetention.service.js'
);

const DAY_MS = 24 * 60 * 60 * 1000;

describe('pruneStalePayloads', () => {
  beforeEach(() => {
    vi.useFakeTimers().setSystemTime(new Date('2026-07-27T12:00:00Z'));
    pruneRawPayloadsOlderThanMock.mockReset().mockResolvedValue(0);
    aggregationConfig.snapshotRawPayloadRetentionDays = 90;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('computes the cutoff from the configured retention window', async () => {
    await pruneStalePayloads();

    const cutoff = pruneRawPayloadsOlderThanMock.mock.calls[0][0] as Date;
    expect(cutoff.getTime()).toBe(Date.now() - 90 * DAY_MS);
  });

  it('recomputes the cutoff when the retention window config changes', async () => {
    aggregationConfig.snapshotRawPayloadRetentionDays = 30;

    await pruneStalePayloads();

    const cutoff = pruneRawPayloadsOlderThanMock.mock.calls[0][0] as Date;
    expect(cutoff.getTime()).toBe(Date.now() - 30 * DAY_MS);
  });

  it('returns the pruned row count from the model', async () => {
    pruneRawPayloadsOlderThanMock.mockResolvedValue(7);

    const summary = await pruneStalePayloads();

    expect(summary).toEqual({ prunedRows: 7 });
  });

  it('resolves to zero pruned rows when nothing is old enough to prune', async () => {
    pruneRawPayloadsOlderThanMock.mockResolvedValue(0);

    const summary = await pruneStalePayloads();

    expect(summary).toEqual({ prunedRows: 0 });
  });
});
