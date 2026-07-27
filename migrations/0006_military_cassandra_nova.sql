ALTER TABLE "character_snapshots" ALTER COLUMN "profile_payload" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "character_snapshots" ALTER COLUMN "achievements_payload" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "character_snapshots" ALTER COLUMN "equipment_payload" DROP NOT NULL;