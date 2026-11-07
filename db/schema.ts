import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    slug: text("slug").notNull().unique(),
    avatarUrl: text("avatar_url"),
    timezone: text("timezone").notNull().default("UTC"),
    googleAccessToken: text("google_access_token"),
    googleRefreshToken: text("google_refresh_token"),
    googleTokenExpiry: timestamp("google_token_expiry", { withTimezone: true }),
    brandColor: text("brand_color").default("#2563EB"),
    welcomeMessage: text("welcome_message").default("Pick a time that works for you."),
    logoUrl: text("logo_url"),
    defaultLocationType: text("default_location_type").default("google_meet"),
    zoomMeetingUrl: text("zoom_meeting_url"),
    teamsMeetingUrl: text("teams_meeting_url"),
    zoomAccessToken: text("zoom_access_token"),
    zoomRefreshToken: text("zoom_refresh_token"),
    zoomTokenExpiry: timestamp("zoom_token_expiry", { withTimezone: true }),
    zoomEmail: text("zoom_email"),
    zoomConnectedAt: timestamp("zoom_connected_at", { withTimezone: true }),
    bufferMins: integer("buffer_mins").default(10),
    minNoticeHours: integer("min_notice_hours").default(2),
    maxBookingDays: integer("max_booking_days").default(30),
    officeStatus: text("office_status").notNull().default("closed"), // "open", "busy", "closed"
    officeTopic: text("office_topic"),
    officeSpeedChatMins: integer("office_speed_chat_mins").notNull().default(10),
    officeNotifyEmail: boolean("office_notify_email").notNull().default(true),
    officeAutoSchedule: boolean("office_auto_schedule").notNull().default(false),
    officeScheduleDays: jsonb("office_schedule_days").$type<number[]>().default([1, 2, 3, 4, 5]),
    officeScheduleStart: text("office_schedule_start").default("14:00"),
    officeScheduleEnd: text("office_schedule_end").default("16:00"),
    officeWebPushSubscriptions: jsonb("office_web_push_subscriptions").$type<Array<{ endpoint: string; keys: { p256dh: string; auth: string } }>>().default([]),
    onboardedAt: timestamp("onboarded_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("users_email_idx").on(table.email),
    uniqueIndex("users_slug_idx").on(table.slug),
  ]
);

export const eventTypes = pgTable(
  "event_types",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    slug: text("slug").notNull(),
    durationMins: integer("duration_mins").notNull().default(30),
    description: text("description"),
    locationType: text("location_type"), // Nullable to inherit from user.defaultLocationType
    locationUrl: text("location_url"),
    color: text("color").default("blue"),
    isActive: boolean("is_active").notNull().default(true),
    bufferBeforeMins: integer("buffer_before_mins").notNull().default(0),
    bufferAfterMins: integer("buffer_after_mins").notNull().default(0),
    minNoticeHours: integer("min_notice_hours").notNull().default(2),
    maxPerDay: integer("max_per_day"),
    requiresApproval: boolean("requires_approval").notNull().default(false),
    maxAttendees: integer("max_attendees").notNull().default(1),
    showRemainingSpots: boolean("show_remaining_spots").notNull().default(true),
    minAttendees: integer("min_attendees").default(1),
    redirectUrl: text("redirect_url"),
    questions: jsonb("questions").$type<Array<{ id: string; label: string; required: boolean; type?: string }>>().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("event_types_user_idx").on(table.userId),
    uniqueIndex("event_types_user_slug_idx").on(table.userId, table.slug),
  ]
);

export const availability = pgTable(
  "availability",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    dayOfWeek: integer("day_of_week").notNull(), // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
    startTime: text("start_time").notNull().default("09:00"),
    endTime: text("end_time").notNull().default("17:00"),
    isEnabled: boolean("is_enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("availability_user_idx").on(table.userId),
  ]
);

export const availabilityOverrides = pgTable(
  "availability_overrides",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    date: text("date").notNull(), // YYYY-MM-DD
    isBlocked: boolean("is_blocked").notNull().default(true),
    startTime: text("start_time"),
    endTime: text("end_time"),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("overrides_user_date_idx").on(table.userId, table.date),
  ]
);

