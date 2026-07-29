import type { Request, Response } from 'express';
import { TrackedCharacterModel } from '../models/TrackedCharacter.model.js';
import {
  CharacterSnapshotModel,
  type CharacterSnapshotSummary,
} from '../models/CharacterSnapshot.model.js';
import { successResponse } from '../helpers/App.helper.js';

interface CharacterOverviewEntry {
  id: string;
  realmSlug: string;
  characterName: string;
  latestSnapshot: CharacterSnapshotSummary | null;
}

export const CharacterOverviewController = {
  async list(req: Request, res: Response): Promise<void> {
    const userId = req.user!.id;

    const [trackedCharacters, latestSnapshots] = await Promise.all([
      TrackedCharacterModel.listByUser(userId),
      CharacterSnapshotModel.findLatestForUser(userId),
    ]);

    const latestByIdentity = new Map<string, CharacterSnapshotSummary>(
      latestSnapshots.map(
        ({ realmSlug, characterName, ...summary }) =>
          [`${realmSlug}:${characterName}`, summary] as const,
      ),
    );

    const overview: CharacterOverviewEntry[] = trackedCharacters.map(
      (character) => ({
        id: character.id,
        realmSlug: character.realmSlug,
        characterName: character.characterName,
        latestSnapshot:
          latestByIdentity.get(
            `${character.realmSlug}:${character.characterName}`,
          ) ?? null,
      }),
    );

    res.json(successResponse(overview));
  },
};
