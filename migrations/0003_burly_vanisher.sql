ALTER TABLE "battlenet_tokens" ALTER COLUMN "refresh_token_encrypted" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "battlenet_tokens" ALTER COLUMN "refresh_token_iv" DROP NOT NULL;