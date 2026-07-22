import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { sessionConfig } from '../config/session.conf.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

const encryptionKey = Buffer.from(sessionConfig.tokenEncryptionKey, 'hex');

export interface EncryptedPayload {
  ciphertext: string;
  iv: string;
}

export function encrypt(plaintext: string): EncryptedPayload {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, encryptionKey, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return {
    ciphertext: Buffer.concat([encrypted, authTag]).toString('base64'),
    iv: iv.toString('base64'),
  };
}

export function decrypt(payload: EncryptedPayload): string {
  const iv = Buffer.from(payload.iv, 'base64');
  const combined = Buffer.from(payload.ciphertext, 'base64');
  const authTag = combined.subarray(combined.length - 16);
  const encrypted = combined.subarray(0, combined.length - 16);

  const decipher = createDecipheriv(ALGORITHM, encryptionKey, iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString(
    'utf8',
  );
}
