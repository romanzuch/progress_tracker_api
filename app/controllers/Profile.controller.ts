import type { Request, Response } from 'express';
import { z } from 'zod';
import { battlenetProfileNamespace } from '../config/battlenet.conf.js';
import { createProfileClient } from '../http/BattleNetProfileClient.js';
import { UserModel } from '../models/User.model.js';

const localeSchema = z
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

export const ProfileController = {
  async wow(req: Request, res: Response): Promise<void> {
    const parsedLocale = localeSchema.safeParse(req.query.locale);

    if (!parsedLocale.success) {
      res.status(400).json({ error: z.prettifyError(parsedLocale.error) });
      return;
    }

    const userId = req.user!.id;

    try {
      const client = createProfileClient(userId);
      const { data } = await client.get('/profile/user/wow', {
        params: {
          namespace: battlenetProfileNamespace,
          locale: parsedLocale.data,
        },
      });
      res.json(data);
    } catch (err) {
      const user = await UserModel.findById(userId);
      if (user?.needsReauth) {
        res.status(401).json({ error: 'needs_reauth' });
        return;
      }
      throw err;
    }
  },
};
