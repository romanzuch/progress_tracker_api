import { z } from 'zod';

export const localeSchema = z
  .enum([
    'en_US',
    'en_GB',
    'de_DE',
    'es_ES',
    'fr_FR',
    'it_IT',
    'pl_PL',
    'pt_PT',
    'ru_RU',
    'ko_KR',
    'zh_TW',
    'zh_CN',
    'es_MX',
    'pt_BR',
  ])
  .default('en_US');
