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
  getGoogleCalendarEvent,
  patchGoogleCalendarEventTime,
  generateGcalEventId,
  generateGcalConferenceRequestId,
  isGoogleEventMatchingBooking,
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
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { isValid: false, error: "Invalid booking request payload." };
  }
  const req = input as Record<string, unknown>;

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

  // idempotencyKey validation
  if (req.idempotencyKey !== undefined && req.idempotencyKey !== null) {
    if (typeof req.idempotencyKey !== "string") {
      return { isValid: false, error: "idempotencyKey must be a string." };
    }
    if (req.idempotencyKey.trim().length > 255) {
      return { isValid: false, error: "idempotencyKey must not exceed 255 characters." };
    }
  }

  // guestTimezone validation
  if (req.guestTimezone !== undefined && req.guestTimezone !== null) {
    if (typeof req.guestTimezone !== "string" || !req.guestTimezone.trim()) {
      return { isValid: false, error: "guestTimezone must be a non-empty string." };
    }
    try {
      Intl.DateTimeFormat(undefined, { timeZone: req.guestTimezone.trim() });
    } catch {
      return { isValid: false, error: `Invalid guestTimezone: '${req.guestTimezone}'. Must be a valid IANA timezone identifier.` };
    }
  }

  // guestNotes validation
  if (req.guestNotes !== undefined && req.guestNotes !== null) {
    if (typeof req.guestNotes !== "string") {
      return { isValid: false, error: "guestNotes must be a string." };
    }
    if (req.guestNotes.trim().length > 1000) {
      return { isValid: false, error: "guestNotes must not exceed 1000 characters." };
    }
  }

  // additionalGuests validation
  if (req.additionalGuests !== undefined && req.additionalGuests !== null) {
    let guests: string[];
    if (Array.isArray(req.additionalGuests)) {
      for (const item of req.additionalGuests) {
        if (typeof item !== "string") {
          return { isValid: false, error: "additionalGuests array items must be strings." };
        }
      }
      guests = req.additionalGuests.map((g) => g.trim()).filter(Boolean);
    } else if (typeof req.additionalGuests === "string") {
      guests = req.additionalGuests.split(",").map((g) => g.trim()).filter(Boolean);
    } else {
      return { isValid: false, error: "additionalGuests must be an array of strings or a comma-separated string." };
    }

    if (guests.length > 20) {
      return { isValid: false, error: "additionalGuests cannot exceed 20 email addresses." };
    }

    for (const g of guests) {
      if (!emailRegex.test(g) || g.length > 255) {
        return { isValid: false, error: `Invalid additional guest email address: ${g}` };
      }
    }
  }

  // customAnswers validation
  if (req.customAnswers !== undefined && req.customAnswers !== null) {
    if (typeof req.customAnswers !== "object" || Array.isArray(req.customAnswers)) {
      return { isValid: false, error: "customAnswers must be a JSON object mapping questions to answers." };
    }
  }

  return { isValid: true };
}

/**
 * Reconciles external calendar synchronization for a booking.
 * Idempotently verifies if an event already exists on Google Calendar, patches existing event times,
 * or inserts a new event using the deterministic stable event ID.
 */
