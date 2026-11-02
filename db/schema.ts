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
    bufferMins: integer("buffer_mins").default(10),
    minNoticeHours: integer("min_notice_hours").default(2),
    maxBookingDays: integer("max_booking_days").default(30),
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
    locationType: text("location_type").notNull().default("google_meet"),
    locationUrl: text("location_url"),
    color: text("color").default("blue"),
    isActive: boolean("is_active").notNull().default(true),
    bufferBeforeMins: integer("buffer_before_mins").notNull().default(0),
    bufferAfterMins: integer("buffer_after_mins").notNull().default(0),
    minNoticeHours: integer("min_notice_hours").notNull().default(2),
    maxPerDay: integer("max_per_day"),
    requiresApproval: boolean("requires_approval").notNull().default(false),
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
    status: text("status").notNull().default("confirmed"), // confirmed, cancelled, completed, no_show
    guestNotes: text("guest_notes"),
    hostNotes: text("host_notes"),
    additionalGuests: text("additional_guests"),
    idempotencyKey: text("idempotency_key"),
    customAnswers: jsonb("custom_answers").$type<Record<string, unknown>>().default({}),
    cancelToken: text("cancel_token").notNull().unique(),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("bookings_host_idx").on(table.hostId),
    index("bookings_status_idx").on(table.status),
    index("bookings_start_time_idx").on(table.startTime),
    index("bookings_buffer_time_idx").on(table.hostId, table.bufferStartTime, table.bufferEndTime),
    uniqueIndex("bookings_cancel_token_idx").on(table.cancelToken),
    uniqueIndex("bookings_idempotency_key_idx").on(table.idempotencyKey),
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
}));

export const eventTypesRelations = relations(eventTypes, ({ one, many }) => ({
  user: one(users, {
    fields: [eventTypes.userId],
    references: [users.id],
  }),
  bookings: many(bookings),
}));

export const bookingsRelations = relations(bookings, ({ one }) => ({
  eventType: one(eventTypes, {
    fields: [bookings.eventTypeId],
    references: [eventTypes.id],
  }),
  host: one(users, {
    fields: [bookings.hostId],
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

export type Contact = typeof contacts.$inferSelect;
export type NewContact = typeof contacts.$inferInsert;

export type VerificationToken = typeof verificationTokens.$inferSelect;
export type NewVerificationToken = typeof verificationTokens.$inferInsert;
