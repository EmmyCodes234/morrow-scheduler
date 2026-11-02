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

export async function processBooking(
  slug: string,
  input: BookingRequestInput
): Promise<BookingResponse> {
  // 1. Resolve host by public slug
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

  // 2. Resolve requested event type
  if (!input.eventTypeId) {
    return {
      success: false,
      status: 400,
      error: "eventTypeId is required. Event types cannot be automatically created or inferred.",
      errorCode: "INVALID_INPUT",
    };
  }

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

  // 3. Derive timestamps & boundaries authoritatively
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

  // 4. Stable payload fingerprinting and host-scoped idempotency lookup
  const normalizedGuestEmail = input.guestEmail.trim().toLowerCase();
  const payloadFingerprint = `${eventType.id}:${normalizedGuestEmail}:${proposedStartTime.toISOString()}:${proposedEndTime.toISOString()}`;
  const requestHash = crypto.createHash("sha256").update(payloadFingerprint).digest("hex");

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

      // Return the original booking idempotently
      const existingStatus = existing.status as BookingStatus;
      const isSynced = existing.calendarSyncStatus === "synced" || Boolean(existing.gcalEventId);
      const syncStatus = (existing.calendarSyncStatus as CalendarSyncStatus) || (isSynced ? "synced" : "not_applicable");

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
          locationType: existing.eventType?.locationType || host.defaultLocationType || "google_meet",
          locationUrl: existing.eventType?.locationUrl || undefined,
        },
      };
    }
  }

  // 5. Bounded database queries
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

  // 6. External Google Calendar Free/Busy verification
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

  // 7. Validate all business rules
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
      locationType: eventType.locationType,
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

  // 8. Determine initial status and location configuration
  const requiresApproval = Boolean(eventType.requiresApproval);
  const initialStatus: BookingStatus = requiresApproval ? "pending" : "confirmed";

  // Location resolution hierarchy: eventType -> host default -> google_meet
  const locationType = eventType.locationType || host.defaultLocationType || "google_meet";
  const locationUrl =
    eventType.locationUrl ||
    (locationType === "zoom" ? host.zoomMeetingUrl : undefined) ||
    undefined;

  // 9. Atomic Database Reservation
  // Pending bookings reserve their slot in the DB exclusion constraint to prevent double bookings
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
    // Check for PostgreSQL exclusion violation (code 23P01) or unique conflict
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

  // 10. Calendar Synchronization Lifecycle
  let meetLink: string | undefined = locationType === "zoom" || locationType === "custom" ? locationUrl : undefined;
  let gcalEventId: string | undefined = undefined;
  let calendarSynced = false;
  let finalCalendarSyncStatus: CalendarSyncStatus = initialCalendarSyncStatus;

  // For pending bookings: do not create external calendar event yet (will sync upon host approval)
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
        locationType,
        locationUrl,
        requestId: `morrow-booking-${newBooking.id}`,
      });

      if (gcalResult.success && gcalResult.eventId) {
        gcalEventId = gcalResult.eventId;
        calendarSynced = true;
        finalCalendarSyncStatus = "synced";
        if (locationType === "google_meet" && gcalResult.meetLink) {
          meetLink = gcalResult.meetLink;
        }
      } else {
        finalCalendarSyncStatus = "failed";
        calendarSynced = false;
        console.warn("[Calendar Sync] Failed to sync booking with Google Calendar:", gcalResult.error);
      }
    } catch (gcalErr) {
      finalCalendarSyncStatus = "failed";
      calendarSynced = false;
      console.error("[Calendar Sync] Unexpected error creating Google Calendar event:", gcalErr);
    }

    // Persist final calendar sync status and links
    await db
      .update(bookings)
      .set({
        meetLink: meetLink || null,
        gcalEventId: gcalEventId || null,
        calendarSyncStatus: finalCalendarSyncStatus,
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

  // 11. Upsert Contact
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

  // 12. Dispatch confirmation / notification email (non-blocking)
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
    locationType,
    locationUrl,
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
      locationType,
      locationUrl,
    },
  };
}
