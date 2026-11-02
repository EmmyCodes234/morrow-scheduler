-- 1. Install btree_gist extension required for GiST UUID and exclusion constraints
CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint

-- 2. Add columns if not already present
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "buffer_start_time" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "buffer_end_time" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "additional_guests" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "request_hash" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "calendar_sync_status" text DEFAULT 'not_applicable' NOT NULL;--> statement-breakpoint

-- 3. Safely backfill buffer timestamps for any existing rows preserving event and host rules
UPDATE "bookings" b
SET
  "buffer_start_time" = COALESCE(
    b."buffer_start_time",
    b."start_time" - (COALESCE(et."buffer_before_mins", 0) || ' minutes')::interval,
    b."start_time"
  ),
  "buffer_end_time" = COALESCE(
    b."buffer_end_time",
    b."end_time" + (COALESCE(NULLIF(et."buffer_after_mins", 0), u."buffer_mins", 0) || ' minutes')::interval,
    b."end_time"
  )
FROM "event_types" et, "users" u
WHERE b."event_type_id" = et."id" AND b."host_id" = u."id"
  AND (b."buffer_start_time" IS NULL OR b."buffer_end_time" IS NULL);--> statement-breakpoint

-- Fallback for any orphaned rows without matching host or event
UPDATE "bookings"
SET
  "buffer_start_time" = COALESCE("buffer_start_time", "start_time"),
  "buffer_end_time" = COALESCE("buffer_end_time", "end_time")
WHERE "buffer_start_time" IS NULL OR "buffer_end_time" IS NULL;--> statement-breakpoint

-- Enforce NOT NULL on buffer timestamps
ALTER TABLE "bookings" ALTER COLUMN "buffer_start_time" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ALTER COLUMN "buffer_end_time" SET NOT NULL;--> statement-breakpoint

-- 4. Create buffer range index
CREATE INDEX IF NOT EXISTS "bookings_buffer_time_idx" ON "bookings" USING btree ("host_id", "buffer_start_time", "buffer_end_time");--> statement-breakpoint

-- 5. Scope idempotency key to host
DROP INDEX IF EXISTS "bookings_idempotency_key_idx";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bookings_host_idempotency_idx" ON "bookings" USING btree ("host_id", "idempotency_key");--> statement-breakpoint

-- 6. Check for existing overlapping reservations and apply GiST exclusion constraint
DO $$
DECLARE
  conflict_count integer;
BEGIN
  -- Detect if existing active rows contain overlapping buffer intervals
  SELECT count(*) INTO conflict_count
  FROM "bookings" b1
  JOIN "bookings" b2 ON b1."host_id" = b2."host_id" AND b1."id" < b2."id"
  WHERE b1."status" NOT IN ('cancelled', 'rejected')
    AND b2."status" NOT IN ('cancelled', 'rejected')
    AND tstzrange(b1."buffer_start_time", b1."buffer_end_time") && tstzrange(b2."buffer_start_time", b2."buffer_end_time");

  IF conflict_count > 0 THEN
    RAISE NOTICE 'Warning: Detected % existing overlapping booking pairs. Please review legacy records.', conflict_count;
  END IF;

  -- Add exclusion constraint if not already created
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bookings_host_no_overlap'
  ) THEN
    ALTER TABLE "bookings" ADD CONSTRAINT "bookings_host_no_overlap"
    EXCLUDE USING gist (
      "host_id" WITH =,
      tstzrange("buffer_start_time", "buffer_end_time") WITH &&
    ) WHERE ("status" NOT IN ('cancelled', 'rejected'));
  END IF;
END $$;
