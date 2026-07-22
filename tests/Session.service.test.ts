import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { describe, expect, it } from 'vitest';
import { signSession, verifySession } from '../app/services/Session.service.js';

describe('Session.service', () => {
  it('signs and verifies a session token', () => {
    const userId = randomUUID();
    const token = signSession(userId);

    expect(verifySession(token)).toEqual({ userId });
  });

  it('rejects a malformed token', () => {
    expect(() => verifySession('not-a-valid-jwt')).toThrow();
  });

  it('rejects a token signed with a different secret', () => {
    const forged = jwt.sign(
      { userId: randomUUID() },
      'a-completely-different-secret',
    );

    expect(() => verifySession(forged)).toThrow();
  });
});
