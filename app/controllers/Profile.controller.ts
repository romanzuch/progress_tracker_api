import type { Request, Response } from 'express';
import { z } from 'zod';
import { battlenetProfileNamespace } from '../config/battlenet.conf.js';
import { localeSchema } from '../config/battlenet.locales.js';
import { createProfileClient } from '../http/BattleNetProfileClient.js';
import { UserModel } from '../models/User.model.js';

async function proxyProfileRequest(
  req: Request,
  res: Response,
  path: string,
): Promise<void> {
  const parsedLocale = localeSchema.safeParse(req.query.locale);

  if (!parsedLocale.success) {
    res.status(400).json({ error: z.prettifyError(parsedLocale.error) });
    return;
  }

  const userId = req.user!.id;

  try {
    const client = createProfileClient(userId);
    const { data } = await client.get(path, {
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
}

// Battle.net's character endpoints only match lowercase realm slugs and names.
function pathSegment(value: string | string[]): string {
  return encodeURIComponent(String(value).toLowerCase());
}

function characterPath(req: Request, suffix = ''): string {
  const realmSlug = pathSegment(req.params.realmSlug);
  const characterName = pathSegment(req.params.characterName);
  return `/profile/wow/character/${realmSlug}/${characterName}${suffix}`;
}

export const ProfileController = {
  async wow(req: Request, res: Response): Promise<void> {
    await proxyProfileRequest(req, res, '/profile/user/wow');
  },

  async character(req: Request, res: Response): Promise<void> {
    await proxyProfileRequest(req, res, characterPath(req));
  },

  async characterAchievements(req: Request, res: Response): Promise<void> {
    await proxyProfileRequest(req, res, characterPath(req, '/achievements'));
  },

  async characterEquipment(req: Request, res: Response): Promise<void> {
    await proxyProfileRequest(req, res, characterPath(req, '/equipment'));
  },
};
