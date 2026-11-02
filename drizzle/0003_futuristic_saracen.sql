ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "notification_type" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "notification_status" text DEFAULT 'idle' NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "notification_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "notification_last_error" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "notification_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "notification_payload" jsonb;