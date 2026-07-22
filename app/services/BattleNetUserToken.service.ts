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
    const encrypted = tokenResponse.refresh_token
      ? encrypt(tokenResponse.refresh_token)
      : undefined;

    await BattleNetTokenModel.upsert(userId, {
      accessToken: tokenResponse.access_token,
      accessTokenExpiresAt: new Date(
        Date.now() + tokenResponse.expires_in * 1000,
      ),
      refreshTokenEncrypted: encrypted?.ciphertext ?? null,
      refreshTokenIv: encrypted?.iv ?? null,
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

  if (!record.refreshTokenEncrypted || !record.refreshTokenIv) {
    await UserModel.setNeedsReauth(userId, true);
    throw new Error(
      `Battle.net access token expired for user ${userId} and no refresh token is available; user must re-authenticate`,
    );
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

  if (!record.refreshTokenEncrypted || !record.refreshTokenIv) {
    await UserModel.setNeedsReauth(userId, true);
    throw new Error(
      `No refresh token available for user ${userId}; user must re-authenticate`,
    );
  }

  const refreshToken = decrypt({
    ciphertext: record.refreshTokenEncrypted,
    iv: record.refreshTokenIv,
  });

  return refreshAndPersist(userId, refreshToken);
}
