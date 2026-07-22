import type { Request, Response } from 'express';
import { checkHealth } from '../database/index.js';
import { successResponse } from '../helpers/App.helper.js';

export const AppController = {
  async health(_req: Request, res: Response): Promise<void> {
    const dbHealthy = await checkHealth();

    if (!dbHealthy) {
      res
        .status(503)
        .json({
          success: false,
          data: { status: 'error', database: 'unreachable' },
        });
      return;
    }

    res.json(successResponse({ status: 'ok', database: 'connected' }));
  },
};
