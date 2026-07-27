import type { Request, Response } from 'express';
import { z } from 'zod';
import { CharacterSnapshotModel } from '../models/CharacterSnapshot.model.js';
import { successResponse } from '../helpers/App.helper.js';

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;

// limit is clamped rather than rejected above MAX_LIMIT — a caller asking for
// "too much" gets the max instead of a 400.
const historyQuerySchema = z.object({
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  limit: z.coerce
    .number()
    .int()
    .positive()
    .optional()
    .transform((value) => Math.min(value ?? DEFAULT_LIMIT, MAX_LIMIT)),
});

function characterIdentity(req: Request): {
  realmSlug: string;
  characterName: string;
} {
  return {
    realmSlug: String(req.params.realmSlug).trim().toLowerCase(),
    characterName: String(req.params.characterName).trim().toLowerCase(),
  };
}

export const CharacterHistoryController = {
  async history(req: Request, res: Response): Promise<void> {
    const parsed = historyQuerySchema.safeParse(req.query);

    if (!parsed.success) {
      res.status(400).json({ error: z.prettifyError(parsed.error) });
      return;
    }

    const { realmSlug, characterName } = characterIdentity(req);
    const { from, to, limit } = parsed.data;

    const snapshots = await CharacterSnapshotModel.listHistory({
      userId: req.user!.id,
      realmSlug,
      characterName,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      limit,
    });

    res.json(successResponse(snapshots));
  },

  async latest(req: Request, res: Response): Promise<void> {
    const { realmSlug, characterName } = characterIdentity(req);

    const snapshot = await CharacterSnapshotModel.findLatest({
      userId: req.user!.id,
      realmSlug,
      characterName,
    });

    if (!snapshot) {
      res.status(404).json({ error: 'No snapshot found' });
      return;
    }

    res.json(successResponse(snapshot));
  },
};
