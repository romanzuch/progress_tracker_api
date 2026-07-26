CREATE TABLE "tracked_characters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"realm_slug" text NOT NULL,
	"character_name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tracked_characters" ADD CONSTRAINT "tracked_characters_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tracked_characters_user_id_realm_slug_character_name_idx" ON "tracked_characters" USING btree ("user_id","realm_slug","character_name");