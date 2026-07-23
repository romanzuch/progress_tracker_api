import { Router } from 'express';
import { AppController } from '../controllers/App.controller.js';
import { authRoutes } from './Auth.routes.js';
import { profileRoutes } from './Profile.routes.js';
// import { dashboardRoutes } from './Dashboard.routes.js';

export const appRoutes = Router();

appRoutes.get('/health', AppController.health);
appRoutes.use('/auth', authRoutes);
appRoutes.use('/profile', profileRoutes);
// appRoutes.use('/dashboard', dashboardRoutes);
