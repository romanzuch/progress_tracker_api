import { Router } from 'express';
import { AuthController } from '../controllers/Auth.controller.js';

export const authRoutes = Router();

authRoutes.get('/battlenet', AuthController.login);
authRoutes.get('/battlenet/callback', (req, res, next) => {
  AuthController.callback(req, res).catch(next);
});
authRoutes.post('/logout', AuthController.logout);
