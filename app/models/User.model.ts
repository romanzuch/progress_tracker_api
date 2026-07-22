import { eq } from 'drizzle-orm';
import { getDb } from '../database/index.js';
import { users } from '../database/schema/index.js';

export interface User {
  id: string;
  battlenetId: string;
  battletag: string | null;
  needsReauth: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export const UserModel = {
  async findById(id: string): Promise<User | undefined> {
    const [user] = await getDb().select().from(users).where(eq(users.id, id));
    return user;
  },

  async findByBattlenetId(battlenetId: string): Promise<User | undefined> {
    const [user] = await getDb()
      .select()
      .from(users)
      .where(eq(users.battlenetId, battlenetId));
    return user;
  },

  async upsertByBattlenetId(data: {
    battlenetId: string;
    battletag?: string | null;
  }): Promise<User> {
    const [user] = await getDb()
      .insert(users)
      .values({
        battlenetId: data.battlenetId,
        battletag: data.battletag ?? null,
      })
      .onConflictDoUpdate({
        target: users.battlenetId,
        set: {
          battletag: data.battletag ?? null,
          needsReauth: false,
          updatedAt: new Date(),
        },
      })
      .returning();
    return user;
  },

  async setNeedsReauth(id: string, needsReauth: boolean): Promise<void> {
    await getDb()
      .update(users)
      .set({ needsReauth, updatedAt: new Date() })
      .where(eq(users.id, id));
  },
};
