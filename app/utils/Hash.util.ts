import { createHash } from 'node:crypto';

// Change-detection signal for Battle.net payloads. JSON.stringify preserves the
// key order Blizzard sends, so two identical responses hash identically; if some
// field ever churns on its own, the only cost is polling that character every 30
// minutes instead of every 6 hours.
export function sha256Json(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
