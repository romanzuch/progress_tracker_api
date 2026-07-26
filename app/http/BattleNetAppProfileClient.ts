import { battlenetProfileNamespace } from '../config/battlenet.conf.js';
import { createAppTokenClient } from './BattleNetAppTokenClient.js';

export type BattleNetPayload = Record<string, unknown>;

const client = createAppTokenClient();

// Battle.net's character endpoints only match lowercase realm slugs and names,
// and character names can be non-ASCII (e.g. "Thörr").
function pathSegment(value: string): string {
  return encodeURIComponent(value.toLowerCase());
}

export function characterPath(
  realmSlug: string,
  characterName: string,
  suffix = '',
): string {
  return `/profile/wow/character/${pathSegment(realmSlug)}/${pathSegment(
    characterName,
  )}${suffix}`;
}

async function getProfilePath(path: string): Promise<BattleNetPayload> {
  const { data } = await client.get<BattleNetPayload>(path, {
    params: { namespace: battlenetProfileNamespace, locale: 'en_US' },
  });
  return data;
}

// The same three endpoints the live Phase 3 routes proxy, but read with the
// app-level token so no user session is involved.
export const battleNetAppProfileClient = {
  getCharacterProfile(
    realmSlug: string,
    characterName: string,
  ): Promise<BattleNetPayload> {
    return getProfilePath(characterPath(realmSlug, characterName));
  },

  getCharacterAchievements(
    realmSlug: string,
    characterName: string,
  ): Promise<BattleNetPayload> {
    return getProfilePath(
      characterPath(realmSlug, characterName, '/achievements'),
    );
  },

  getCharacterEquipment(
    realmSlug: string,
    characterName: string,
  ): Promise<BattleNetPayload> {
    return getProfilePath(characterPath(realmSlug, characterName, '/equipment'));
  },
};
