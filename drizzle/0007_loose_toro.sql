ALTER TABLE "rooms" ADD COLUMN IF NOT EXISTS "files" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
DO $$
DECLARE
    duplicate_count integer;
BEGIN
    SELECT COUNT(*) INTO duplicate_count
    FROM (
        SELECT booking_id
        FROM rooms
        GROUP BY booking_id
        HAVING COUNT(*) > 1
    ) duplicates;

    IF duplicate_count > 0 THEN
        RAISE EXCEPTION 'Cannot apply unique index on rooms.booking_id: % duplicate booking_id groups detected in rooms table. Manual reconciliation required to preserve access tokens and room contents.', duplicate_count;
    END IF;
END $$;--> statement-breakpoint
DROP INDEX IF EXISTS "rooms_booking_idx";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "rooms_booking_idx" ON "rooms" USING btree ("booking_id");
