import { aggregationConfig } from '../config/aggregation.conf.js';

export interface SnapshotRunSummary {
  due: number;
  succeeded: number;
  failed: number;
}

// The whole adaptive-cadence rule: a character that changed gets the fast
// cadence again, one that didn't backs off toward the idle floor. Doubling
// rather than jumping straight to the floor, so a brief lull mid-session
// doesn't cost the rest of the session's resolution.
export function nextPollInterval(
  currentIntervalMinutes: number,
  changed: boolean,
): number {
  if (changed) {
    return aggregationConfig.snapshotActiveIntervalMinutes;
  }

  return Math.min(
    currentIntervalMinutes * 2,
    aggregationConfig.snapshotIdleIntervalMinutes,
  );
}
