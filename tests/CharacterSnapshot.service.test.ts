import { describe, expect, it, vi } from 'vitest';

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

const { nextPollInterval } = await import(
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
