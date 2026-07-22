import { z } from 'zod';
import { sessionKeys } from './session.keys.js';

const sessionConfigSchema = z.object({
  jwtSecret: z
    .string()
    .min(32, 'SESSION_JWT_SECRET must be at least 32 characters'),
  jwtExpiresIn: z.string().min(1),
  tokenEncryptionKey: z
    .string()
    .refine((key) => Buffer.from(key, 'hex').length === 32, {
      message:
        'TOKEN_ENCRYPTION_KEY must be a 64-character hex string (32 bytes)',
    }),
});

const parsed = sessionConfigSchema.safeParse(sessionKeys);

if (!parsed.success) {
  throw new Error(
    `Invalid session configuration: ${z.prettifyError(parsed.error)}`,
  );
}

export const sessionConfig = parsed.data;
