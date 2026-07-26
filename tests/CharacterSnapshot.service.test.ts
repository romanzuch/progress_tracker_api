import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sha256Json } from '../app/utils/Hash.util.js';

const {
  listDueMock,
  updateScheduleMock,
  createSnapshotMock,
  findLatestHashMock,
  getCharacterProfileMock,
  getCharacterAchievementsMock,
  getCharacterEquipmentMock,
  aggregationConfig,
} = vi.hoisted(() => ({
  listDueMock: vi.fn(),
  updateScheduleMock: vi.fn(),
  createSnapshotMock: vi.fn(),
  findLatestHashMock: vi.fn(),
  getCharacterProfileMock: vi.fn(),
  getCharacterAchievementsMock: vi.fn(),
  getCharacterEquipmentMock: vi.fn(),
  aggregationConfig: {
    snapshotJobEnabled: false,
    snapshotJobHeartbeatMinutes: 5,
    snapshotActiveIntervalMinutes: 30,
    snapshotIdleIntervalMinutes: 360,
  },
}));

vi.mock('../app/config/aggregation.conf.js', () => ({ aggregationConfig }));

vi.mock('../app/models/TrackedCharacter.model.js', () => ({
  TrackedCharacterModel: {
    listDue: listDueMock,
    updateSchedule: updateScheduleMock,
  },
}));

vi.mock('../app/models/CharacterSnapshot.model.js', () => ({
  CharacterSnapshotModel: {
    create: createSnapshotMock,
    findLatestHash: findLatestHashMock,
  },
}));

// Mocking the client module means battlenet.conf is never loaded, so the suite
// needs no BNET_* env vars.
vi.mock('../app/http/BattleNetAppProfileClient.js', () => ({
  battleNetAppProfileClient: {
    getCharacterProfile: getCharacterProfileMock,
    getCharacterAchievements: getCharacterAchievementsMock,
    getCharacterEquipment: getCharacterEquipmentMock,
  },
}));

const { nextPollInterval, runDueSnapshots } = await import(
  '../app/services/CharacterSnapshot.service.js'
);

describe('nextPollInterval', () => {
  it('resets to the active interval when the character changed', () => {
    expect(nextPollInterval(360, true)).toBe(30);
  });

  it('doubles the interval when nothing changed', () => {
    expect(nextPollInterval(30, false)).toBe(60);
    expect(nextPollInterval(120, false)).toBe(240);
  });

  it('caps the backoff at the idle floor', () => {
    expect(nextPollInterval(240, false)).toBe(360);
    expect(nextPollInterval(360, false)).toBe(360);
  });
});

const PROFILE = {
  level: 80,
  experience: 0,
  achievement_points: 14500,
  average_item_level: 632,
  equipped_item_level: 628,
  last_login_timestamp: 1_753_500_000_000,
};
const ACHIEVEMENTS = { total_quantity: 1234, total_points: 14500 };
const EQUIPMENT = { equipped_items: [{ slot: { type: 'HEAD' } }] };

function trackedCharacter(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: 'tracked-1',
    userId: 'user-1',
    realmSlug: 'dun-morogh',
    characterName: 'sixfootfour',
    nextPollAt: new Date('2026-07-26T10:00:00Z'),
    pollIntervalMinutes: 30,
    createdAt: new Date('2026-07-01T10:00:00Z'),
    ...overrides,
  };
}

function scheduleFor(id: string): {
  nextPollAt: Date;
  pollIntervalMinutes: number;
} {
  const call = updateScheduleMock.mock.calls.find(([callId]) => callId === id);
  if (!call) {
    throw new Error(`updateSchedule was never called for ${id}`);
  }
  return call[1];
}

