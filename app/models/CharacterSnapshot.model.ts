import { and, desc, eq } from 'drizzle-orm';
import { getDb } from '../database/index.js';
import { characterSnapshots } from '../database/schema/index.js';

export interface CharacterSnapshot {
  id: string;
  userId: string;
  realmSlug: string;
  characterName: string;
  capturedAt: Date;
  payloadHash: string;
  level: number | null;
  experience: number | null;
  achievementPoints: number | null;
  achievementsCompleted: number | null;
  averageItemLevel: number | null;
  equippedItemLevel: number | null;
  lastLoginAt: Date | null;
  profilePayload: unknown;
  achievementsPayload: unknown;
  equipmentPayload: unknown;
  createdAt: Date;
}

export interface CharacterSnapshotInput {
  userId: string;
  realmSlug: string;
  characterName: string;
  payloadHash: string;
  level: number | null;
  experience: number | null;
  achievementPoints: number | null;
  achievementsCompleted: number | null;
  averageItemLevel: number | null;
  equippedItemLevel: number | null;
  lastLoginAt: Date | null;
  profilePayload: unknown;
  achievementsPayload: unknown;
  equipmentPayload: unknown;
}

export const CharacterSnapshotModel = {
  async create(data: CharacterSnapshotInput): Promise<CharacterSnapshot> {
    const [snapshot] = await getDb()
      .insert(characterSnapshots)
      .values(data)
      .returning();
    return snapshot;
  },

  // The change signal: undefined on a character's first-ever poll, which the
  // service treats as "changed" so it starts at the active cadence.
  async findLatestHash(identity: {
    userId: string;
    realmSlug: string;
    characterName: string;
  }): Promise<string | undefined> {
    const [row] = await getDb()
      .select({ payloadHash: characterSnapshots.payloadHash })
      .from(characterSnapshots)
      .where(
        and(
          eq(characterSnapshots.userId, identity.userId),
          eq(characterSnapshots.realmSlug, identity.realmSlug),
          eq(characterSnapshots.characterName, identity.characterName),
        ),
      )
      .orderBy(desc(characterSnapshots.capturedAt))
      .limit(1);
    return row?.payloadHash;
  },
};
