import { eq } from 'drizzle-orm';
import { getDb } from '../database/index.js';
import { battlenetTokens } from '../database/schema/index.js';

export interface BattleNetTokenRecord {
  id: string;
  userId: string;
  accessToken: string;
  accessTokenExpiresAt: Date;
  refreshTokenEncrypted: string;
  refreshTokenIv: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface BattleNetTokenInput {
  accessToken: string;
  accessTokenExpiresAt: Date;
  refreshTokenEncrypted: string;
  refreshTokenIv: string;
}

export const BattleNetTokenModel = {
  async findByUserId(
    userId: string,
  ): Promise<BattleNetTokenRecord | undefined> {
    const [record] = await getDb()
      .select()
      .from(battlenetTokens)
      .where(eq(battlenetTokens.userId, userId));
    return record;
  },

  async upsert(
    userId: string,
    data: BattleNetTokenInput,
  ): Promise<BattleNetTokenRecord> {
    const [record] = await getDb()
      .insert(battlenetTokens)
      .values({ userId, ...data })
      .onConflictDoUpdate({
        target: battlenetTokens.userId,
        set: { ...data, updatedAt: new Date() },
      })
      .returning();
    return record;
  },

  async updateAccessToken(
    userId: string,
    data: { accessToken: string; accessTokenExpiresAt: Date },
  ): Promise<void> {
    await getDb()
      .update(battlenetTokens)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(battlenetTokens.userId, userId));
  },
};