describe('runDueSnapshots', () => {
  beforeEach(() => {
    listDueMock.mockReset();
    updateScheduleMock.mockReset().mockResolvedValue(undefined);
    createSnapshotMock.mockReset().mockResolvedValue({ id: 'snapshot-1' });
    findLatestHashMock.mockReset().mockResolvedValue(undefined);
    getCharacterProfileMock.mockReset().mockResolvedValue(PROFILE);
    getCharacterAchievementsMock.mockReset().mockResolvedValue(ACHIEVEMENTS);
    getCharacterEquipmentMock.mockReset().mockResolvedValue(EQUIPMENT);
  });

  it('is a clean no-op when nothing is due', async () => {
    listDueMock.mockResolvedValue([]);

    const summary = await runDueSnapshots();

    expect(summary).toEqual({ due: 0, succeeded: 0, failed: 0 });
    expect(getCharacterProfileMock).not.toHaveBeenCalled();
    expect(createSnapshotMock).not.toHaveBeenCalled();
    expect(updateScheduleMock).not.toHaveBeenCalled();
  });

  it('persists one row per due character with metrics and all three payloads', async () => {
    listDueMock.mockResolvedValue([trackedCharacter()]);

    const summary = await runDueSnapshots();

    expect(summary).toEqual({ due: 1, succeeded: 1, failed: 0 });
    expect(createSnapshotMock).toHaveBeenCalledTimes(1);
    expect(createSnapshotMock).toHaveBeenCalledWith({
      userId: 'user-1',
      realmSlug: 'dun-morogh',
      characterName: 'sixfootfour',
      payloadHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      level: 80,
      experience: 0,
      achievementPoints: 14500,
      achievementsCompleted: 1234,
      averageItemLevel: 632,
      equippedItemLevel: 628,
      lastLoginAt: new Date(1_753_500_000_000),
      profilePayload: PROFILE,
      achievementsPayload: ACHIEVEMENTS,
      equipmentPayload: EQUIPMENT,
    });
  });

  it('degrades missing metric fields to null instead of failing the snapshot', async () => {
    listDueMock.mockResolvedValue([trackedCharacter()]);
    getCharacterProfileMock.mockResolvedValue({ level: 12 });
    getCharacterAchievementsMock.mockResolvedValue({});

    const summary = await runDueSnapshots();

    expect(summary).toEqual({ due: 1, succeeded: 1, failed: 0 });
    expect(createSnapshotMock).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 12,
        experience: null,
        achievementPoints: null,
        achievementsCompleted: null,
        averageItemLevel: null,
        equippedItemLevel: null,
        lastLoginAt: null,
      }),
    );
  });

  it('reschedules a changed character at the active interval', async () => {
    listDueMock.mockResolvedValue([trackedCharacter({ pollIntervalMinutes: 360 })]);
    findLatestHashMock.mockResolvedValue('a-different-hash');

    await runDueSnapshots();

    const { nextPollAt, pollIntervalMinutes } = scheduleFor('tracked-1');
    expect(pollIntervalMinutes).toBe(30);
    expect(nextPollAt.getTime() - Date.now()).toBeGreaterThan(29 * 60_000);
    expect(nextPollAt.getTime() - Date.now()).toBeLessThanOrEqual(30 * 60_000);
  });

  it('doubles the interval when the payload hash is unchanged', async () => {
    listDueMock.mockResolvedValue([trackedCharacter()]);
    // The hash the service will compute from these same payloads.
    findLatestHashMock.mockResolvedValue(
      sha256Json([PROFILE, ACHIEVEMENTS, EQUIPMENT]),
    );

    await runDueSnapshots();

    expect(scheduleFor('tracked-1').pollIntervalMinutes).toBe(60);
  });

  it('treats a first-ever poll as changed', async () => {
    listDueMock.mockResolvedValue([trackedCharacter({ pollIntervalMinutes: 360 })]);
    findLatestHashMock.mockResolvedValue(undefined);

    await runDueSnapshots();

    expect(scheduleFor('tracked-1').pollIntervalMinutes).toBe(30);
  });

  it('isolates a failing character, still reschedules it, and finishes the run', async () => {
    listDueMock.mockResolvedValue([
      trackedCharacter({ id: 'tracked-gone', characterName: 'renamed' }),
      trackedCharacter({ id: 'tracked-ok' }),
    ]);
    getCharacterProfileMock.mockRejectedValueOnce(
      new Error('Request failed with status code 404'),
    );

    const summary = await runDueSnapshots();

    expect(summary).toEqual({ due: 2, succeeded: 1, failed: 1 });
    expect(createSnapshotMock).toHaveBeenCalledTimes(1);
    expect(createSnapshotMock).toHaveBeenCalledWith(
      expect.objectContaining({ characterName: 'sixfootfour' }),
    );
    // Backoff on failure — otherwise a permanently 404ing character is retried
    // on every single heartbeat forever.
    expect(scheduleFor('tracked-gone').pollIntervalMinutes).toBe(60);
    expect(scheduleFor('tracked-ok').pollIntervalMinutes).toBe(30);
  });

  it('keeps the run going when the failure-path reschedule itself rejects', async () => {
    listDueMock.mockResolvedValue([
      trackedCharacter({ id: 'tracked-gone', characterName: 'renamed' }),
      trackedCharacter({ id: 'tracked-ok' }),
    ]);
    getCharacterProfileMock.mockRejectedValueOnce(
      new Error('Request failed with status code 404'),
    );
    // The first character's own fetch failure triggers a reschedule attempt
    // that itself fails (DB blip). That must not abort the loop.
    updateScheduleMock.mockRejectedValueOnce(new Error('connection terminated'));

    const summary = await runDueSnapshots();

    expect(summary).toEqual({ due: 2, succeeded: 1, failed: 1 });
    // The second character must still be reached: snapshotted and rescheduled
    // normally, proving the loop continued past the reschedule failure.
    expect(createSnapshotMock).toHaveBeenCalledTimes(1);
    expect(createSnapshotMock).toHaveBeenCalledWith(
      expect.objectContaining({ characterName: 'sixfootfour' }),
    );
    expect(updateScheduleMock).toHaveBeenCalledWith(
      'tracked-ok',
      expect.objectContaining({ pollIntervalMinutes: 30 }),
    );
    expect(scheduleFor('tracked-ok').pollIntervalMinutes).toBe(30);
  });
});