export async function reconcileBookingCalendarSync(
  bookingId: string,
  hostId: string
): Promise<{ success: boolean; calendarSynced: boolean; meetLink?: string; eventId?: string; error?: string }> {
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

  if (!host.googleAccessToken && !host.googleRefreshToken) {
    await db
      .update(bookings)
      .set({
        calendarSyncStatus: "not_applicable",
        lastSyncError: null,
        updatedAt: new Date(),
      })
      .where(eq(bookings.id, booking.id));

    return { success: true, calendarSynced: false };
  }

  const location = resolveEffectiveLocation({
    eventType,
    host,
  });

  let meetLink =
    location.locationType === "zoom" || location.locationType === "custom"
      ? location.locationUrl
      : booking.meetLink || undefined;

  const stableEventId = generateGcalEventId(booking.id);
  const targetEventId = booking.gcalEventId || stableEventId;
  const confRequestId = generateGcalConferenceRequestId(booking.id);

  const tokens = {
    accessToken: host.googleAccessToken,
    refreshToken: host.googleRefreshToken,
  };

  try {
    // 1. Check if the event already exists on Google Calendar (using targetEventId)
    const existingCheck = await getGoogleCalendarEvent(tokens, targetEventId);

    // 1A. Existing active event found
    if (existingCheck.success && existingCheck.event && existingCheck.event.status !== "cancelled") {
      const isMatch = isGoogleEventMatchingBooking(existingCheck.event, booking);
      if (!isMatch) {
        await db
          .update(bookings)
          .set({
            gcalEventId: targetEventId,
            calendarSyncStatus: "failed",
            lastSyncError: "Existing Google Calendar event does not belong to this booking.",
            updatedAt: new Date(),
          })
          .where(eq(bookings.id, booking.id));

        return {
          success: false,
          calendarSynced: false,
          eventId: targetEventId,
          error: "Existing Google Calendar event does not belong to this booking.",
        };
      }

      // Event exists and belongs to this booking! Patch times and details
      const patchRes = await patchGoogleCalendarEventTime({
        tokens,
        eventId: targetEventId,
        startTime: booking.startTime,
        endTime: booking.endTime,
        timeZone: host.timezone || "UTC",
        summary: `${eventType?.title || "Meeting"} with ${booking.guestName}`,
        description: `Scheduled via Morrow (Booking ID: ${booking.id})\n\nGuest: ${booking.guestName} (${booking.guestEmail})\nNotes: ${booking.guestNotes || "None"}`,
      });

      // Crucial: check patch outcome
      if (!patchRes.success) {
        // Failed patch: preserve existing event ID and meet link, record failed status
        await db
          .update(bookings)
          .set({
            gcalEventId: targetEventId,
            meetLink: booking.meetLink || null,
            calendarSyncStatus: "failed",
            lastSyncError: patchRes.error || "Failed to update Google Calendar event time",
            updatedAt: new Date(),
          })
          .where(eq(bookings.id, booking.id));

        return {
          success: false,
          calendarSynced: false,
          eventId: targetEventId,
          meetLink: booking.meetLink || undefined,
          error: patchRes.error || "Failed to update Google Calendar event time",
        };
      }

      const existingMeet =
        existingCheck.event.hangoutLink ||
        existingCheck.event.conferenceData?.entryPoints?.find(
          (ep: { entryPointType?: string | null; uri?: string | null }) => ep.entryPointType === "video"
        )?.uri ||
        patchRes.meetLink ||
        meetLink;

      if (location.locationType === "google_meet" && existingMeet) {
        meetLink = existingMeet;
      }

      await db
        .update(bookings)
        .set({
          gcalEventId: targetEventId,
          meetLink: meetLink || booking.meetLink || null,
          calendarSyncStatus: "synced",
          lastSyncError: null,
          updatedAt: new Date(),
        })
        .where(eq(bookings.id, booking.id));

      return {
        success: true,
        calendarSynced: true,
        eventId: targetEventId,
        meetLink,
      };
    }

    // 1B. Existing event is cancelled on Google Calendar
    if (existingCheck.success && existingCheck.event && existingCheck.event.status === "cancelled") {
      const isMatch = isGoogleEventMatchingBooking(existingCheck.event, booking);
      if (!isMatch) {
        await db
          .update(bookings)
          .set({
            gcalEventId: targetEventId,
            calendarSyncStatus: "failed",
            lastSyncError: "Existing Google Calendar event is cancelled and does not match booking.",
            updatedAt: new Date(),
          })
          .where(eq(bookings.id, booking.id));

        return {
          success: false,
          calendarSynced: false,
          eventId: targetEventId,
          error: "Existing Google Calendar event is cancelled and does not match booking.",
        };
      }

      // Attempt to restore the cancelled event
      const restoreRes = await patchGoogleCalendarEventTime({
        tokens,
        eventId: targetEventId,
        startTime: booking.startTime,
        endTime: booking.endTime,
        timeZone: host.timezone || "UTC",
        status: "confirmed",
        summary: `${eventType?.title || "Meeting"} with ${booking.guestName}`,
        description: `Scheduled via Morrow (Booking ID: ${booking.id})\n\nGuest: ${booking.guestName} (${booking.guestEmail})\nNotes: ${booking.guestNotes || "None"}`,
        bookingId: booking.id,
      });

      if (!restoreRes.success) {
        // Never accept a cancelled event as successfully synced if restore fails
        await db
          .update(bookings)
          .set({
            gcalEventId: targetEventId,
            meetLink: booking.meetLink || null,
            calendarSyncStatus: "failed",
            lastSyncError: restoreRes.error || "Existing Google Calendar event is cancelled and could not be restored.",
            updatedAt: new Date(),
          })
          .where(eq(bookings.id, booking.id));

        return {
          success: false,
          calendarSynced: false,
          eventId: targetEventId,
          error: restoreRes.error || "Existing Google Calendar event is cancelled and could not be restored.",
        };
      }

      // Confirm with Google Calendar that the restored event is actually active
      let isActuallyActive = Boolean(
        restoreRes.event && restoreRes.event.status && restoreRes.event.status !== "cancelled"
      );
      if (!isActuallyActive) {
        const recheck = await getGoogleCalendarEvent(tokens, targetEventId);
        isActuallyActive = Boolean(recheck.success && recheck.event && recheck.event.status !== "cancelled");
      }

      if (!isActuallyActive) {
        await db
          .update(bookings)
          .set({
            gcalEventId: targetEventId,
            meetLink: booking.meetLink || null,
            calendarSyncStatus: "failed",
            lastSyncError: "Google Calendar event restoration failed: event status remains cancelled.",
            updatedAt: new Date(),
          })
          .where(eq(bookings.id, booking.id));

        return {
          success: false,
          calendarSynced: false,
          eventId: targetEventId,
          error: "Google Calendar event restoration failed: event status remains cancelled.",
        };
      }

      const existingMeet =
        existingCheck.event.hangoutLink ||
        existingCheck.event.conferenceData?.entryPoints?.find(
          (ep: { entryPointType?: string | null; uri?: string | null }) => ep.entryPointType === "video"
        )?.uri ||
        restoreRes.meetLink ||
        meetLink;

      if (location.locationType === "google_meet" && existingMeet) {
        meetLink = existingMeet;
      }

      await db
        .update(bookings)
        .set({
          gcalEventId: targetEventId,
          meetLink: meetLink || booking.meetLink || null,
          calendarSyncStatus: "synced",
          lastSyncError: null,
          updatedAt: new Date(),
        })
        .where(eq(bookings.id, booking.id));

      return {
        success: true,
        calendarSynced: true,
        eventId: targetEventId,
        meetLink,
      };
    }

    // 2. If get returned an error that wasn't 404/not-found (e.g. rate limit, auth error)
    if (!existingCheck.success && !existingCheck.notFound) {
      await db
        .update(bookings)
        .set({
          gcalEventId: targetEventId,
          calendarSyncStatus: "failed",
          lastSyncError: existingCheck.error || "Failed to inspect existing Google Calendar event",
          updatedAt: new Date(),
        })
        .where(eq(bookings.id, booking.id));

      return {
        success: false,
        calendarSynced: false,
        eventId: targetEventId,
        error: existingCheck.error,
      };
    }

    // 3. Event does not exist on Google Calendar: insert using deterministic stableEventId
    const gcalResult = await createGoogleCalendarEvent({
      tokens,
      summary: `${eventType?.title || "Meeting"} with ${booking.guestName}`,
      description: `Scheduled via Morrow (Booking ID: ${booking.id})\n\nGuest: ${booking.guestName} (${booking.guestEmail})\nNotes: ${booking.guestNotes || "None"}`,
      startTime: booking.startTime,
      endTime: booking.endTime,
      guestEmail: booking.guestEmail,
      guestName: booking.guestName,
      bookingId: booking.id,
      timeZone: host.timezone || "UTC",
      locationType: location.locationType,
      locationUrl: location.locationUrl,
      eventId: stableEventId,
      confRequestId,
    });

    if (gcalResult.success && gcalResult.eventId) {
      if (location.locationType === "google_meet" && gcalResult.meetLink) {
        meetLink = gcalResult.meetLink;
      }

      await db
        .update(bookings)
        .set({
          gcalEventId: gcalResult.eventId,
          meetLink: meetLink || booking.meetLink || null,
          calendarSyncStatus: "synced",
          lastSyncError: null,
          updatedAt: new Date(),
        })
        .where(eq(bookings.id, booking.id));

      return {
        success: true,
        calendarSynced: true,
        eventId: gcalResult.eventId,
        meetLink,
      };
    }

    // 4. Duplicate recovery: If insertion returned 409 because event already exists
    if (gcalResult.isDuplicate) {
      const retryGet = await getGoogleCalendarEvent(tokens, stableEventId);
      if (retryGet.success && retryGet.event) {
        // Verify that the event is active AND matches this booking
        const isActive = retryGet.event.status !== "cancelled";
        const isMatch = isGoogleEventMatchingBooking(retryGet.event, booking);

        if (!isActive || !isMatch) {
          const errorDetail = !isActive
            ? "Google Calendar event already exists but is cancelled."
            : "Google Calendar event identifier collision: existing event does not match booking.";

          await db
            .update(bookings)
            .set({
              gcalEventId: stableEventId,
              calendarSyncStatus: "failed",
              lastSyncError: errorDetail,
              updatedAt: new Date(),
            })
            .where(eq(bookings.id, booking.id));

          return {
            success: false,
            calendarSynced: false,
            eventId: stableEventId,
            error: errorDetail,
          };
        }

        // Event is active and verified as belonging to this booking
        const recoveredMeet =
          retryGet.event.hangoutLink ||
          retryGet.event.conferenceData?.entryPoints?.find(
            (ep: { entryPointType?: string | null; uri?: string | null }) => ep.entryPointType === "video"
          )?.uri ||
          meetLink;

        await db
          .update(bookings)
          .set({
            gcalEventId: stableEventId,
            meetLink: recoveredMeet || booking.meetLink || null,
            calendarSyncStatus: "synced",
            lastSyncError: null,
            updatedAt: new Date(),
          })
          .where(eq(bookings.id, booking.id));

        return {
          success: true,
          calendarSynced: true,
          eventId: stableEventId,
          meetLink: recoveredMeet,
        };
      }
    }

    // 5. Otherwise record failure, preserving booking and any previously assigned event ID
    await db
      .update(bookings)
      .set({
        gcalEventId: booking.gcalEventId || undefined,
        calendarSyncStatus: "failed",
        lastSyncError: gcalResult.error || "Google Calendar event creation failed",
        updatedAt: new Date(),
      })
      .where(eq(bookings.id, booking.id));

    return {
      success: false,
      calendarSynced: false,
      eventId: booking.gcalEventId || undefined,
      error: gcalResult.error,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    await db
      .update(bookings)
      .set({
        calendarSyncStatus: "failed",
        lastSyncError: errorMsg,
        updatedAt: new Date(),
      })
      .where(eq(bookings.id, booking.id));

    return {
      success: false,
      calendarSynced: false,
      error: errorMsg,
    };
  }
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

      // Recoverable sync check on retry: if booking was confirmed and sync failed OR was interrupted in pending state
      const isInterruptedPending =
        existing.status === "confirmed" &&
        existing.calendarSyncStatus === "pending" &&
        !existing.gcalEventId &&
        Date.now() - new Date(existing.createdAt).getTime() > 3000;

      const needsSyncRecovery =
        existing.status === "confirmed" &&
        (existing.calendarSyncStatus === "failed" || isInterruptedPending);

      if (needsSyncRecovery) {
        await reconcileBookingCalendarSync(existing.id, host.id);
      }

      // Reload fresh booking record from database so response reflects persisted state
      const freshBooking = await db.query.bookings.findFirst({
        where: eq(bookings.id, existing.id),
        with: {
          eventType: true,
        },
      });
      const current = freshBooking || existing;

      const currentStatus = current.status as BookingStatus;
      const isSynced = current.calendarSyncStatus === "synced" || Boolean(current.gcalEventId);
      const syncStatus = (current.calendarSyncStatus as CalendarSyncStatus) || (isSynced ? "synced" : "not_applicable");

      const resolvedLoc = resolveEffectiveLocation({
        eventType: current.eventType,
        host,
      });

      return {
        success: true,
        status: 200,
        booking: {
          id: current.id,
          guestName: current.guestName,
          guestEmail: current.guestEmail,
          startTime: current.startTime.toISOString(),
          endTime: current.endTime.toISOString(),
          meetLink: current.meetLink || undefined,
          cancelToken: current.cancelToken,
          eventType: current.eventType?.title || eventType.title,
          status: currentStatus,
          requiresApproval: currentStatus === "pending",
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
    const stableEventId = generateGcalEventId(newBooking.id);
    const confRequestId = generateGcalConferenceRequestId(newBooking.id);
    try {
      const gcalResult = await createGoogleCalendarEvent({
        tokens: {
          accessToken: host.googleAccessToken,
          refreshToken: host.googleRefreshToken,
        },
        summary: `${eventType.title} with ${input.guestName.trim()}`,
        description: `Scheduled via Morrow (Booking ID: ${newBooking.id})\n\nGuest: ${input.guestName.trim()} (${normalizedGuestEmail})\nNotes: ${input.guestNotes || "None"}`,
        startTime: proposedStartTime,
        endTime: proposedEndTime,
        guestEmail: normalizedGuestEmail,
        guestName: input.guestName.trim(),
        bookingId: newBooking.id,
        timeZone: host.timezone || "UTC",
        locationType: location.locationType,
        locationUrl: location.locationUrl,
        eventId: stableEventId,
        confRequestId,
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
