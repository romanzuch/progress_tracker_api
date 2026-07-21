import type { Request, Response } from 'express';
import { successResponse } from '../helpers/App.helper.js';

export const AppController = {
  health(_req: Request, res: Response): void {
    res.json(successResponse({ status: 'ok' }));
  },
};
