import { Router } from 'express';
import { CharacterHistoryController } from '../controllers/CharacterHistory.controller.js';
import { ProfileController } from '../controllers/Profile.controller.js';
import { TrackedCharacterController } from '../controllers/TrackedCharacter.controller.js';
import { requireAuth } from '../middleware/RequireAuth.middleware.js';

export const profileRoutes = Router();

profileRoutes.get('/wow', requireAuth, ProfileController.wow);

profileRoutes.get(
  '/wow/tracked-characters',
  requireAuth,
  TrackedCharacterController.list,
);
profileRoutes.post(
  '/wow/tracked-characters',
  requireAuth,
  TrackedCharacterController.add,
);
profileRoutes.delete(
  '/wow/tracked-characters/:id',
  requireAuth,
  TrackedCharacterController.remove,
);

profileRoutes.get(
  '/wow/character/:realmSlug/:characterName',
  requireAuth,
  ProfileController.character,
);
profileRoutes.get(
  '/wow/character/:realmSlug/:characterName/achievements',
  requireAuth,
  ProfileController.characterAchievements,
);
profileRoutes.get(
  '/wow/character/:realmSlug/:characterName/equipment',
  requireAuth,
  ProfileController.characterEquipment,
);

profileRoutes.get(
  '/wow/character/:realmSlug/:characterName/history',
  requireAuth,
  CharacterHistoryController.history,
);
profileRoutes.get(
  '/wow/character/:realmSlug/:characterName/history/latest',
  requireAuth,
  CharacterHistoryController.latest,
);
