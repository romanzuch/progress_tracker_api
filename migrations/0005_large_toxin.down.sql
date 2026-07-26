DROP TABLE "character_snapshots";--> statement-breakpoint
DROP INDEX "tracked_characters_next_poll_at_idx";--> statement-breakpoint
ALTER TABLE "tracked_characters" DROP COLUMN "next_poll_at";--> statement-breakpoint
ALTER TABLE "tracked_characters" DROP COLUMN "poll_interval_minutes";
