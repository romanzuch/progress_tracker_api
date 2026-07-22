import axios, { type InternalAxiosRequestConfig } from 'axios';
import { battlenetApiBaseUrl } from '../config/battlenet.conf.js';
import {
  getAppToken,
  refreshAppToken,
} from '../services/BattleNetAppToken.service.js';

interface RetryableConfig extends InternalAxiosRequestConfig {
  _retry?: boolean;
}

export const battleNetGameDataClient = axios.create({
  baseURL: battlenetApiBaseUrl,
});

battleNetGameDataClient.interceptors.request.use(async (config) => {
  const token = await getAppToken();
  config.headers.set('Authorization', `Bearer ${token}`);
  return config;
});

battleNetGameDataClient.interceptors.response.use(
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
    return battleNetGameDataClient.request(config);
  },
);