export const bookings = pgTable(
  "bookings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventTypeId: uuid("event_type_id")
      .notNull()
      .references(() => eventTypes.id, { onDelete: "cascade" }),
    hostId: uuid("host_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    guestName: text("guest_name").notNull(),
    guestEmail: text("guest_email").notNull(),
    startTime: timestamp("start_time", { withTimezone: true }).notNull(),
    endTime: timestamp("end_time", { withTimezone: true }).notNull(),
    bufferStartTime: timestamp("buffer_start_time", { withTimezone: true }).notNull().defaultNow(),
    bufferEndTime: timestamp("buffer_end_time", { withTimezone: true }).notNull().defaultNow(),
    guestTimezone: text("guest_timezone").notNull().default("UTC"),
    meetLink: text("meet_link"),
    gcalEventId: text("gcal_event_id"),
    status: text("status").notNull().default("confirmed"), // confirmed, pending, cancelled, rejected, completed, no_show
    guestNotes: text("guest_notes"),
    hostNotes: text("host_notes"),
    additionalGuests: text("additional_guests"),
    idempotencyKey: text("idempotency_key"),
    requestHash: text("request_hash"),
    calendarSyncStatus: text("calendar_sync_status").notNull().default("not_applicable"),
    lastSyncError: text("last_sync_error"),
    notificationType: text("notification_type"), // approval, rejection, cancellation
    notificationStatus: text("notification_status").notNull().default("idle"), // idle, pending, sending, sent, failed
    notificationAttempts: integer("notification_attempts").notNull().default(0),
    notificationLastError: text("notification_last_error"),
    notificationSentAt: timestamp("notification_sent_at", { withTimezone: true }),
    notificationClaimToken: text("notification_claim_token"),
    notificationClaimedAt: timestamp("notification_claimed_at", { withTimezone: true }),
    notificationPayload: jsonb("notification_payload").$type<Record<string, unknown>>(),
    customAnswers: jsonb("custom_answers").$type<Record<string, unknown>>().default({}),
    cancelToken: text("cancel_token").notNull().unique(),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancellationReason: text("cancellation_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("bookings_host_idx").on(table.hostId),
    index("bookings_status_idx").on(table.status),
    index("bookings_start_time_idx").on(table.startTime),
    index("bookings_buffer_time_idx").on(table.hostId, table.bufferStartTime, table.bufferEndTime),
    uniqueIndex("bookings_cancel_token_idx").on(table.cancelToken),
    uniqueIndex("bookings_host_idempotency_idx").on(table.hostId, table.idempotencyKey),
  ]
);

export const bookingAttendees = pgTable(
  "booking_attendees",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "cascade" }),
    guestName: text("guest_name").notNull(),
    guestEmail: text("guest_email").notNull(),
    emailNormalized: text("email_normalized").notNull(),
    guestNotes: text("guest_notes"),
    customAnswers: jsonb("custom_answers").$type<Record<string, unknown>>().default({}),
    cancelToken: text("cancel_token").notNull().unique(),
    status: text("status").notNull().default("confirmed"), // confirmed, cancelled
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancellationReason: text("cancellation_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("booking_attendees_booking_idx").on(table.bookingId),
    index("booking_attendees_status_idx").on(table.status),
    uniqueIndex("booking_attendees_booking_email_idx").on(table.bookingId, table.emailNormalized),
    uniqueIndex("booking_attendees_cancel_token_idx").on(table.cancelToken),
  ]
);

export const officeKnocks = pgTable(
  "office_knocks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hostId: uuid("host_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    guestName: text("guest_name").notNull(),
    guestEmail: text("guest_email").notNull(),
    guestAvatarUrl: text("guest_avatar_url"),
    topic: text("topic").notNull(), // "What's on your mind?"
    status: text("status").notNull().default("ringing"), // "ringing", "admitted", "declined", "missed", "cancelled", "queued", "concluded"
    meetLink: text("meet_link"),
    googleCalendarEventId: text("google_calendar_event_id"),
    queuePosition: integer("queue_position").default(0),
    admittedAt: timestamp("admitted_at", { withTimezone: true }),
    concludedAt: timestamp("concluded_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("office_knocks_host_idx").on(table.hostId),
    index("office_knocks_status_idx").on(table.status),
    index("office_knocks_created_at_idx").on(table.createdAt),
  ]
);

