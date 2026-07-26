import axios, {
  type AxiosInstance,
  type InternalAxiosRequestConfig,
} from 'axios';
import { battlenetApiBaseUrl } from '../config/battlenet.conf.js';
import {
  getAppToken,
  refreshAppToken,
} from '../services/BattleNetAppToken.service.js';

interface RetryableConfig extends InternalAxiosRequestConfig {
  _retry?: boolean;
}

// Shared by every app-level (client-credentials) Battle.net client: attach the
// cached app token, and if Battle.net rejects it, mint a fresh one and retry the
// request exactly once.
export function createAppTokenClient(): AxiosInstance {
  const client = axios.create({ baseURL: battlenetApiBaseUrl });

  client.interceptors.request.use(async (config) => {
    const token = await getAppToken();
    config.headers.set('Authorization', `Bearer ${token}`);
    return config;
  });

  client.interceptors.response.use(
    (response) => response,
    async (error: unknown) => {
      if (!axios.isAxiosError(error) || error.response?.status !== 401) {
        return Promise.reject(error);
      }

      const config = error.config as RetryableConfig | undefined;
      if (!config || config._retry) {
        return Promise.reject(error);
      }
      config._retry = true;

      const token = await refreshAppToken();
      config.headers.set('Authorization', `Bearer ${token}`);
      return client.request(config);
    },
  );

  return client;
}
