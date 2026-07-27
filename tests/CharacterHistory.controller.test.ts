import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { listHistoryMock, findLatestMock } = vi.hoisted(() => ({
  listHistoryMock: vi.fn(),
  findLatestMock: vi.fn(),
}));

vi.mock('../app/models/CharacterSnapshot.model.js', () => ({
  CharacterSnapshotModel: {
    listHistory: listHistoryMock,
    findLatest: findLatestMock,
  },
}));

const { CharacterHistoryController } = await import(
  '../app/controllers/CharacterHistory.controller.js'
);

function mockResponse(): Response {
  const res = {} as Response;
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

function historyRequest(
  query: Record<string, unknown> = {},
  params: Record<string, unknown> = {},
): Request {
  return {
    query,
    params: { realmSlug: 'dun-morogh', characterName: 'sixfootfour', ...params },
    user: { id: 'user-1' },
  } as unknown as Request;
}

describe('CharacterHistoryController.history', () => {
  beforeEach(() => {
    listHistoryMock.mockReset();
  });

  it('scopes the query to the caller and normalizes realm/character casing', async () => {
    listHistoryMock.mockResolvedValue([]);
    const req = historyRequest(
      {},
      { realmSlug: '  Dun-Morogh ', characterName: ' SixFootFour' },
    );
    const res = mockResponse();

    await CharacterHistoryController.history(req, res);

    expect(listHistoryMock).toHaveBeenCalledWith({
      userId: 'user-1',
      realmSlug: 'dun-morogh',
      characterName: 'sixfootfour',
      from: undefined,
      to: undefined,
      limit: 100,
    });
  });

  it('returns an empty array rather than 404 when there is no history', async () => {
    listHistoryMock.mockResolvedValue([]);
    const req = historyRequest();
    const res = mockResponse();

    await CharacterHistoryController.history(req, res);

    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ success: true, data: [] });
  });

  it('passes parsed from/to Date instances through to the model', async () => {
    listHistoryMock.mockResolvedValue([]);
    const req = historyRequest({
      from: '2026-01-01T00:00:00.000Z',
      to: '2026-02-01T00:00:00.000Z',
    });
    const res = mockResponse();

    await CharacterHistoryController.history(req, res);

    expect(listHistoryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        from: new Date('2026-01-01T00:00:00.000Z'),
        to: new Date('2026-02-01T00:00:00.000Z'),
      }),
    );
  });

  it('clamps a limit above the max instead of rejecting the request', async () => {
    listHistoryMock.mockResolvedValue([]);
    const req = historyRequest({ limit: '5000' });
    const res = mockResponse();

    await CharacterHistoryController.history(req, res);

    expect(listHistoryMock).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 1000 }),
    );
  });

  it('defaults the limit to 100 when omitted', async () => {
    listHistoryMock.mockResolvedValue([]);
    const req = historyRequest({});
    const res = mockResponse();

    await CharacterHistoryController.history(req, res);

    expect(listHistoryMock).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 100 }),
    );
  });

  it('rejects a malformed from/to timestamp with 400 without querying the model', async () => {
    const req = historyRequest({ from: 'not-a-date' });
    const res = mockResponse();

    await CharacterHistoryController.history(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(listHistoryMock).not.toHaveBeenCalled();
  });

  it('rejects a non-positive limit with 400', async () => {
    const req = historyRequest({ limit: '0' });
    const res = mockResponse();

    await CharacterHistoryController.history(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(listHistoryMock).not.toHaveBeenCalled();
  });
});

describe('CharacterHistoryController.latest', () => {
  beforeEach(() => {
    findLatestMock.mockReset();
  });

  it("returns the caller's latest snapshot", async () => {
    const snapshot = { id: 'snap-1', level: 80 };
    findLatestMock.mockResolvedValue(snapshot);
    const req = historyRequest();
    const res = mockResponse();

    await CharacterHistoryController.latest(req, res);

    expect(findLatestMock).toHaveBeenCalledWith({
      userId: 'user-1',
      realmSlug: 'dun-morogh',
      characterName: 'sixfootfour',
    });
    expect(res.json).toHaveBeenCalledWith({ success: true, data: snapshot });
  });

  it('returns 404 when the character has never been snapshotted for this user', async () => {
    findLatestMock.mockResolvedValue(undefined);
    const req = historyRequest();
    const res = mockResponse();

    await CharacterHistoryController.latest(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});
