import axios from 'axios';
import {
  battlenetConfig,
  battlenetOauthBaseUrl,
} from '../config/battlenet.conf.js';

const PROFILE_SCOPE = 'wow.profile';

export interface BattleNetTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  scope: string;
}

export interface BattleNetUserInfo {
  sub: string;
  battletag: string;
}

export function getAuthorizationUrl(state: string): string {
  const url = new URL(`${battlenetOauthBaseUrl}/authorize`);
  url.searchParams.set('client_id', battlenetConfig.clientId);
  url.searchParams.set('redirect_uri', battlenetConfig.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', `openid ${PROFILE_SCOPE}`);
  url.searchParams.set('state', state);
  return url.toString();
}

export async function exchangeCodeForToken(
  code: string,
): Promise<BattleNetTokenResponse> {
  const { data } = await axios.post<BattleNetTokenResponse>(
    `${battlenetOauthBaseUrl}/token`,
    new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: battlenetConfig.redirectUri,
    }),
    {
      auth: {
        username: battlenetConfig.clientId,
        password: battlenetConfig.clientSecret,
      },
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    },
  );
  return data;
}

export async function refreshUserToken(
  refreshToken: string,
): Promise<BattleNetTokenResponse> {
  const { data } = await axios.post<BattleNetTokenResponse>(
    `${battlenetOauthBaseUrl}/token`,
    new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
    {
      auth: {
        username: battlenetConfig.clientId,
        password: battlenetConfig.clientSecret,
      },
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    },
  );
  return data;
}

export async function getUserInfo(
  accessToken: string,
): Promise<BattleNetUserInfo> {
  const { data } = await axios.get<BattleNetUserInfo>(
    `${battlenetOauthBaseUrl}/userinfo`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  return data;
}
