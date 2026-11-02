CREATE TABLE "availability" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"day_of_week" integer NOT NULL,
	"start_time" text DEFAULT '09:00' NOT NULL,
	"end_time" text DEFAULT '17:00' NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "availability_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"date" text NOT NULL,
	"is_blocked" boolean DEFAULT true NOT NULL,
	"start_time" text,
	"end_time" text,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type_id" uuid NOT NULL,
	"host_id" uuid NOT NULL,
	"guest_name" text NOT NULL,
	"guest_email" text NOT NULL,
	"start_time" timestamp with time zone NOT NULL,
	"end_time" timestamp with time zone NOT NULL,
	"buffer_start_time" timestamp with time zone DEFAULT now() NOT NULL,
	"buffer_end_time" timestamp with time zone DEFAULT now() NOT NULL,
	"guest_timezone" text DEFAULT 'UTC' NOT NULL,
	"meet_link" text,
	"gcal_event_id" text,
	"status" text DEFAULT 'confirmed' NOT NULL,
	"guest_notes" text,
	"host_notes" text,
	"additional_guests" text,
	"idempotency_key" text,
	"custom_answers" jsonb DEFAULT '{}'::jsonb,
	"cancel_token" text NOT NULL,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bookings_cancel_token_unique" UNIQUE("cancel_token")
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"total_bookings" integer DEFAULT 1 NOT NULL,
	"last_booking_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"duration_mins" integer DEFAULT 30 NOT NULL,
	"description" text,
	"location_type" text DEFAULT 'google_meet' NOT NULL,
	"location_url" text,
	"color" text DEFAULT 'blue',
	"is_active" boolean DEFAULT true NOT NULL,
	"buffer_before_mins" integer DEFAULT 0 NOT NULL,
	"buffer_after_mins" integer DEFAULT 0 NOT NULL,
	"min_notice_hours" integer DEFAULT 2 NOT NULL,
	"max_per_day" integer,
	"requires_approval" boolean DEFAULT false NOT NULL,
	"redirect_url" text,
	"questions" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"slug" text NOT NULL,
	"avatar_url" text,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"google_access_token" text,
	"google_refresh_token" text,
	"google_token_expiry" timestamp with time zone,
	"brand_color" text DEFAULT '#2563EB',
	"welcome_message" text DEFAULT 'Pick a time that works for you.',
	"logo_url" text,
	"default_location_type" text DEFAULT 'google_meet',
	"zoom_meeting_url" text,
	"buffer_mins" integer DEFAULT 10,
	"min_notice_hours" integer DEFAULT 2,
	"max_booking_days" integer DEFAULT 30,
	"onboarded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "verification_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "availability" ADD CONSTRAINT "availability_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_overrides" ADD CONSTRAINT "availability_overrides_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_event_type_id_event_types_id_fk" FOREIGN KEY ("event_type_id") REFERENCES "public"."event_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_host_id_users_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_types" ADD CONSTRAINT "event_types_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "availability_user_idx" ON "availability" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "overrides_user_date_idx" ON "availability_overrides" USING btree ("user_id","date");--> statement-breakpoint
CREATE INDEX "bookings_host_idx" ON "bookings" USING btree ("host_id");--> statement-breakpoint
CREATE INDEX "bookings_status_idx" ON "bookings" USING btree ("status");--> statement-breakpoint
CREATE INDEX "bookings_start_time_idx" ON "bookings" USING btree ("start_time");--> statement-breakpoint
CREATE INDEX "bookings_buffer_time_idx" ON "bookings" USING btree ("host_id","buffer_start_time","buffer_end_time");--> statement-breakpoint
CREATE UNIQUE INDEX "bookings_cancel_token_idx" ON "bookings" USING btree ("cancel_token");--> statement-breakpoint
CREATE UNIQUE INDEX "bookings_idempotency_key_idx" ON "bookings" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "contacts_user_idx" ON "contacts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_user_email_idx" ON "contacts" USING btree ("user_id","email");--> statement-breakpoint
CREATE INDEX "event_types_user_idx" ON "event_types" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "event_types_user_slug_idx" ON "event_types" USING btree ("user_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "users_slug_idx" ON "users" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "verification_tokens_email_idx" ON "verification_tokens" USING btree ("email");--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bookings_host_no_overlap'
  ) THEN
    ALTER TABLE "bookings" ADD CONSTRAINT "bookings_host_no_overlap"
    EXCLUDE USING gist (
      "host_id" WITH =,
      tstzrange("buffer_start_time", "buffer_end_time") WITH &&
    ) WHERE ("status" != 'cancelled');
  END IF;
END $$;
