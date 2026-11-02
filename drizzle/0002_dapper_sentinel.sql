-- 1. Ensure btree_gist extension is available
CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint

-- 2. Add last_sync_error column to bookings for discoverable calendar recovery
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "last_sync_error" text;--> statement-breakpoint

-- 3. Relax location_type on event_types to allow host default inheritance
ALTER TABLE "event_types" ALTER COLUMN "location_type" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "event_types" ALTER COLUMN "location_type" DROP DEFAULT;--> statement-breakpoint

-- 4. Atomically upgrade GiST exclusion constraint to strictly exclude 'cancelled' and 'rejected' bookings
-- Uses pg_get_constraintdef to inspect existing definition and replaces it safely with zero gap in protection
DO $$
DECLARE
  v_condef text;
  v_needs_upgrade boolean := false;
BEGIN
  -- Inspect existing constraint definition via pg_get_constraintdef
  SELECT pg_get_constraintdef(oid) INTO v_condef
  FROM pg_constraint
  WHERE conname = 'bookings_host_no_overlap' AND conrelid = 'bookings'::regclass;

  IF v_condef IS NULL THEN
    v_needs_upgrade := true;
  ELSIF v_condef NOT LIKE '%rejected%' THEN
    v_needs_upgrade := true;
  END IF;

  IF v_needs_upgrade THEN
    -- Step A: Add replacement constraint first to maintain continuous protection
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'bookings_host_no_overlap_v2' AND conrelid = 'bookings'::regclass
    ) THEN
      ALTER TABLE "bookings" ADD CONSTRAINT "bookings_host_no_overlap_v2"
      EXCLUDE USING gist (
        "host_id" WITH =,
        tstzrange("buffer_start_time", "buffer_end_time") WITH &&
      ) WHERE ("status" NOT IN ('cancelled', 'rejected'));
    END IF;

    -- Step B: Drop the old constraint now that replacement is active
    IF EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'bookings_host_no_overlap' AND conrelid = 'bookings'::regclass
    ) THEN
      ALTER TABLE "bookings" DROP CONSTRAINT "bookings_host_no_overlap";
    END IF;

    -- Step C: Rename replacement to canonical constraint name
    ALTER TABLE "bookings" RENAME CONSTRAINT "bookings_host_no_overlap_v2" TO "bookings_host_no_overlap";
  END IF;
END $$;
