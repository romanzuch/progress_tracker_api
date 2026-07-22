import type { NextFunction, Request, Response } from 'express';
import {
  SESSION_COOKIE_NAME,
  verifySession,
} from '../services/Session.service.js';

declare module 'express-serve-static-core' {
  interface Request {
    user?: { id: string };
  }
}

export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const token = req.cookies?.[SESSION_COOKIE_NAME] as string | undefined;

  if (!token) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  try {
    const { userId } = verifySession(token);
    req.user = { id: userId };
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired session' });
  }
}
