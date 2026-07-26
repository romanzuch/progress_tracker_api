import type { Request, Response } from 'express';
import { z } from 'zod';
import { successResponse } from '../helpers/App.helper.js';
import { TrackedCharacterModel } from '../models/TrackedCharacter.model.js';

// Normalized to lowercase so the unique index treats "Thrall" and "thrall" as
// the same character, matching how the Battle.net character endpoints are keyed.
const addTrackedCharacterSchema = z.object({
  realmSlug: z.string().trim().min(1).toLowerCase(),
  characterName: z.string().trim().min(1).toLowerCase(),
});

export const TrackedCharacterController = {
  async list(req: Request, res: Response): Promise<void> {
    const trackedCharacters = await TrackedCharacterModel.listByUser(
      req.user!.id,
    );
    res.json(successResponse(trackedCharacters));
  },

  async add(req: Request, res: Response): Promise<void> {
    const parsed = addTrackedCharacterSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({ error: z.prettifyError(parsed.error) });
      return;
    }

    const trackedCharacter = await TrackedCharacterModel.create({
      userId: req.user!.id,
      realmSlug: parsed.data.realmSlug,
      characterName: parsed.data.characterName,
    });
    res.json(successResponse(trackedCharacter));
  },

  async remove(req: Request, res: Response): Promise<void> {
    const parsedId = z.uuid().safeParse(req.params.id);

    if (!parsedId.success) {
      res.status(404).json({ error: 'Tracked character not found' });
      return;
    }

    const trackedCharacter = await TrackedCharacterModel.deleteById(
      parsedId.data,
      req.user!.id,
    );

    if (!trackedCharacter) {
      res.status(404).json({ error: 'Tracked character not found' });
      return;
    }

    res.json(successResponse(trackedCharacter));
  },
};
