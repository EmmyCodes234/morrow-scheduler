import crypto from "crypto";
import { db } from "@/db";
import { users, eventTypes, bookings, contacts, availability, availabilityOverrides } from "@/db/schema";
import { eq, and, ne, gte, lte } from "drizzle-orm";
import { BookingRequestInput, BookingStatus, CalendarSyncStatus } from "./types";
import { validateBookingRequest } from "./validation";
import {
  localWallClockToUtcDate,
  resolveTimezone,
  getDateStringInTimezone,
} from "./timezone";
import {
  fetchGoogleBusyBlocks,
  createGoogleCalendarEvent,
} from "@/lib/google-calendar";
import { sendBookingConfirmationEmail } from "@/lib/email";
import { resolveEffectiveLocation } from "./location";

export interface BookingResponse {
  success: boolean;
  status: number;
  error?: string;
  errorCode?: string;
  booking?: {
    id: string;
    guestName: string;
    guestEmail: string;
    startTime: string;
    endTime: string;
    meetLink?: string;
    cancelToken: string;
    eventType: string;
    status: BookingStatus;
    requiresApproval?: boolean;
    calendarSynced?: boolean;
    calendarSyncStatus?: CalendarSyncStatus;
    locationType?: string;
    locationUrl?: string;
  };
}

/**
 * Deterministic JSON stringifier that sorts object keys recursively.
 */
export function canonicalizeJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalizeJson).join(",") + "]";
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return (
    "{" +
    keys
      .map((k) => JSON.stringify(k) + ":" + canonicalizeJson((value as Record<string, unknown>)[k]))
      .join(",") +
    "}"
  );
}

/**
 * Computes a deterministic SHA-256 hash over all material guest-supplied booking inputs.
 */
export function computeBookingFingerprint(input: {
  eventTypeId: string;
  guestName: string;
  guestEmail: string;
  startInstant: string;
  guestTimezone: string;
  guestNotes?: string | null;
  additionalGuests?: string | string[] | null;
  customAnswers?: Record<string, unknown> | null;
}): string {
  const normalizedGuests = Array.isArray(input.additionalGuests)
    ? input.additionalGuests.map((g) => g.trim().toLowerCase()).sort()
    : input.additionalGuests
    ? input.additionalGuests
        .split(",")
        .map((g) => g.trim().toLowerCase())
        .filter(Boolean)
        .sort()
    : [];

  const canonicalObj = {
    additionalGuests: normalizedGuests,
    customAnswers: input.customAnswers || {},
    eventTypeId: input.eventTypeId,
    guestEmail: input.guestEmail.trim().toLowerCase(),
    guestName: input.guestName.trim(),
    guestNotes: input.guestNotes?.trim() || "",
    guestTimezone: input.guestTimezone,
    startInstant: input.startInstant,
  };

  return crypto.createHash("sha256").update(canonicalizeJson(canonicalObj)).digest("hex");
}

/**
 * Validates syntax, types, and required fields before any business logic or string operations run.
 */
export function validateBookingInputSyntax(input: unknown): { isValid: boolean; error?: string } {
  if (!input || typeof input !== "object") {
    return { isValid: false, error: "Invalid booking request payload." };
  }
  const req = input as Partial<BookingRequestInput>;

  if (typeof req.eventTypeId !== "string" || !req.eventTypeId.trim()) {
    return { isValid: false, error: "eventTypeId is required and must be a non-empty string." };
  }

  if (typeof req.guestName !== "string" || !req.guestName.trim()) {
    return { isValid: false, error: "guestName is required." };
  }
  if (req.guestName.trim().length > 100) {
    return { isValid: false, error: "guestName must not exceed 100 characters." };
  }

  if (typeof req.guestEmail !== "string" || !req.guestEmail.trim()) {
    return { isValid: false, error: "guestEmail is required." };
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(req.guestEmail.trim()) || req.guestEmail.trim().length > 255) {
    return { isValid: false, error: "A valid guest email address is required." };
  }

  if (typeof req.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(req.date.trim())) {
    return { isValid: false, error: "date is required and must be in YYYY-MM-DD format." };
  }

  if (typeof req.time !== "string" || !req.time.trim()) {
    return { isValid: false, error: "time is required." };
  }

  if (req.guestNotes !== undefined && req.guestNotes !== null) {
    if (typeof req.guestNotes !== "string" || req.guestNotes.trim().length > 1000) {
      return { isValid: false, error: "guestNotes must not exceed 1000 characters." };
    }
  }

  if (req.additionalGuests !== undefined && req.additionalGuests !== null) {
    const guests = Array.isArray(req.additionalGuests)
      ? req.additionalGuests
      : req.additionalGuests.split(",").map((g) => g.trim()).filter(Boolean);
    for (const g of guests) {
      if (!emailRegex.test(g)) {
        return { isValid: false, error: `Invalid additional guest email address: ${g}` };
      }
    }
  }

  return { isValid: true };
}

