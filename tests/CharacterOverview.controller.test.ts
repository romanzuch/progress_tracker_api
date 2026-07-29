import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { listByUserMock, findLatestForUserMock } = vi.hoisted(() => ({
  listByUserMock: vi.fn(),
  findLatestForUserMock: vi.fn(),
}));

vi.mock('../app/models/TrackedCharacter.model.js', () => ({
  TrackedCharacterModel: { listByUser: listByUserMock },
}));

vi.mock('../app/models/CharacterSnapshot.model.js', () => ({
  CharacterSnapshotModel: { findLatestForUser: findLatestForUserMock },
}));

const { CharacterOverviewController } =
  await import('../app/controllers/CharacterOverview.controller.js');

function mockResponse(): Response {
  const res = {} as Response;
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

function overviewRequest(): Request {
  return { user: { id: 'user-1' } } as unknown as Request;
}

describe('CharacterOverviewController.list', () => {
  beforeEach(() => {
    listByUserMock.mockReset();
    findLatestForUserMock.mockReset();
  });

  it('merges tracked characters with their latest snapshot by realm/character name', async () => {
    listByUserMock.mockResolvedValue([
      {
        id: 'tracked-1',
        userId: 'user-1',
        realmSlug: 'dun-morogh',
        characterName: 'sixfootfour',
        nextPollAt: new Date(),
        pollIntervalMinutes: 60,
        createdAt: new Date(),
      },
    ]);
    findLatestForUserMock.mockResolvedValue([
      {
        realmSlug: 'dun-morogh',
        characterName: 'sixfootfour',
        id: 'snap-1',
        capturedAt: new Date('2026-01-01T00:00:00.000Z'),
        payloadHash: 'hash-1',
        level: 80,
        experience: 1000,
        achievementPoints: 500,
        achievementsCompleted: 10,
        averageItemLevel: 400,
        equippedItemLevel: 405,
        lastLoginAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ]);
    const req = overviewRequest();
    const res = mockResponse();

    await CharacterOverviewController.list(req, res);

    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: [
        {
          id: 'tracked-1',
          realmSlug: 'dun-morogh',
          characterName: 'sixfootfour',
          latestSnapshot: {
            id: 'snap-1',
            capturedAt: new Date('2026-01-01T00:00:00.000Z'),
            payloadHash: 'hash-1',
            level: 80,
            experience: 1000,
            achievementPoints: 500,
            achievementsCompleted: 10,
            averageItemLevel: 400,
            equippedItemLevel: 405,
            lastLoginAt: new Date('2026-01-01T00:00:00.000Z'),
          },
        },
      ],
    });
  });

  it('returns latestSnapshot: null for a tracked character with no snapshot rows', async () => {
    listByUserMock.mockResolvedValue([
      {
        id: 'tracked-1',
        userId: 'user-1',
        realmSlug: 'dun-morogh',
        characterName: 'sixfootfour',
        nextPollAt: new Date(),
        pollIntervalMinutes: 60,
        createdAt: new Date(),
      },
    ]);
    findLatestForUserMock.mockResolvedValue([]);
    const req = overviewRequest();
    const res = mockResponse();

    await CharacterOverviewController.list(req, res);

    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: [
        {
          id: 'tracked-1',
          realmSlug: 'dun-morogh',
          characterName: 'sixfootfour',
          latestSnapshot: null,
        },
      ],
    });
  });

  it('returns 200 with an empty array for a caller with zero tracked characters', async () => {
    listByUserMock.mockResolvedValue([]);
    findLatestForUserMock.mockResolvedValue([]);
    const req = overviewRequest();
    const res = mockResponse();

    await CharacterOverviewController.list(req, res);

    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ success: true, data: [] });
  });

  it('scopes both model calls to the authenticated caller', async () => {
    listByUserMock.mockResolvedValue([]);
    findLatestForUserMock.mockResolvedValue([]);
    const req = overviewRequest();
    const res = mockResponse();

    await CharacterOverviewController.list(req, res);

    expect(listByUserMock).toHaveBeenCalledWith('user-1');
    expect(findLatestForUserMock).toHaveBeenCalledWith('user-1');
  });
});
