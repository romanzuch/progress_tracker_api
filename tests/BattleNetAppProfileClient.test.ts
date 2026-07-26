import { describe, expect, it, vi } from 'vitest';

// battlenet.conf throws at import time without BNET_* env vars, and the token
// service reads two more of its exports, so the mock has to be complete.
vi.mock('../app/config/battlenet.conf.js', () => ({
  battlenetConfig: {
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
    region: 'eu',
    redirectUri: 'http://localhost:3000/api/auth/battlenet/callback',
  },
  battlenetOauthBaseUrl: 'https://eu.battle.net/oauth',
  battlenetApiBaseUrl: 'https://eu.api.blizzard.com',
  battlenetProfileNamespace: 'profile-eu',
}));

const { characterPath } = await import(
  '../app/http/BattleNetAppProfileClient.js'
);

describe('characterPath', () => {
  it('lowercases the realm slug and character name', () => {
    expect(characterPath('Argent-Dawn', 'Thrall')).toBe(
      '/profile/wow/character/argent-dawn/thrall',
    );
  });

  it('appends a suffix for the sub-resources', () => {
    expect(characterPath('dun-morogh', 'sixfootfour', '/achievements')).toBe(
      '/profile/wow/character/dun-morogh/sixfootfour/achievements',
    );
  });

  it('escapes non-ASCII character names', () => {
    expect(characterPath('argent-dawn', 'Thörr', '/equipment')).toBe(
      '/profile/wow/character/argent-dawn/th%C3%B6rr/equipment',
    );
  });
});
