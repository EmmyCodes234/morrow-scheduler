CREATE TABLE "meeting_attendees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meeting_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_normalized" text NOT NULL,
	"status" text DEFAULT 'registered' NOT NULL,
	"session_token" text NOT NULL,
	"joined_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meeting_attendees_session_token_unique" UNIQUE("session_token")
);
--> statement-breakpoint
CREATE TABLE "meetings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"host_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"start_time" timestamp with time zone NOT NULL,
	"end_time" timestamp with time zone NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"invitation_token" text NOT NULL,
	"invitation_token_hash" text NOT NULL,
	"preparation_material" text,
	"agenda" jsonb DEFAULT '[]'::jsonb,
	"opened_early_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meetings_invitation_token_unique" UNIQUE("invitation_token"),
	CONSTRAINT "meetings_invitation_token_hash_unique" UNIQUE("invitation_token_hash")
);
--> statement-breakpoint
ALTER TABLE "rooms" ALTER COLUMN "booking_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "meeting_id" uuid;--> statement-breakpoint
ALTER TABLE "meeting_attendees" ADD CONSTRAINT "meeting_attendees_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_host_id_users_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attendees_meeting_idx" ON "meeting_attendees" USING btree ("meeting_id");--> statement-breakpoint
CREATE UNIQUE INDEX "attendees_meeting_email_idx" ON "meeting_attendees" USING btree ("meeting_id","email_normalized");--> statement-breakpoint
CREATE UNIQUE INDEX "attendees_session_token_idx" ON "meeting_attendees" USING btree ("session_token");--> statement-breakpoint
CREATE INDEX "meetings_host_idx" ON "meetings" USING btree ("host_id");--> statement-breakpoint
CREATE INDEX "meetings_status_idx" ON "meetings" USING btree ("status");--> statement-breakpoint
CREATE INDEX "meetings_start_time_idx" ON "meetings" USING btree ("start_time");--> statement-breakpoint
CREATE UNIQUE INDEX "meetings_invitation_token_idx" ON "meetings" USING btree ("invitation_token");--> statement-breakpoint
CREATE UNIQUE INDEX "meetings_invitation_token_hash_idx" ON "meetings" USING btree ("invitation_token_hash");--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "rooms_meeting_idx" ON "rooms" USING btree ("meeting_id");