CREATE TABLE "battlenet_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"access_token" text NOT NULL,
	"access_token_expires_at" timestamp NOT NULL,
	"refresh_token_encrypted" text NOT NULL,
	"refresh_token_iv" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"battlenet_id" text NOT NULL,
	"battletag" text,
	"needs_reauth" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "battlenet_tokens" ADD CONSTRAINT "battlenet_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "battlenet_tokens_user_id_idx" ON "battlenet_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_battlenet_id_idx" ON "users" USING btree ("battlenet_id");