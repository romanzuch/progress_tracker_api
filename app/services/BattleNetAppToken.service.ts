import axios from 'axios';
import {
  battlenetConfig,
  battlenetOauthBaseUrl,
} from '../config/battlenet.conf.js';

interface CachedAppToken {
  token: string;
  expiresAt: number;
}

interface ClientCredentialsResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

const EXPIRY_SAFETY_MARGIN_MS = 60_000;

let cachedToken: CachedAppToken | undefined;

async function fetchAppToken(): Promise<CachedAppToken> {
  const { data } = await axios.post<ClientCredentialsResponse>(
    `${battlenetOauthBaseUrl}/token`,
    new URLSearchParams({ grant_type: 'client_credentials' }),
    {
      auth: {
        username: battlenetConfig.clientId,
        password: battlenetConfig.clientSecret,
      },
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    },
  );

  return {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
}

export async function getAppToken(): Promise<string> {
  if (
    cachedToken &&
    cachedToken.expiresAt - EXPIRY_SAFETY_MARGIN_MS > Date.now()
  ) {
    return cachedToken.token;
  }

  cachedToken = await fetchAppToken();
  return cachedToken.token;
}

export async function refreshAppToken(): Promise<string> {
  cachedToken = await fetchAppToken();
  return cachedToken.token;
}
