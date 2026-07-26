import { describe, expect, it } from 'vitest';
import { sha256Json } from '../app/utils/Hash.util.js';

describe('sha256Json', () => {
  it('returns the same digest for identical payloads', () => {
    const payloads = [
      { level: 80, experience: 0 },
      { total_quantity: 1234 },
      { equipped_items: [{ slot: { type: 'HEAD' } }] },
    ];

    expect(sha256Json(payloads)).toBe(sha256Json(structuredClone(payloads)));
  });

  it('returns a different digest when any payload changes', () => {
    const before = sha256Json([{ level: 80 }, {}, {}]);
    const after = sha256Json([{ level: 81 }, {}, {}]);

    expect(after).not.toBe(before);
  });

  it('detects a change that moves no numeric metric', () => {
    const before = sha256Json([{ level: 80 }, {}, { item_level: 620 }]);
    const after = sha256Json([{ level: 80 }, {}, { item_level: 625 }]);

    expect(after).not.toBe(before);
  });

  it('produces a 64-character hex digest', () => {
    expect(sha256Json({})).toMatch(/^[0-9a-f]{64}$/);
  });
});
