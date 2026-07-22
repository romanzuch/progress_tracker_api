import axios, {
  type AxiosInstance,
  type InternalAxiosRequestConfig,
} from 'axios';
import { battlenetApiBaseUrl } from '../config/battlenet.conf.js';
import {
  forceRefreshAccessToken,
  getValidAccessToken,
} from '../services/BattleNetUserToken.service.js';

interface RetryableConfig extends InternalAxiosRequestConfig {
  _retry?: boolean;
}

export function createProfileClient(userId: string): AxiosInstance {
  const client = axios.create({ baseURL: battlenetApiBaseUrl });

  client.interceptors.request.use(async (config) => {
    const token = await getValidAccessToken(userId);
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

      const token = await forceRefreshAccessToken(userId);
      config.headers.set('Authorization', `Bearer ${token}`);
      return client.request(config);
    },
  );

  return client;
}
