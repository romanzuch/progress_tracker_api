import axios from 'axios';
import { BattleNetTokenModel } from '../models/BattleNetToken.model.js';
import { UserModel } from '../models/User.model.js';
import { refreshUserToken } from './BattleNetAuth.service.js';
import { decrypt, encrypt } from '../utils/Crypto.util.js';

const EXPIRY_SAFETY_MARGIN_MS = 60_000;

async function refreshAndPersist(
  userId: string,
  refreshToken: string,
): Promise<string> {
  try {
    const tokenResponse = await refreshUserToken(refreshToken);
    const { ciphertext, iv } = encrypt(tokenResponse.refresh_token);

    await BattleNetTokenModel.upsert(userId, {
      accessToken: tokenResponse.access_token,
      accessTokenExpiresAt: new Date(
        Date.now() + tokenResponse.expires_in * 1000,
      ),
      refreshTokenEncrypted: ciphertext,
      refreshTokenIv: iv,
    });

    return tokenResponse.access_token;
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.status === 400) {
      await UserModel.setNeedsReauth(userId, true);
    }
    throw err;
  }
}

export async function getValidAccessToken(userId: string): Promise<string> {
  const record = await BattleNetTokenModel.findByUserId(userId);
  if (!record) {
    throw new Error(`No Battle.net token stored for user ${userId}`);
  }

  const isExpired =
    record.accessTokenExpiresAt.getTime() - EXPIRY_SAFETY_MARGIN_MS <=
    Date.now();

  if (!isExpired) {
    return record.accessToken;
  }

  const refreshToken = decrypt({
    ciphertext: record.refreshTokenEncrypted,
    iv: record.refreshTokenIv,
  });

  return refreshAndPersist(userId, refreshToken);
}

export async function forceRefreshAccessToken(userId: string): Promise<string> {
  const record = await BattleNetTokenModel.findByUserId(userId);
  if (!record) {
    throw new Error(`No Battle.net token stored for user ${userId}`);
  }

  const refreshToken = decrypt({
    ciphertext: record.refreshTokenEncrypted,
    iv: record.refreshTokenIv,
  });

  return refreshAndPersist(userId, refreshToken);
}
