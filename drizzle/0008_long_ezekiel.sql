ALTER TABLE "rooms" ADD COLUMN IF NOT EXISTS "synthesis_status" text DEFAULT 'idle' NOT NULL;--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN IF NOT EXISTS "synthesis_claim_token" text;--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN IF NOT EXISTS "synthesis_claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN IF NOT EXISTS "synthesis_last_error" text;
