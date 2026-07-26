import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { listByUserMock, createMock, deleteByIdMock } = vi.hoisted(() => ({
  listByUserMock: vi.fn(),
  createMock: vi.fn(),
  deleteByIdMock: vi.fn(),
}));

vi.mock('../app/models/TrackedCharacter.model.js', () => ({
  TrackedCharacterModel: {
    listByUser: listByUserMock,
    create: createMock,
    deleteById: deleteByIdMock,
  },
}));

const { TrackedCharacterController } =
  await import('../app/controllers/TrackedCharacter.controller.js');

const ROW_ID = '7f1c1f9e-3a4a-4c2e-9d3b-4c2a1f9e3a4a';

function mockResponse(): Response {
  const res = {} as Response;
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe('TrackedCharacterController.list', () => {
  beforeEach(() => {
    listByUserMock.mockReset();
  });

  it("returns only the caller's tracked characters", async () => {
    const rows = [{ id: ROW_ID, userId: 'user-1' }];
    listByUserMock.mockResolvedValue(rows);
    const req = { user: { id: 'user-1' } } as unknown as Request;
    const res = mockResponse();

    await TrackedCharacterController.list(req, res);

    expect(listByUserMock).toHaveBeenCalledWith('user-1');
    expect(res.json).toHaveBeenCalledWith({ success: true, data: rows });
  });
});

describe('TrackedCharacterController.add', () => {
  beforeEach(() => {
    createMock.mockReset();
  });

  it('persists the character without validating it against the account summary', async () => {
    const row = {
      id: ROW_ID,
      userId: 'user-1',
      realmSlug: 'silvermoon',
      characterName: 'thrall',
    };
    createMock.mockResolvedValue(row);
    const req = {
      body: { realmSlug: 'silvermoon', characterName: 'thrall' },
      user: { id: 'user-1' },
    } as unknown as Request;
    const res = mockResponse();

    await TrackedCharacterController.add(req, res);

    expect(createMock).toHaveBeenCalledWith({
      userId: 'user-1',
      realmSlug: 'silvermoon',
      characterName: 'thrall',
    });
    expect(res.json).toHaveBeenCalledWith({ success: true, data: row });
  });

  it('trims and lowercases the realm slug and character name', async () => {
    createMock.mockResolvedValue({});
    const req = {
      body: { realmSlug: '  Argent-Dawn ', characterName: 'Thrall' },
      user: { id: 'user-1' },
    } as unknown as Request;
    const res = mockResponse();

    await TrackedCharacterController.add(req, res);

    expect(createMock).toHaveBeenCalledWith({
      userId: 'user-1',
      realmSlug: 'argent-dawn',
      characterName: 'thrall',
    });
  });

  it('is idempotent — a repeated add returns 200 with the existing row', async () => {
    const existing = {
      id: ROW_ID,
      userId: 'user-1',
      realmSlug: 'silvermoon',
      characterName: 'thrall',
    };
    createMock.mockResolvedValue(existing);
    const req = {
      body: { realmSlug: 'silvermoon', characterName: 'thrall' },
      user: { id: 'user-1' },
    } as unknown as Request;
    const res = mockResponse();

    await TrackedCharacterController.add(req, res);
    await TrackedCharacterController.add(req, res);

    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenLastCalledWith({
      success: true,
      data: existing,
    });
  });

  it('rejects a missing character name with 400 without touching the database', async () => {
    const req = {
      body: { realmSlug: 'silvermoon' },
      user: { id: 'user-1' },
    } as unknown as Request;
    const res = mockResponse();

    await TrackedCharacterController.add(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(createMock).not.toHaveBeenCalled();
  });

  it('rejects a blank realm slug with 400', async () => {
    const req = {
      body: { realmSlug: '   ', characterName: 'thrall' },
      user: { id: 'user-1' },
    } as unknown as Request;
    const res = mockResponse();

    await TrackedCharacterController.add(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(createMock).not.toHaveBeenCalled();
  });
});

describe('TrackedCharacterController.remove', () => {
  beforeEach(() => {
    deleteByIdMock.mockReset();
  });

  it('deletes a row scoped to the caller', async () => {
    const row = { id: ROW_ID, userId: 'user-1' };
    deleteByIdMock.mockResolvedValue(row);
    const req = {
      params: { id: ROW_ID },
      user: { id: 'user-1' },
    } as unknown as Request;
    const res = mockResponse();

    await TrackedCharacterController.remove(req, res);

    expect(deleteByIdMock).toHaveBeenCalledWith(ROW_ID, 'user-1');
    expect(res.json).toHaveBeenCalledWith({ success: true, data: row });
  });

  it('returns 404 when the row exists but belongs to another user', async () => {
    deleteByIdMock.mockResolvedValue(undefined);
    const req = {
      params: { id: ROW_ID },
      user: { id: 'user-2' },
    } as unknown as Request;
    const res = mockResponse();

    await TrackedCharacterController.remove(req, res);

    expect(deleteByIdMock).toHaveBeenCalledWith(ROW_ID, 'user-2');
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('returns 404 for a malformed id without touching the database', async () => {
    const req = {
      params: { id: 'not-a-uuid' },
      user: { id: 'user-1' },
    } as unknown as Request;
    const res = mockResponse();

    await TrackedCharacterController.remove(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(deleteByIdMock).not.toHaveBeenCalled();
  });
});
