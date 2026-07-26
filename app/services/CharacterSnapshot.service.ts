import { aggregationConfig } from '../config/aggregation.conf.js';
import {
  battleNetAppProfileClient,
  type BattleNetPayload,
} from '../http/BattleNetAppProfileClient.js';
import { CharacterSnapshotModel } from '../models/CharacterSnapshot.model.js';
import {
  TrackedCharacterModel,
  type TrackedCharacter,
} from '../models/TrackedCharacter.model.js';
import { sha256Json } from '../utils/Hash.util.js';
import { logger } from '../utils/Logger.util.js';

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

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}

function timestampOrNull(value: unknown): Date | null {
  return typeof value === 'number' ? new Date(value) : null;
}

function extractMetrics(
  profile: BattleNetPayload,
  achievements: BattleNetPayload,
) {
  return {
    level: numberOrNull(profile.level),
    experience: numberOrNull(profile.experience),
    achievementPoints: numberOrNull(profile.achievement_points),
    achievementsCompleted: numberOrNull(achievements.total_quantity),
    averageItemLevel: numberOrNull(profile.average_item_level),
    equippedItemLevel: numberOrNull(profile.equipped_item_level),
    lastLoginAt: timestampOrNull(profile.last_login_timestamp),
  };
}

async function reschedule(
  character: TrackedCharacter,
  changed: boolean,
): Promise<void> {
  const pollIntervalMinutes = nextPollInterval(
    character.pollIntervalMinutes,
    changed,
  );

  await TrackedCharacterModel.updateSchedule(character.id, {
    nextPollAt: new Date(Date.now() + pollIntervalMinutes * 60_000),
    pollIntervalMinutes,
  });
}

async function snapshotCharacter(character: TrackedCharacter): Promise<void> {
  const { userId, realmSlug, characterName } = character;

  const [profile, achievements, equipment] = await Promise.all([
    battleNetAppProfileClient.getCharacterProfile(realmSlug, characterName),
    battleNetAppProfileClient.getCharacterAchievements(
      realmSlug,
      characterName,
    ),
    battleNetAppProfileClient.getCharacterEquipment(realmSlug, characterName),
  ]);

  const payloadHash = sha256Json([profile, achievements, equipment]);
  const previousHash = await CharacterSnapshotModel.findLatestHash({
    userId,
    realmSlug,
    characterName,
  });

  await CharacterSnapshotModel.create({
    userId,
    realmSlug,
    characterName,
    payloadHash,
    ...extractMetrics(profile, achievements),
    profilePayload: profile,
    achievementsPayload: achievements,
    equipmentPayload: equipment,
  });

  // No previous hash means a first-ever poll, which counts as changed so the
  // character starts out on the fast cadence.
  await reschedule(character, payloadHash !== previousHash);
}

// Polls every tracked character whose next_poll_at has come due, across all
// users, using the app-level token — no user session, login, or needs_reauth
// state is involved. Characters are polled sequentially (Blizzard's rate ceiling
// is orders of magnitude above this volume, and sequential execution keeps
// failure attribution obvious), with each character's three endpoint calls
// issued in parallel.
export async function runDueSnapshots(): Promise<SnapshotRunSummary> {
  const due = await TrackedCharacterModel.listDue(new Date());

  if (due.length === 0) {
    logger.info('[snapshots] no characters due');
    return { due: 0, succeeded: 0, failed: 0 };
  }

  let succeeded = 0;
  let failed = 0;

  for (const character of due) {
    try {
      await snapshotCharacter(character);
      succeeded += 1;
    } catch (err) {
      failed += 1;
      logger.error(
        `[snapshots] ${character.realmSlug}/${character.characterName} failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      // A renamed, transferred, or deleted character 404s forever. Back it off
      // anyway, or it stays due on every heartbeat.
      try {
        await reschedule(character, false);
      } catch (rescheduleErr) {
        // If even the backoff write fails (DB blip, dropped connection), don't
        // let that abort the whole run — the character just stays due and gets
        // retried next heartbeat instead of blocking every character after it.
        logger.error(
          `[snapshots] ${character.realmSlug}/${character.characterName} reschedule failed: ${
            rescheduleErr instanceof Error
              ? rescheduleErr.message
              : String(rescheduleErr)
          }`,
        );
      }
    }
  }

  const summary = { due: due.length, succeeded, failed };
  logger.info(
    `[snapshots] run complete: due=${summary.due} succeeded=${summary.succeeded} failed=${summary.failed}`,
  );
  return summary;
}