export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    name: text("name").notNull(),
    totalBookings: integer("total_bookings").notNull().default(1),
    lastBookingAt: timestamp("last_booking_at", { withTimezone: true }).defaultNow().notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("contacts_user_idx").on(table.userId),
    uniqueIndex("contacts_user_email_idx").on(table.userId, table.email),
  ]
);

export const meetings = pgTable(
  "meetings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hostId: uuid("host_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    startTime: timestamp("start_time", { withTimezone: true }).notNull(),
    endTime: timestamp("end_time", { withTimezone: true }).notNull(),
    timezone: text("timezone").notNull().default("UTC"),
    status: text("status").notNull().default("scheduled"), // scheduled, in_progress, concluded, cancelled
    locationType: text("location_type").default("google_meet"),
    locationUrl: text("location_url"),
    invitationToken: text("invitation_token").notNull().unique(),
    invitationTokenHash: text("invitation_token_hash").notNull().unique(),
    preparationMaterial: text("preparation_material"),
    agenda: jsonb("agenda").$type<Array<{ id: string; text: string; done: boolean; addedBy: "host" | "guest" | "vera" }>>().default([]),
    openedEarlyAt: timestamp("opened_early_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("meetings_host_idx").on(table.hostId),
    index("meetings_status_idx").on(table.status),
    index("meetings_start_time_idx").on(table.startTime),
    uniqueIndex("meetings_invitation_token_idx").on(table.invitationToken),
    uniqueIndex("meetings_invitation_token_hash_idx").on(table.invitationTokenHash),
  ]
);

export const meetingAttendees = pgTable(
  "meeting_attendees",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    meetingId: uuid("meeting_id")
      .notNull()
      .references(() => meetings.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    email: text("email").notNull(),
    emailNormalized: text("email_normalized").notNull(),
    status: text("status").notNull().default("registered"), // registered, joined, declined
    sessionToken: text("session_token").notNull().unique(),
    joinedAt: timestamp("joined_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("attendees_meeting_idx").on(table.meetingId),
    uniqueIndex("attendees_meeting_email_idx").on(table.meetingId, table.emailNormalized),
    uniqueIndex("attendees_session_token_idx").on(table.sessionToken),
  ]
);

export const rooms = pgTable(
  "rooms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookingId: uuid("booking_id")
      .references(() => bookings.id, { onDelete: "cascade" }),
    meetingId: uuid("meeting_id")
      .references(() => meetings.id, { onDelete: "cascade" }),
    accessToken: text("access_token").notNull().unique(),
    status: text("status").notNull().default("pre_meeting"), // pre_meeting, in_progress, concluded
    agenda: jsonb("agenda").$type<Array<{ id: string; text: string; done: boolean; addedBy: "host" | "guest" | "vera" }>>().default([]),
    sharedNotes: text("shared_notes").default(""),
    veraBrief: jsonb("vera_brief").$type<{
      intent?: string;
      talkingPoints?: string[];
      background?: string;
    }>(),
    veraLedger: jsonb("vera_ledger").$type<{
      executiveSummary?: Array<string | { claim: string; evidence: string }>;
      actionItems?: Array<{
        id: string;
        task: string;
        assignee: string;
        priority: "high" | "medium" | "low";
        done: boolean;
        deadline?: string;
        evidence?: string;
      }>;
      keyDecisions?: Array<string | { decision: string; status: "confirmed" | "proposed" | "open_question"; evidence: string }>;
      suggestedFollowUp?: string;
      reviewStatus?: "pending_host_review" | "approved";
      approvedAt?: string;
      approvedBy?: string;
    }>(),
    transcript: text("transcript"),
    synthesisStatus: text("synthesis_status").notNull().default("idle"), // idle, synthesizing, completed, failed
    synthesisClaimToken: text("synthesis_claim_token"),
    synthesisClaimedAt: timestamp("synthesis_claimed_at", { withTimezone: true }),
    synthesisLastError: text("synthesis_last_error"),
    files: jsonb("files").$type<Array<{
      id: string;
      name: string;
      size: number;
      type: string;
      url?: string;
      dataUrl?: string;
      uploadedBy: string;
      uploadedAt: string;
    }>>().default([]).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("rooms_booking_idx").on(table.bookingId),
    uniqueIndex("rooms_meeting_idx").on(table.meetingId),
    uniqueIndex("rooms_access_token_idx").on(table.accessToken),
  ]
);

