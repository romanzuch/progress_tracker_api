import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { UserModel } from '../models/User.model.js';

const createUserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
});

export const UserController = {
  list(_req: Request, res: Response): void {
    res.json(UserModel.findAll());
  },
  create(req: Request, res: Response, next: NextFunction): void {
    const parsed = createUserSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    try {
      const user = UserModel.create(parsed.data);
      res.status(201).json(user);
    } catch (err) {
      next(err);
    }
  },
};
