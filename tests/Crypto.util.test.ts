import { describe, expect, it } from 'vitest';
import { decrypt, encrypt } from '../app/utils/Crypto.util.js';

describe('Crypto.util', () => {
  it('round-trips plaintext through encrypt/decrypt', () => {
    const plaintext = 'super-secret-refresh-token';
    const payload = encrypt(plaintext);

    expect(payload.ciphertext).not.toContain(plaintext);
    expect(decrypt(payload)).toBe(plaintext);
  });

  it('produces a different ciphertext and iv each time', () => {
    const a = encrypt('same-input');
    const b = encrypt('same-input');

    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(a.iv).not.toBe(b.iv);
  });

  it('fails to decrypt with a tampered ciphertext', () => {
    const payload = encrypt('another-secret');
    const tampered = {
      ...payload,
      ciphertext: `${payload.ciphertext.slice(0, -4)}abcd`,
    };

    expect(() => decrypt(tampered)).toThrow();
  });
});
