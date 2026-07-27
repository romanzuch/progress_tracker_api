import { and, asc, desc, eq, gte, isNotNull, lt, lte } from 'drizzle-orm';
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

export interface CharacterSnapshotSummary {
  id: string;
  capturedAt: Date;
  payloadHash: string;
  level: number | null;
  experience: number | null;
  achievementPoints: number | null;
  achievementsCompleted: number | null;
  averageItemLevel: number | null;
  equippedItemLevel: number | null;
  lastLoginAt: Date | null;
}

// Typed metrics only — never the three raw jsonb payload columns, which are
// write-only-then-pruned and never meant to cross the HTTP boundary.
const summaryColumns = {
  id: characterSnapshots.id,
  capturedAt: characterSnapshots.capturedAt,
  payloadHash: characterSnapshots.payloadHash,
  level: characterSnapshots.level,
  experience: characterSnapshots.experience,
  achievementPoints: characterSnapshots.achievementPoints,
  achievementsCompleted: characterSnapshots.achievementsCompleted,
  averageItemLevel: characterSnapshots.averageItemLevel,
  equippedItemLevel: characterSnapshots.equippedItemLevel,
  lastLoginAt: characterSnapshots.lastLoginAt,
};

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

  // Ownership-scoped: userId is a hard filter, not a post-hoc check — a
  // realm/character-name pair with no snapshots owned by this user simply
  // yields an empty array, same as one that doesn't exist at all.
  async listHistory(params: {
    userId: string;
    realmSlug: string;
    characterName: string;
    from?: Date;
    to?: Date;
    limit: number;
  }): Promise<CharacterSnapshotSummary[]> {
    const { userId, realmSlug, characterName, from, to, limit } = params;
    const conditions = [
      eq(characterSnapshots.userId, userId),
      eq(characterSnapshots.realmSlug, realmSlug),
      eq(characterSnapshots.characterName, characterName),
    ];

    if (from) {
      conditions.push(gte(characterSnapshots.capturedAt, from));
    }
    if (to) {
      conditions.push(lte(characterSnapshots.capturedAt, to));
    }

    return getDb()
      .select(summaryColumns)
      .from(characterSnapshots)
      .where(and(...conditions))
      .orderBy(asc(characterSnapshots.capturedAt))
      .limit(limit);
  },

  async findLatest(identity: {
    userId: string;
    realmSlug: string;
    characterName: string;
  }): Promise<CharacterSnapshotSummary | undefined> {
    const [row] = await getDb()
      .select(summaryColumns)
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
    return row;
  },

  // Nulls the three raw payload columns on snapshots older than the cutoff,
  // leaving the row and every typed metric column untouched. The isNotNull
  // guard makes a repeated run against already-pruned rows a cheap no-op.
  async pruneRawPayloadsOlderThan(cutoff: Date): Promise<number> {
    const rows = await getDb()
      .update(characterSnapshots)
      .set({
        profilePayload: null,
        achievementsPayload: null,
        equipmentPayload: null,
      })
      .where(
        and(
          lt(characterSnapshots.capturedAt, cutoff),
          isNotNull(characterSnapshots.profilePayload),
        ),
      )
      .returning({ id: characterSnapshots.id });
    return rows.length;
  },
};
