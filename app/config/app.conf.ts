import express, { type Express } from 'express';
import { applyMiddleware } from '../middleware/App.middleware.js';
import { errorHandler } from '../middleware/ErrorHandler.middleware.js';
import { appRoutes } from '../routes/App.routes.js';

export function createApp(): Express {
  const app = express();
  applyMiddleware(app);
  app.use('/api', appRoutes);
  app.use(errorHandler);
  return app;
}
