import { eq } from 'drizzle-orm';
import { getDb } from '../database/index.js';
import { battlenetTokens } from '../database/schema/index.js';

export interface BattleNetTokenRecord {
  id: string;
  userId: string;
  accessToken: string;
  accessTokenExpiresAt: Date;
  refreshTokenEncrypted: string | null;
  refreshTokenIv: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface BattleNetTokenInput {
  accessToken: string;
  accessTokenExpiresAt: Date;
  refreshTokenEncrypted?: string | null;
  refreshTokenIv?: string | null;
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
    const values = {
      userId,
      accessToken: data.accessToken,
      accessTokenExpiresAt: data.accessTokenExpiresAt,
      ...(data.refreshTokenEncrypted !== undefined
        ? {
            refreshTokenEncrypted: data.refreshTokenEncrypted,
            refreshTokenIv: data.refreshTokenIv,
          }
        : {}),
    };

    const [record] = await getDb()
      .insert(battlenetTokens)
      .values(values)
      .onConflictDoUpdate({
        target: battlenetTokens.userId,
        set: { ...values, updatedAt: new Date() },
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
