ALTER TABLE "battlenet_tokens" ALTER COLUMN "refresh_token_encrypted" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "battlenet_tokens" ALTER COLUMN "refresh_token_iv" SET NOT NULL;
