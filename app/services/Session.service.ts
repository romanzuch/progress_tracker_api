import jwt from 'jsonwebtoken';
import { sessionConfig } from '../config/session.conf.js';

export interface SessionPayload {
  userId: string;
}

export const SESSION_COOKIE_NAME = 'session';

export function signSession(userId: string): string {
  const payload: SessionPayload = { userId };
  return jwt.sign(payload, sessionConfig.jwtSecret, {
    expiresIn: sessionConfig.jwtExpiresIn as jwt.SignOptions['expiresIn'],
  });
}

export function verifySession(token: string): SessionPayload {
  const decoded = jwt.verify(token, sessionConfig.jwtSecret);
  if (typeof decoded === 'string' || typeof decoded.userId !== 'string') {
    throw new Error('Invalid session token payload');
  }
  return { userId: decoded.userId };
}
