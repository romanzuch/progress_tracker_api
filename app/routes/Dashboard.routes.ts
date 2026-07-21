import { Router } from 'express';

export const dashboardRoutes = Router();

dashboardRoutes.get('/', (_req, res) => {
  res.json({ message: 'Dashboard routes placeholder' });
});
