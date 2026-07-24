import { Router } from 'express';
import { ProfileController } from '../controllers/Profile.controller.js';
import { requireAuth } from '../middleware/RequireAuth.middleware.js';

export const profileRoutes = Router();

profileRoutes.get('/wow', requireAuth, ProfileController.wow);
