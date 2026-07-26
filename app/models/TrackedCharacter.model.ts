import { and, eq, lte } from 'drizzle-orm';
import { getDb } from '../database/index.js';
import { trackedCharacters } from '../database/schema/index.js';

export interface TrackedCharacter {
  id: string;
  userId: string;
  realmSlug: string;
  characterName: string;
  nextPollAt: Date;
  pollIntervalMinutes: number;
  createdAt: Date;
}

export const TrackedCharacterModel = {
  async listByUser(userId: string): Promise<TrackedCharacter[]> {
    return getDb()
      .select()
      .from(trackedCharacters)
      .where(eq(trackedCharacters.userId, userId))
      .orderBy(trackedCharacters.createdAt);
  },

  async create(data: {
    userId: string;
    realmSlug: string;
    characterName: string;
  }): Promise<TrackedCharacter> {
    const [trackedCharacter] = await getDb()
      .insert(trackedCharacters)
      .values(data)
      // A no-op update (rather than DO NOTHING) so RETURNING yields the
      // existing row, making a repeated insert idempotent.
      .onConflictDoUpdate({
        target: [
          trackedCharacters.userId,
          trackedCharacters.realmSlug,
          trackedCharacters.characterName,
        ],
        set: { characterName: data.characterName },
      })
      .returning();
    return trackedCharacter;
  },

  async deleteById(
    id: string,
    userId: string,
  ): Promise<TrackedCharacter | undefined> {
    const [trackedCharacter] = await getDb()
      .delete(trackedCharacters)
      .where(
        and(eq(trackedCharacters.id, id), eq(trackedCharacters.userId, userId)),
      )
      .returning();
    return trackedCharacter;
  },

  // Every user's due characters in one query — the job is global, not per-user.
  async listDue(now: Date): Promise<TrackedCharacter[]> {
    return getDb()
      .select()
      .from(trackedCharacters)
      .where(lte(trackedCharacters.nextPollAt, now))
      .orderBy(trackedCharacters.nextPollAt);
  },

  async updateSchedule(
    id: string,
    schedule: { nextPollAt: Date; pollIntervalMinutes: number },
  ): Promise<void> {
    await getDb()
      .update(trackedCharacters)
      .set(schedule)
      .where(eq(trackedCharacters.id, id));
  },
};
