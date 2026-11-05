CREATE TABLE "rooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"access_token" text NOT NULL,
	"status" text DEFAULT 'pre_meeting' NOT NULL,
	"agenda" jsonb DEFAULT '[]'::jsonb,
	"shared_notes" text DEFAULT '',
	"vera_brief" jsonb,
	"vera_ledger" jsonb,
	"transcript" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rooms_access_token_unique" UNIQUE("access_token")
);
--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rooms_booking_idx" ON "rooms" USING btree ("booking_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rooms_access_token_idx" ON "rooms" USING btree ("access_token");