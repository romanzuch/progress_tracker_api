CREATE TABLE "character_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"realm_slug" text NOT NULL,
	"character_name" text NOT NULL,
	"captured_at" timestamp DEFAULT now() NOT NULL,
	"payload_hash" text NOT NULL,
	"level" integer,
	"experience" integer,
	"achievement_points" integer,
	"achievements_completed" integer,
	"average_item_level" integer,
	"equipped_item_level" integer,
	"last_login_at" timestamp,
	"profile_payload" jsonb NOT NULL,
	"achievements_payload" jsonb NOT NULL,
	"equipment_payload" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tracked_characters" ADD COLUMN "next_poll_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "tracked_characters" ADD COLUMN "poll_interval_minutes" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "character_snapshots" ADD CONSTRAINT "character_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "character_snapshots_character_captured_at_idx" ON "character_snapshots" USING btree ("user_id","realm_slug","character_name","captured_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "tracked_characters_next_poll_at_idx" ON "tracked_characters" USING btree ("next_poll_at");