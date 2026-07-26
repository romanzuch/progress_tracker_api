import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getMock, findByIdMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  findByIdMock: vi.fn(),
}));

vi.mock('../app/config/battlenet.conf.js', () => ({
  battlenetProfileNamespace: 'profile-eu',
}));

vi.mock('../app/http/BattleNetProfileClient.js', () => ({
  createProfileClient: () => ({ get: getMock }),
}));

vi.mock('../app/models/User.model.js', () => ({
  UserModel: { findById: findByIdMock },
}));

const { ProfileController } = await import('../app/controllers/Profile.controller.js');

function mockResponse(): Response {
  const res = {} as Response;
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe('ProfileController.wow', () => {
  beforeEach(() => {
    getMock.mockReset();
    findByIdMock.mockReset();
  });

  it('defaults to en_US and returns Battle.net data unmodified', async () => {
    getMock.mockResolvedValue({ data: { id: 1, wow_accounts: [] } });
    const req = { query: {}, user: { id: 'user-1' } } as unknown as Request;
    const res = mockResponse();

    await ProfileController.wow(req, res);

    expect(getMock).toHaveBeenCalledWith('/profile/user/wow', {
      params: { namespace: 'profile-eu', locale: 'en_US' },
    });
    expect(res.json).toHaveBeenCalledWith({ id: 1, wow_accounts: [] });
  });

  it('passes through a supported locale query param', async () => {
    getMock.mockResolvedValue({ data: {} });
    const req = {
      query: { locale: 'de_DE' },
      user: { id: 'user-1' },
    } as unknown as Request;
    const res = mockResponse();

    await ProfileController.wow(req, res);

    expect(getMock).toHaveBeenCalledWith('/profile/user/wow', {
      params: { namespace: 'profile-eu', locale: 'de_DE' },
    });
  });

  it('rejects an unsupported locale with 400 without calling Battle.net', async () => {
    const req = {
      query: { locale: 'xx_XX' },
      user: { id: 'user-1' },
    } as unknown as Request;
    const res = mockResponse();

    await ProfileController.wow(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(getMock).not.toHaveBeenCalled();
  });

  it('returns 401 with needs_reauth when the token refresh fails and needsReauth is set', async () => {
    getMock.mockRejectedValue(new Error('must re-authenticate'));
    findByIdMock.mockResolvedValue({ id: 'user-1', needsReauth: true });
    const req = { query: {}, user: { id: 'user-1' } } as unknown as Request;
    const res = mockResponse();

    await ProfileController.wow(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'needs_reauth' });
  });

  it('rethrows unexpected errors when needsReauth is not set', async () => {
    getMock.mockRejectedValue(new Error('boom'));
    findByIdMock.mockResolvedValue({ id: 'user-1', needsReauth: false });
    const req = { query: {}, user: { id: 'user-1' } } as unknown as Request;
    const res = mockResponse();

    await expect(ProfileController.wow(req, res)).rejects.toThrow('boom');
  });
});

describe('ProfileController character endpoints', () => {
  beforeEach(() => {
    getMock.mockReset();
    findByIdMock.mockReset();
  });

  function characterRequest(
    params: { realmSlug: string; characterName: string },
    query: Record<string, string> = {},
  ): Request {
    return { params, query, user: { id: 'user-1' } } as unknown as Request;
  }

  it('fetches the character profile summary and returns it unmodified', async () => {
    getMock.mockResolvedValue({ data: { name: 'Thrall', level: 70 } });
    const req = characterRequest({
      realmSlug: 'silvermoon',
      characterName: 'thrall',
    });
    const res = mockResponse();

    await ProfileController.character(req, res);

    expect(getMock).toHaveBeenCalledWith(
      '/profile/wow/character/silvermoon/thrall',
      { params: { namespace: 'profile-eu', locale: 'en_US' } },
    );
    expect(res.json).toHaveBeenCalledWith({ name: 'Thrall', level: 70 });
  });

  it('fetches the character achievements summary', async () => {
    getMock.mockResolvedValue({ data: { total_points: 1000 } });
    const req = characterRequest({
      realmSlug: 'silvermoon',
      characterName: 'thrall',
    });
    const res = mockResponse();

    await ProfileController.characterAchievements(req, res);

    expect(getMock).toHaveBeenCalledWith(
      '/profile/wow/character/silvermoon/thrall/achievements',
      { params: { namespace: 'profile-eu', locale: 'en_US' } },
    );
    expect(res.json).toHaveBeenCalledWith({ total_points: 1000 });
  });

  it('fetches the character equipment summary', async () => {
    getMock.mockResolvedValue({ data: { equipped_items: [] } });
    const req = characterRequest({
      realmSlug: 'silvermoon',
      characterName: 'thrall',
    });
    const res = mockResponse();

    await ProfileController.characterEquipment(req, res);

    expect(getMock).toHaveBeenCalledWith(
      '/profile/wow/character/silvermoon/thrall/equipment',
      { params: { namespace: 'profile-eu', locale: 'en_US' } },
    );
    expect(res.json).toHaveBeenCalledWith({ equipped_items: [] });
  });

  it('lowercases and encodes the realm slug and character name', async () => {
    getMock.mockResolvedValue({ data: {} });
    const req = characterRequest({
      realmSlug: 'Argent-Dawn',
      characterName: 'Thörr',
    });
    const res = mockResponse();

    await ProfileController.character(req, res);

    expect(getMock).toHaveBeenCalledWith(
      '/profile/wow/character/argent-dawn/th%C3%B6rr',
      { params: { namespace: 'profile-eu', locale: 'en_US' } },
    );
  });

  it('supports the locale query param', async () => {
    getMock.mockResolvedValue({ data: {} });
    const req = characterRequest(
      { realmSlug: 'silvermoon', characterName: 'thrall' },
      { locale: 'fr_FR' },
    );
    const res = mockResponse();

    await ProfileController.characterEquipment(req, res);

    expect(getMock).toHaveBeenCalledWith(
      '/profile/wow/character/silvermoon/thrall/equipment',
      { params: { namespace: 'profile-eu', locale: 'fr_FR' } },
    );
  });

  it('rejects an unsupported locale with 400 without calling Battle.net', async () => {
    const req = characterRequest(
      { realmSlug: 'silvermoon', characterName: 'thrall' },
      { locale: 'xx_XX' },
    );
    const res = mockResponse();

    await ProfileController.character(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(getMock).not.toHaveBeenCalled();
  });

  it('propagates needs_reauth as a 401', async () => {
    getMock.mockRejectedValue(new Error('must re-authenticate'));
    findByIdMock.mockResolvedValue({ id: 'user-1', needsReauth: true });
    const req = characterRequest({
      realmSlug: 'silvermoon',
      characterName: 'thrall',
    });
    const res = mockResponse();

    await ProfileController.characterAchievements(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'needs_reauth' });
  });

  it('rethrows unexpected errors when needsReauth is not set', async () => {
    getMock.mockRejectedValue(new Error('boom'));
    findByIdMock.mockResolvedValue({ id: 'user-1', needsReauth: false });
    const req = characterRequest({
      realmSlug: 'silvermoon',
      characterName: 'thrall',
    });
    const res = mockResponse();

    await expect(ProfileController.character(req, res)).rejects.toThrow('boom');
  });
});
