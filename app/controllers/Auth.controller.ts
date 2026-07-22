import { randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';
import { BattleNetTokenModel } from '../models/BattleNetToken.model.js';
import { UserModel } from '../models/User.model.js';
import {
  exchangeCodeForToken,
  getAuthorizationUrl,
  getUserInfo,
} from '../services/BattleNetAuth.service.js';
import {
  signSession,
  SESSION_COOKIE_NAME,
} from '../services/Session.service.js';
import { encrypt } from '../utils/Crypto.util.js';

const STATE_COOKIE_NAME = 'bnet_oauth_state';

export const AuthController = {
  login(_req: Request, res: Response): void {
    const state = randomBytes(16).toString('hex');

    res.cookie(STATE_COOKIE_NAME, state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 5 * 60 * 1000,
    });

    res.redirect(getAuthorizationUrl(state));
  },

  async callback(req: Request, res: Response): Promise<void> {
    const { code, state } = req.query;
    const expectedState = req.cookies?.[STATE_COOKIE_NAME] as
      string | undefined;

    res.clearCookie(STATE_COOKIE_NAME);

    if (
      typeof code !== 'string' ||
      typeof state !== 'string' ||
      !expectedState ||
      state !== expectedState
    ) {
      res.status(400).json({ error: 'Invalid or missing OAuth state/code' });
      return;
    }

    const tokenResponse = await exchangeCodeForToken(code);
    const userInfo = await getUserInfo(tokenResponse.access_token);

    const user = await UserModel.upsertByBattlenetId({
      battlenetId: userInfo.sub,
      battletag: userInfo.battletag,
    });

    const { ciphertext, iv } = encrypt(tokenResponse.refresh_token);

    await BattleNetTokenModel.upsert(user.id, {
      accessToken: tokenResponse.access_token,
      accessTokenExpiresAt: new Date(
        Date.now() + tokenResponse.expires_in * 1000,
      ),
      refreshTokenEncrypted: ciphertext,
      refreshTokenIv: iv,
    });

    const sessionToken = signSession(user.id);
    res.cookie(SESSION_COOKIE_NAME, sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
    });

    res.json({ success: true, data: { battletag: user.battletag } });
  },

  logout(_req: Request, res: Response): void {
    res.clearCookie(SESSION_COOKIE_NAME);
    res.json({ success: true });
  },
};
