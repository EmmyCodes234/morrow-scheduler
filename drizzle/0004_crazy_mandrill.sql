ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "notification_claim_token" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "notification_claimed_at" timestamp with time zone;