export const verificationTokens = pgTable(
  "verification_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    token: text("token").notNull(), // 6-digit OTP code
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("verification_tokens_email_idx").on(table.email),
  ]
);

// RELATIONS
export const usersRelations = relations(users, ({ many }) => ({
  eventTypes: many(eventTypes),
  availability: many(availability),
  availabilityOverrides: many(availabilityOverrides),
  bookings: many(bookings),
  contacts: many(contacts),
  meetings: many(meetings),
  knocks: many(officeKnocks),
}));

export const meetingsRelations = relations(meetings, ({ one, many }) => ({
  host: one(users, {
    fields: [meetings.hostId],
    references: [users.id],
  }),
  room: one(rooms),
  attendees: many(meetingAttendees),
}));

export const meetingAttendeesRelations = relations(meetingAttendees, ({ one }) => ({
  meeting: one(meetings, {
    fields: [meetingAttendees.meetingId],
    references: [meetings.id],
  }),
}));

export const eventTypesRelations = relations(eventTypes, ({ one, many }) => ({
  user: one(users, {
    fields: [eventTypes.userId],
    references: [users.id],
  }),
  bookings: many(bookings),
}));

export const bookingsRelations = relations(bookings, ({ one, many }) => ({
  eventType: one(eventTypes, {
    fields: [bookings.eventTypeId],
    references: [eventTypes.id],
  }),
  host: one(users, {
    fields: [bookings.hostId],
    references: [users.id],
  }),
  room: one(rooms),
  attendees: many(bookingAttendees),
}));

export const bookingAttendeesRelations = relations(bookingAttendees, ({ one }) => ({
  booking: one(bookings, {
    fields: [bookingAttendees.bookingId],
    references: [bookings.id],
  }),
}));

export const officeKnocksRelations = relations(officeKnocks, ({ one }) => ({
  host: one(users, {
    fields: [officeKnocks.hostId],
    references: [users.id],
  }),
}));

export const availabilityRelations = relations(availability, ({ one }) => ({
  user: one(users, {
    fields: [availability.userId],
    references: [users.id],
  }),
}));

export const availabilityOverridesRelations = relations(availabilityOverrides, ({ one }) => ({
  user: one(users, {
    fields: [availabilityOverrides.userId],
    references: [users.id],
  }),
}));

export const contactsRelations = relations(contacts, ({ one }) => ({
  user: one(users, {
    fields: [contacts.userId],
    references: [users.id],
  }),
}));

export const roomsRelations = relations(rooms, ({ one }) => ({
  booking: one(bookings, {
    fields: [rooms.bookingId],
    references: [bookings.id],
  }),
  meeting: one(meetings, {
    fields: [rooms.meetingId],
    references: [meetings.id],
  }),
}));

// TYPE EXPORTS
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export type EventType = typeof eventTypes.$inferSelect;
export type NewEventType = typeof eventTypes.$inferInsert;

export type Availability = typeof availability.$inferSelect;
export type NewAvailability = typeof availability.$inferInsert;

export type AvailabilityOverride = typeof availabilityOverrides.$inferSelect;
export type NewAvailabilityOverride = typeof availabilityOverrides.$inferInsert;

export type Booking = typeof bookings.$inferSelect;
export type NewBooking = typeof bookings.$inferInsert;

export type BookingAttendee = typeof bookingAttendees.$inferSelect;
export type NewBookingAttendee = typeof bookingAttendees.$inferInsert;

export type Meeting = typeof meetings.$inferSelect;
export type NewMeeting = typeof meetings.$inferInsert;

export type MeetingAttendee = typeof meetingAttendees.$inferSelect;
export type NewMeetingAttendee = typeof meetingAttendees.$inferInsert;

export type Contact = typeof contacts.$inferSelect;
export type NewContact = typeof contacts.$inferInsert;

export type VerificationToken = typeof verificationTokens.$inferSelect;
export type NewVerificationToken = typeof verificationTokens.$inferInsert;

export type Room = typeof rooms.$inferSelect;
export type NewRoom = typeof rooms.$inferInsert;

export type OfficeKnock = typeof officeKnocks.$inferSelect;
export type NewOfficeKnock = typeof officeKnocks.$inferInsert;