/**
 * Reconciles external calendar synchronization for a booking.
 */
export async function reconcileBookingCalendarSync(
  bookingId: string,
  hostId: string
): Promise<{ success: boolean; calendarSynced: boolean; meetLink?: string; error?: string }> {
  const booking = await db.query.bookings.findFirst({
    where: and(eq(bookings.id, bookingId), eq(bookings.hostId, hostId)),
    with: {
      eventType: true,
      host: true,
    },
  });

  if (!booking) {
    return { success: false, calendarSynced: false, error: "Booking not found" };
  }

  if (booking.status !== "confirmed") {
    return {
      success: false,
      calendarSynced: false,
      error: `Cannot sync calendar for booking in '${booking.status}' status (must be confirmed).`,
    };
  }

  const host = booking.host;
  const eventType = booking.eventType;

  const location = resolveEffectiveLocation({
    eventType,
    host,
  });

  let meetLink =
    location.locationType === "zoom" || location.locationType === "custom"
      ? location.locationUrl
      : undefined;
  let gcalEventId = booking.gcalEventId || undefined;
  let calendarSynced = false;
  let syncStatus: CalendarSyncStatus = "not_applicable";
  let lastSyncError: string | null = null;

  if (host.googleAccessToken || host.googleRefreshToken) {
    try {
      const gcalResult = await createGoogleCalendarEvent({
        tokens: {
          accessToken: host.googleAccessToken,
          refreshToken: host.googleRefreshToken,
        },
        summary: `${eventType?.title || "Meeting"} with ${booking.guestName}`,
        description: `Scheduled via Morrow\n\nGuest: ${booking.guestName} (${booking.guestEmail})\nNotes: ${booking.guestNotes || "None"}`,
        startTime: booking.startTime,
        endTime: booking.endTime,
        guestEmail: booking.guestEmail,
        guestName: booking.guestName,
        timeZone: host.timezone || "UTC",
        locationType: location.locationType,
        locationUrl: location.locationUrl,
        requestId: `morrow-booking-${booking.id}`,
      });

      if (gcalResult.success && gcalResult.eventId) {
        gcalEventId = gcalResult.eventId;
        calendarSynced = true;
        syncStatus = "synced";
        lastSyncError = null;
        if (location.locationType === "google_meet" && gcalResult.meetLink) {
          meetLink = gcalResult.meetLink;
        }
      } else {
        syncStatus = "failed";
        calendarSynced = false;
        lastSyncError = gcalResult.error || "Google Calendar event creation failed";
      }
    } catch (err) {
      syncStatus = "failed";
      calendarSynced = false;
      lastSyncError = err instanceof Error ? err.message : String(err);
    }
  } else {
    syncStatus = "not_applicable";
    calendarSynced = false;
  }

  await db
    .update(bookings)
    .set({
      meetLink: meetLink || booking.meetLink || null,
      gcalEventId: gcalEventId || booking.gcalEventId || null,
      calendarSyncStatus: syncStatus,
      lastSyncError,
      updatedAt: new Date(),
    })
    .where(eq(bookings.id, booking.id));

  return {
    success: calendarSynced || syncStatus === "not_applicable",
    calendarSynced,
    meetLink,
    error: lastSyncError || undefined,
  };
}

export async function processBooking(
  slug: string,
  input: BookingRequestInput
): Promise<BookingResponse> {
  // 1. Validate input syntax and required fields BEFORE accessing properties or methods
  const syntaxCheck = validateBookingInputSyntax(input);
  if (!syntaxCheck.isValid) {
    return {
      success: false,
      status: 400,
      error: syntaxCheck.error || "Invalid booking request.",
      errorCode: "INVALID_INPUT",
    };
  }

  // 2. Resolve host by public slug
  const host = await db.query.users.findFirst({
    where: eq(users.slug, slug),
  });

  if (!host) {
    return {
      success: false,
      status: 404,
      error: "Host not found.",
      errorCode: "NOT_FOUND",
    };
  }

  // 3. Resolve requested event type
  const eventType = await db.query.eventTypes.findFirst({
    where: and(
      eq(eventTypes.id, input.eventTypeId),
      eq(eventTypes.userId, host.id)
    ),
  });

  if (!eventType) {
    return {
      success: false,
      status: 404,
      error: "Requested event type does not exist or does not belong to this host.",
      errorCode: "NOT_FOUND",
    };
  }

  if (!eventType.isActive) {
    return {
      success: false,
      status: 400,
      error: "This event type is currently inactive and cannot be booked.",
      errorCode: "INACTIVE",
    };
  }

  // 4. Derive timestamps & boundaries authoritatively
  const guestTimezone = resolveTimezone(input.guestTimezone, host.timezone || "UTC");
  const hostTimezone = resolveTimezone(host.timezone, "UTC");

  let proposedStartTime: Date;
  try {
    proposedStartTime = localWallClockToUtcDate(input.date, input.time, guestTimezone);
  } catch (err: unknown) {
    return {
      success: false,
      status: 400,
      error: (err as Error).message || "Invalid date or time format.",
      errorCode: "INVALID_INPUT",
    };
  }

  const durationMins = eventType.durationMins;
  const proposedEndTime = new Date(proposedStartTime.getTime() + durationMins * 60 * 1000);
  const bufferBeforeMins = eventType.bufferBeforeMins || 0;
  const bufferAfterMins =
    eventType.bufferAfterMins > 0
      ? eventType.bufferAfterMins
      : (host.bufferMins ?? 0);

  const proposedBufferStartTime = new Date(
    proposedStartTime.getTime() - bufferBeforeMins * 60 * 1000
  );
  const proposedBufferEndTime = new Date(
    proposedEndTime.getTime() + bufferAfterMins * 60 * 1000
  );

  // 5. Complete idempotency fingerprinting across all material guest-supplied details
  const normalizedGuestEmail = input.guestEmail.trim().toLowerCase();
  const requestHash = computeBookingFingerprint({
    eventTypeId: eventType.id,
    guestName: input.guestName,
    guestEmail: normalizedGuestEmail,
    startInstant: proposedStartTime.toISOString(),
    guestTimezone,
    guestNotes: input.guestNotes,
    additionalGuests: input.additionalGuests,
    customAnswers: input.customAnswers,
  });

  const idempotencyKey = input.idempotencyKey?.trim() || null;
  if (idempotencyKey) {
    const existing = await db.query.bookings.findFirst({
      where: and(
        eq(bookings.hostId, host.id),
        eq(bookings.idempotencyKey, idempotencyKey)
      ),
      with: {
        eventType: true,
      },
    });

    if (existing && existing.status !== "cancelled" && existing.status !== "rejected") {
      // Check if the payload matches the original request
      const isMatchingPayload =
        existing.requestHash === requestHash &&
        existing.guestEmail.toLowerCase() === normalizedGuestEmail;

      if (!isMatchingPayload) {
        return {
          success: false,
          status: 409,
          error: "Idempotency key has already been used for a different booking request with this host.",
          errorCode: "CONFLICT",
        };
      }

      // Recoverable sync check on retry: if booking was confirmed but sync failed, attempt reconciliation
      if (existing.status === "confirmed" && existing.calendarSyncStatus === "failed") {
        await reconcileBookingCalendarSync(existing.id, host.id);
      }

      const existingStatus = existing.status as BookingStatus;
      const isSynced = existing.calendarSyncStatus === "synced" || Boolean(existing.gcalEventId);
      const syncStatus = (existing.calendarSyncStatus as CalendarSyncStatus) || (isSynced ? "synced" : "not_applicable");

      const resolvedLoc = resolveEffectiveLocation({
        eventType: existing.eventType,
        host,
      });

      return {
        success: true,
        status: 200,
        booking: {
          id: existing.id,
          guestName: existing.guestName,
          guestEmail: existing.guestEmail,
          startTime: existing.startTime.toISOString(),
          endTime: existing.endTime.toISOString(),
          meetLink: existing.meetLink || undefined,
          cancelToken: existing.cancelToken,
          eventType: existing.eventType?.title || eventType.title,
          status: existingStatus,
          requiresApproval: existingStatus === "pending",
          calendarSynced: isSynced,
          calendarSyncStatus: syncStatus,
          locationType: resolvedLoc.locationType,
          locationUrl: resolvedLoc.locationUrl,
        },
      };
    }
  }

  // 6. Bounded database queries
  const queryWindowStart = new Date(proposedBufferStartTime.getTime() - 24 * 60 * 60 * 1000);
  const queryWindowEnd = new Date(proposedBufferEndTime.getTime() + 24 * 60 * 60 * 1000);

  const [hostWeekly, hostOverrides, boundedBookings] = await Promise.all([
    db.query.availability.findMany({
      where: eq(availability.userId, host.id),
    }),
    db.query.availabilityOverrides.findMany({
      where: and(
        eq(availabilityOverrides.userId, host.id),
        eq(
          availabilityOverrides.date,
          getDateStringInTimezone(proposedStartTime, hostTimezone)
        )
      ),
    }),
    db.query.bookings.findMany({
      where: and(
        eq(bookings.hostId, host.id),
        ne(bookings.status, "cancelled"),
        gte(bookings.bufferEndTime, queryWindowStart),
        lte(bookings.bufferStartTime, queryWindowEnd)
      ),
    }),
  ]);

  // 7. External Google Calendar Free/Busy verification
  let calendarBusyBlocks: Array<{ start: Date; end: Date }> = [];
  let calendarCheckFailed = false;

  if (host.googleAccessToken || host.googleRefreshToken) {
    const freeBusyRes = await fetchGoogleBusyBlocks(
      { accessToken: host.googleAccessToken, refreshToken: host.googleRefreshToken },
      proposedBufferStartTime,
      proposedBufferEndTime
    );

    if (!freeBusyRes.success) {
      calendarCheckFailed = true;
    } else {
      calendarBusyBlocks = freeBusyRes.busy.map((b) => ({
        start: new Date(b.start),
        end: new Date(b.end),
      }));
    }
  }

  // 8. Validate all business rules
  const validation = validateBookingRequest({
    input,
    host: {
      id: host.id,
      name: host.name,
      email: host.email,
      slug: host.slug,
      timezone: host.timezone,
      bufferMins: host.bufferMins,
      minNoticeHours: host.minNoticeHours,
      maxBookingDays: host.maxBookingDays,
      defaultLocationType: host.defaultLocationType,
      zoomMeetingUrl: host.zoomMeetingUrl,
      googleAccessToken: host.googleAccessToken,
      googleRefreshToken: host.googleRefreshToken,
    },
    eventType: {
      id: eventType.id,
      userId: eventType.userId,
      title: eventType.title,
      slug: eventType.slug,
      durationMins: eventType.durationMins,
      description: eventType.description,
      locationType: eventType.locationType || host.defaultLocationType || "google_meet",
      locationUrl: eventType.locationUrl,
      isActive: eventType.isActive,
      bufferBeforeMins: eventType.bufferBeforeMins,
      bufferAfterMins: eventType.bufferAfterMins,
      minNoticeHours: eventType.minNoticeHours,
      maxPerDay: eventType.maxPerDay,
      requiresApproval: eventType.requiresApproval,
    },
    weeklyAvailability: hostWeekly.map((w) => ({
      dayOfWeek: w.dayOfWeek,
      startTime: w.startTime,
      endTime: w.endTime,
      isEnabled: w.isEnabled,
    })),
    overrides: hostOverrides.map((o) => ({
      date: o.date,
      isBlocked: o.isBlocked,
      startTime: o.startTime,
      endTime: o.endTime,
      reason: o.reason,
    })),
    existingBookings: boundedBookings.map((b) => ({
      id: b.id,
      eventTypeId: b.eventTypeId,
      startTime: b.startTime,
      endTime: b.endTime,
      bufferStartTime: b.bufferStartTime,
      bufferEndTime: b.bufferEndTime,
      status: b.status,
    })),
    calendarBusyBlocks,
    calendarCheckFailed,
  });

  if (!validation.isValid) {
    const status =
      validation.errorCode === "CONFLICT"
        ? 409
        : validation.errorCode === "NOT_FOUND"
        ? 404
        : validation.errorCode === "CALENDAR_ERROR"
        ? 503
        : 400;

    return {
      success: false,
      status,
      error: validation.error,
      errorCode: validation.errorCode,
    };
  }

  // 9. Location resolution following strict precedence:
  // 1. Explicit event configuration
  // 2. Host default
  // 3. Google Meet
  const location = resolveEffectiveLocation({
    eventType,
    host,
  });

  const requiresApproval = Boolean(eventType.requiresApproval);
  const initialStatus: BookingStatus = requiresApproval ? "pending" : "confirmed";

  // 10. Atomic Database Reservation
  const cancelToken = crypto.randomBytes(24).toString("hex");
  const additionalGuestsStr = input.additionalGuests
    ? Array.isArray(input.additionalGuests)
      ? input.additionalGuests.join(", ")
      : input.additionalGuests
    : null;

  let initialCalendarSyncStatus: CalendarSyncStatus = "not_applicable";
  if (requiresApproval) {
    initialCalendarSyncStatus = "pending";
  } else if (host.googleAccessToken || host.googleRefreshToken) {
    initialCalendarSyncStatus = "pending";
  }

  let newBooking;
  try {
    const [inserted] = await db
      .insert(bookings)
      .values({
        eventTypeId: eventType.id,
        hostId: host.id,
        guestName: input.guestName.trim(),
        guestEmail: normalizedGuestEmail,
        startTime: proposedStartTime,
        endTime: proposedEndTime,
        bufferStartTime: proposedBufferStartTime,
        bufferEndTime: proposedBufferEndTime,
        guestTimezone,
        guestNotes: input.guestNotes?.trim() || null,
        additionalGuests: additionalGuestsStr,
        idempotencyKey,
        requestHash,
        customAnswers: input.customAnswers || {},
        status: initialStatus,
        calendarSyncStatus: initialCalendarSyncStatus,
        cancelToken,
      })
      .returning();

    newBooking = inserted;
  } catch (dbErr: unknown) {
    const errString = String(dbErr);
    if (
      errString.includes("23P01") ||
      errString.includes("exclusion_violation") ||
      errString.includes("bookings_host_no_overlap") ||
      errString.includes("duplicate key")
    ) {
      return {
        success: false,
        status: 409,
        error: "This time slot is no longer available. Please select another time.",
        errorCode: "CONFLICT",
      };
    }

    console.error("Database error creating booking:", dbErr);
    return {
      success: false,
      status: 500,
      error: "Failed to create booking in database.",
      errorCode: "DATABASE_ERROR",
    };
  }

  // 11. Calendar Synchronization Lifecycle
  let meetLink: string | undefined =
    location.locationType === "zoom" || location.locationType === "custom"
      ? location.locationUrl
      : undefined;
  let gcalEventId: string | undefined = undefined;
  let calendarSynced = false;
  let finalCalendarSyncStatus: CalendarSyncStatus = initialCalendarSyncStatus;
  let lastSyncError: string | null = null;

  if (requiresApproval) {
    finalCalendarSyncStatus = "pending";
    calendarSynced = false;
  } else if (host.googleAccessToken || host.googleRefreshToken) {
    try {
      const gcalResult = await createGoogleCalendarEvent({
        tokens: {
          accessToken: host.googleAccessToken,
          refreshToken: host.googleRefreshToken,
        },
        summary: `${eventType.title} with ${input.guestName.trim()}`,
        description: `Scheduled via Morrow\n\nGuest: ${input.guestName.trim()} (${normalizedGuestEmail})\nNotes: ${input.guestNotes || "None"}`,
        startTime: proposedStartTime,
        endTime: proposedEndTime,
        guestEmail: normalizedGuestEmail,
        guestName: input.guestName.trim(),
        timeZone: host.timezone || "UTC",
        locationType: location.locationType,
        locationUrl: location.locationUrl,
        requestId: `morrow-booking-${newBooking.id}`,
      });

      if (gcalResult.success && gcalResult.eventId) {
        gcalEventId = gcalResult.eventId;
        calendarSynced = true;
        finalCalendarSyncStatus = "synced";
        if (location.locationType === "google_meet" && gcalResult.meetLink) {
          meetLink = gcalResult.meetLink;
        }
      } else {
        finalCalendarSyncStatus = "failed";
        calendarSynced = false;
        lastSyncError = gcalResult.error || "Google Calendar event creation failed";
        console.warn("[Calendar Sync] Failed to sync booking with Google Calendar:", gcalResult.error);
      }
    } catch (gcalErr) {
      finalCalendarSyncStatus = "failed";
      calendarSynced = false;
      lastSyncError = gcalErr instanceof Error ? gcalErr.message : String(gcalErr);
      console.error("[Calendar Sync] Unexpected error creating Google Calendar event:", gcalErr);
    }

    // Persist final calendar sync status, links, and errors
    await db
      .update(bookings)
      .set({
        meetLink: meetLink || null,
        gcalEventId: gcalEventId || null,
        calendarSyncStatus: finalCalendarSyncStatus,
        lastSyncError,
      })
      .where(eq(bookings.id, newBooking.id));
  } else {
    finalCalendarSyncStatus = "not_applicable";
    calendarSynced = false;
    if (meetLink) {
      await db
        .update(bookings)
        .set({
          meetLink,
          calendarSyncStatus: finalCalendarSyncStatus,
        })
        .where(eq(bookings.id, newBooking.id));
    }
  }

  // 12. Upsert Contact
  try {
    const existingContact = await db.query.contacts.findFirst({
      where: and(
        eq(contacts.userId, host.id),
        eq(contacts.email, normalizedGuestEmail)
      ),
    });

    if (existingContact) {
      await db
        .update(contacts)
        .set({
          totalBookings: existingContact.totalBookings + 1,
          lastBookingAt: new Date(),
          name: input.guestName.trim() || existingContact.name,
          updatedAt: new Date(),
        })
        .where(eq(contacts.id, existingContact.id));
    } else {
      await db.insert(contacts).values({
        userId: host.id,
        email: normalizedGuestEmail,
        name: input.guestName.trim(),
        totalBookings: 1,
        lastBookingAt: new Date(),
      });
    }
  } catch (contactErr) {
    console.error("Error upserting contact:", contactErr);
  }

  // 13. Dispatch confirmation / notification email (non-blocking)
  sendBookingConfirmationEmail({
    toEmail: normalizedGuestEmail,
    guestName: input.guestName.trim(),
    hostName: host.name,
    hostEmail: host.email,
    eventTitle: eventType.title,
    dateStr: input.date,
    timeStr: input.time,
    durationMins,
    status: initialStatus,
    calendarSynced,
    locationType: location.locationType,
    locationUrl: location.locationUrl,
    meetLink,
    guestNotes: input.guestNotes,
    cancelUrl: `${process.env.NEXT_PUBLIC_APP_URL || "https://usemorrow.xyz"}/cancel/${cancelToken}`,
  }).catch((err) => console.error("Error sending guest confirmation email:", err));

  return {
    success: true,
    status: 201,
    booking: {
      id: newBooking.id,
      guestName: newBooking.guestName,
      guestEmail: newBooking.guestEmail,
      startTime: proposedStartTime.toISOString(),
      endTime: proposedEndTime.toISOString(),
      meetLink,
      cancelToken,
      eventType: eventType.title,
      status: initialStatus,
      requiresApproval,
      calendarSynced,
      calendarSyncStatus: finalCalendarSyncStatus,
      locationType: location.locationType,
      locationUrl: location.locationUrl,
    },
  };
}
