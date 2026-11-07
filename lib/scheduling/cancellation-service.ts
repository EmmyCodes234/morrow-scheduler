import { db } from "@/db";
import { bookings, eventTypes, users, bookingAttendees } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import {
  cancelGoogleCalendarEventWithDetails,
  type CancelGoogleEventResult,
} from "@/lib/google-calendar";
import {
  dispatchDurableBookingNotification,
  type DurableNotificationPayload,
  type DispatchNotificationResult,
} from "@/lib/scheduling/notification-service";
import {
  formatTime12,
  getDateStringInTimezone,
  resolveTimezone,
} from "@/lib/scheduling/timezone";

import { realtimeBus } from "@/lib/realtime/event-bus";

export interface CancelBookingParams {
  /** The booking ID (for host) or cancelToken (for guest) */
  identifier: string;
  identifierType: "id" | "token";
  cancelledBy: "guest" | "host";
  reason?: string;
  /** Required when cancelledBy === "host" to verify authorization */
  hostId?: string;
}

export type CancelBookingErrorCode =
  | "NOT_FOUND"
  | "UNAUTHORIZED"
  | "ALREADY_CANCELLED"
  | "PAST_BOOKING"
  | "INELIGIBLE_STATUS"
  | "INVALID_REASON"
  | "CONFLICT"
  | "INTERNAL_ERROR";

export type SafeCalendarSyncStatus = "cleaned" | "not_applicable" | "failed" | "pending";
export type SafeNotificationStatus = "sent" | "already_sent" | "pending" | "failed";

/**
 * Strict public response DTO for guest-facing cancellation endpoints.
 * Never exposes raw database records, host OAuth tokens, internal claim tokens,
 * private host emails, internal IDs, or external calendar event IDs.
 */
export interface PublicCancelledBookingDTO {
  eventTitle: string;
  hostName: string;
  hostSlug: string;
  dateStr: string;
  timeStr: string;
  timezone: string;
  status: "cancelled";
  cancellationReason: string | null;
  cancelledAt: string | null;
  outcome: "cancelled" | "already_cancelled";
  calendarSync: {
    status: SafeCalendarSyncStatus;
  };
  notification: {
    status: SafeNotificationStatus;
  };
}

export interface CancelBookingResult {
  success: boolean;
  booking?: typeof bookings.$inferSelect & {
    eventType?: typeof eventTypes.$inferSelect | null;
  };
  publicDto?: PublicCancelledBookingDTO;
  alreadyCancelled?: boolean;
  errorCode?: CancelBookingErrorCode;
  error?: string;
  safeCalendarStatus?: SafeCalendarSyncStatus;
  safeNotificationStatus?: SafeNotificationStatus;
  calendarSyncResult?: {
    attempted: boolean;
    success: boolean;
    alreadyRemoved?: boolean;
    error?: string;
  };
}

export interface PublicBookingCancellationSummary {
  eventTitle: string;
  hostName: string;
  hostSlug: string;
  guestName: string;
  startTime: string; // ISO
  endTime: string;   // ISO
  dateStr: string;
  timeStr: string;
  timezone: string;
  status: string;
  isPast: boolean;
  canCancel: boolean;
  cancellationReason?: string | null;
  cancelledAt?: string | null;
  notification?: {
    status: SafeNotificationStatus;
  } | null;
  calendarSync?: {
    status: SafeCalendarSyncStatus;
  } | null;
}

export interface CancelledCalendarCleanupResult {
  success: boolean;
  status: "not_applicable" | "cleaned" | "failed";
  alreadyRemoved?: boolean;
  error?: string;
  booking?: typeof bookings.$inferSelect;
}

/**
 * Maps an outbox DispatchNotificationResult to a strict, safe public notification status.
 */
export function mapDispatchResultToSafeStatus(
  result: DispatchNotificationResult
): SafeNotificationStatus {
  switch (result.status) {
    case "sent":
      return "sent";
    case "already_sent":
      return "already_sent";
    case "sending":
    case "claim_locked":
    case "claim_failed":
    case "stale_worker":
    case "idle":
      return "pending";
    case "failed":
    case "not_found":
    default:
      return "failed";
  }
}

/**
 * Maps raw database notification status to a safe public notification status.
 */
export function mapDbNotificationToSafeStatus(
  status?: string | null,
  isAlreadyCancelled: boolean = false
): SafeNotificationStatus {
  if (status === "sent") {
    return isAlreadyCancelled ? "already_sent" : "sent";
  }
  if (status === "sending" || status === "pending") {
    return "pending";
  }
  if (status === "failed") {
    return "failed";
  }
  return "pending";
}

/**
 * Maps raw database calendar sync status to a safe public calendar status.
 */
export function mapDbCalendarSyncToSafeStatus(
  calendarSyncStatus?: string | null,
  hasGcalEventId?: boolean
): SafeCalendarSyncStatus {
  if (!hasGcalEventId) return "not_applicable";
  if (calendarSyncStatus === "failed") return "failed";
  if (calendarSyncStatus === "pending") return "pending";
  return "cleaned";
}

/**
 * Whitelist builder: extracts strictly safe, public cancellation data.
 * Guarantees zero leakage of secrets, OAuth tokens, claim tokens, or internal metadata.
 */
export function toPublicCancellationDTO(
  booking: typeof bookings.$inferSelect & {
    eventType?: typeof eventTypes.$inferSelect | null;
    host?: typeof users.$inferSelect | null;
  },
  outcome: "cancelled" | "already_cancelled",
  calendarSyncStatus: SafeCalendarSyncStatus,
  notificationStatus: SafeNotificationStatus
): PublicCancelledBookingDTO {
  const host = booking.host;
  const guestTimezone = resolveTimezone(booking.guestTimezone, host?.timezone || "UTC");

  return {
    eventTitle: booking.eventType?.title || "Meeting",
    hostName: host?.name || "Host",
    hostSlug: host?.slug || "",
    dateStr: booking.startTime ? getDateStringInTimezone(booking.startTime, guestTimezone) : "",
    timeStr: booking.startTime ? formatTime12(booking.startTime, guestTimezone) : "",
    timezone: guestTimezone,
    status: "cancelled",
    cancellationReason: booking.cancellationReason || null,
    cancelledAt: booking.cancelledAt ? booking.cancelledAt.toISOString() : null,
    outcome,
    calendarSync: {
      status: calendarSyncStatus,
    },
    notification: {
      status: notificationStatus,
    },
  };
}

/**
 * Retrieves public cancellation details for a guest given their cancelToken.
 * Does not mutate state or disclose sensitive credentials.
 */
export async function getBookingForCancellation(
  token: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dbClient: any = db
): Promise<PublicBookingCancellationSummary | null> {
  if (!token || typeof token !== "string" || token.trim().length === 0) {
    return null;
  }

  let booking = await dbClient.query.bookings.findFirst({
    where: eq(bookings.cancelToken, token.trim()),
    with: {
      eventType: true,
      host: true,
    },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let attendeeRecord: any = null;

  if (!booking && dbClient.query?.bookingAttendees?.findFirst) {
    const attendee = await dbClient.query.bookingAttendees.findFirst({
      where: eq(bookingAttendees.cancelToken, token.trim()),
      with: {
        booking: {
          with: {
            eventType: true,
            host: true,
          },
        },
      },
    });

    if (attendee && attendee.booking) {
      booking = attendee.booking;
      attendeeRecord = attendee;
    }
  }

  if (!booking || !booking.host) {
    return null;
  }

  const host = booking.host;
  const guestTimezone = resolveTimezone(booking.guestTimezone, host.timezone || "UTC");
  const now = new Date();
  const isPast = new Date(booking.startTime).getTime() < now.getTime();
  const effectiveStatus = attendeeRecord ? attendeeRecord.status : booking.status;
  const canCancel = (effectiveStatus === "confirmed" || effectiveStatus === "pending") && !isPast;
  const isCancelled = effectiveStatus === "cancelled";

  return {
    eventTitle: booking.eventType?.title || "Meeting",
    hostName: host.name || "Host",
    hostSlug: host.slug || "",
    guestName: attendeeRecord ? attendeeRecord.guestName : booking.guestName,
    startTime: booking.startTime.toISOString(),
    endTime: booking.endTime.toISOString(),
    dateStr: getDateStringInTimezone(booking.startTime, guestTimezone),
    timeStr: formatTime12(booking.startTime, guestTimezone),
    timezone: guestTimezone,
    status: effectiveStatus,
    isPast,
    canCancel,
    cancellationReason: attendeeRecord ? attendeeRecord.cancellationReason : booking.cancellationReason || null,
    cancelledAt: attendeeRecord ? attendeeRecord.cancelledAt?.toISOString() : booking.cancelledAt?.toISOString() || null,
    notification: isCancelled
      ? { status: mapDbNotificationToSafeStatus(booking.notificationStatus, true) }
      : null,
    calendarSync: isCancelled
      ? { status: mapDbCalendarSyncToSafeStatus(booking.calendarSyncStatus, Boolean(booking.gcalEventId)) }
      : null,
  };
}

/**
 * Dedicated cancellation-specific Google Calendar cleanup retry.
 * For a booking in 'cancelled' state:
 * - If no Google Calendar event ID exists, reports not_applicable.
 * - If event ID exists and credentials present, retries deletion.
 * - Treats 404/410 as already removed / successful.
 * - If credentials missing or deletion fails, records failed status honestly.
 * - Never recreates or reactivates cancelled events.
 * - Never dispatches duplicate notification emails.
 */
export async function retryCancelledBookingCalendarCleanup(
  bookingId: string,
  hostId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dbClient: any = db
): Promise<CancelledCalendarCleanupResult> {
  const booking = await dbClient.query.bookings.findFirst({
    where: and(eq(bookings.id, bookingId), eq(bookings.hostId, hostId)),
    with: {
      host: true,
    },
  });

  if (!booking) {
    return {
      success: false,
      status: "failed",
      error: "Booking not found or not owned by host.",
    };
  }

  if (booking.status !== "cancelled") {
    return {
      success: false,
      status: "failed",
      error: `Booking is not cancelled (current status is '${booking.status}').`,
    };
  }

  // 1. If no external Google Calendar event ID exists
  if (!booking.gcalEventId) {
    await dbClient
      .update(bookings)
      .set({
        calendarSyncStatus: "not_applicable",
        lastSyncError: null,
        updatedAt: new Date(),
      })
      .where(eq(bookings.id, booking.id));

    return {
      success: true,
      status: "not_applicable",
    };
  }

  const host = booking.host;

  // 2. Missing credentials check: cannot report deletion as successful
  if (!host?.googleAccessToken && !host?.googleRefreshToken) {
    const errorMsg = "Google Calendar credentials not found or disconnected.";
    await dbClient
      .update(bookings)
      .set({
        calendarSyncStatus: "failed",
        lastSyncError: errorMsg,
        updatedAt: new Date(),
      })
      .where(eq(bookings.id, booking.id));

    return {
      success: false,
      status: "failed",
      error: errorMsg,
    };
  }

  // 3. Mark cleanup as pending during retry execution
  await dbClient
    .update(bookings)
    .set({
      calendarSyncStatus: "pending",
      updatedAt: new Date(),
    })
    .where(eq(bookings.id, booking.id));

  // 4. Retry deletion
  const calResult = await cancelGoogleCalendarEventWithDetails(
    { accessToken: host.googleAccessToken, refreshToken: host.googleRefreshToken },
    booking.gcalEventId
  );

  if (!calResult.success) {
    const errorMsg = calResult.error || "Failed to remove Google Calendar event.";
    await dbClient
      .update(bookings)
      .set({
        calendarSyncStatus: "failed",
        lastSyncError: errorMsg,
        updatedAt: new Date(),
      })
      .where(eq(bookings.id, booking.id));

    return {
      success: false,
      status: "failed",
      error: errorMsg,
    };
  }

  // Succeeded or already removed
  const [updated] = await dbClient
    .update(bookings)
    .set({
      calendarSyncStatus: "not_applicable",
      lastSyncError: null,
      updatedAt: new Date(),
    })
    .where(eq(bookings.id, booking.id))
    .returning();

  return {
    success: true,
    status: "cleaned",
    alreadyRemoved: calResult.alreadyRemoved,
    booking: updated,
  };
}

/**
 * Authoritative, unified booking cancellation service.
 * Used by:
 * - Public guest cancellation API (POST /api/cancel/[token])
 * - Host cancellation API (PATCH /api/bookings/[id] with status="cancelled")
 * - Host deletion API (DELETE /api/bookings/[id])
 */
export async function cancelBooking(
  params: CancelBookingParams,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dbClient: any = db
): Promise<CancelBookingResult> {
  const { identifier, identifierType, cancelledBy, hostId } = params;

  // 1. Validate cancellation reason
  let sanitizedReason: string | undefined;
  if (params.reason !== undefined && params.reason !== null) {
    if (typeof params.reason !== "string") {
      return {
        success: false,
        errorCode: "INVALID_REASON",
        error: "Cancellation reason must be a string.",
      };
    }
    const trimmed = params.reason.trim();
    if (trimmed.length > 500) {
      return {
        success: false,
        errorCode: "INVALID_REASON",
        error: "Cancellation reason cannot exceed 500 characters.",
      };
    }
    if (trimmed.length > 0) {
      sanitizedReason = trimmed;
    }
  }

  // 2. Fetch existing booking with host and eventType
  if (!identifier || typeof identifier !== "string" || identifier.trim().length === 0) {
    return {
      success: false,
      errorCode: "NOT_FOUND",
      error: "Booking identifier is required.",
    };
  }

  let existing = await dbClient.query.bookings.findFirst({
    where:
      identifierType === "token"
        ? eq(bookings.cancelToken, identifier.trim())
        : eq(bookings.id, identifier.trim()),
    with: {
      eventType: true,
      host: true,
      attendees: true,
    },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let attendeeRecord: any = null;

  if (!existing && identifierType === "token" && dbClient.query?.bookingAttendees?.findFirst) {
    const attendee = await dbClient.query.bookingAttendees.findFirst({
      where: eq(bookingAttendees.cancelToken, identifier.trim()),
      with: {
        booking: {
          with: {
            eventType: true,
            host: true,
            attendees: true,
          },
        },
      },
    });

    if (attendee && attendee.booking) {
      existing = attendee.booking;
      attendeeRecord = attendee;
    }
  }

  if (!existing || !existing.host) {
    return {
      success: false,
      errorCode: "NOT_FOUND",
      error: "Booking not found.",
    };
  }

  // Handle individual group attendee cancellation
  if (attendeeRecord) {
    if (attendeeRecord.status === "cancelled") {
      const publicDto = toPublicCancellationDTO(
        {
          ...existing,
          guestName: attendeeRecord.guestName,
          guestEmail: attendeeRecord.guestEmail,
          cancellationReason: attendeeRecord.cancellationReason,
          cancelledAt: attendeeRecord.cancelledAt,
        },
        "already_cancelled",
        "not_applicable",
        "already_sent"
      );
      return {
        success: true,
        alreadyCancelled: true,
        publicDto,
        safeCalendarStatus: "not_applicable",
        safeNotificationStatus: "already_sent",
      };
    }

    const cancellationDate = new Date();
    await dbClient
      .update(bookingAttendees)
      .set({
        status: "cancelled",
        cancelledAt: cancellationDate,
        cancellationReason: sanitizedReason || null,
        updatedAt: cancellationDate,
      })
      .where(eq(bookingAttendees.id, attendeeRecord.id));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const remainingAttendees = (existing.attendees || []).filter(
      (a: any) => a.id !== attendeeRecord.id && a.status !== "cancelled"
    );

    if (remainingAttendees.length > 0) {
      const publicDto = toPublicCancellationDTO(
        {
          ...existing,
          guestName: attendeeRecord.guestName,
          guestEmail: attendeeRecord.guestEmail,
          cancellationReason: sanitizedReason || null,
          cancelledAt: cancellationDate,
        },
        "cancelled",
        "not_applicable",
        "sent"
      );
      return {
        success: true,
        alreadyCancelled: false,
        publicDto,
        safeCalendarStatus: "not_applicable",
        safeNotificationStatus: "sent",
      };
    }
    // If no other attendees remain, proceed down to cancel the main booking
  }

  // 3. Authorization check for host-initiated cancellations
  if (cancelledBy === "host") {
    if (!hostId || existing.hostId !== hostId) {
      return {
        success: false,
        errorCode: "UNAUTHORIZED",
        error: "You are not authorized to cancel this booking.",
      };
    }
  }

  // 4. Idempotency check: already cancelled
  if (existing.status === "cancelled") {
    // Retry unfinished external work if needed without repeating completed operations
    let calSyncStatus: SafeCalendarSyncStatus = "not_applicable";
    if (existing.gcalEventId) {
      if (existing.calendarSyncStatus === "failed" || existing.calendarSyncStatus === "pending") {
        // Attempt recovery of failed or interrupted pending calendar cleanup
        const cleanup = await retryCancelledBookingCalendarCleanup(existing.id, existing.hostId, dbClient);
        calSyncStatus = cleanup.success ? "cleaned" : "failed";
      } else {
        calSyncStatus = "cleaned";
      }
    }

    let notifStatus: SafeNotificationStatus = "already_sent";
    if (existing.notificationStatus === "failed" || existing.notificationStatus === "pending") {
      const retryResult = await dispatchDurableBookingNotification(existing.id, dbClient);
      notifStatus = mapDispatchResultToSafeStatus(retryResult);
    } else {
      notifStatus = mapDbNotificationToSafeStatus(existing.notificationStatus, true);
    }

    const publicDto = toPublicCancellationDTO(
      existing,
      "already_cancelled",
      calSyncStatus,
      notifStatus
    );

    return {
      success: true,
      booking: existing,
      publicDto,
      alreadyCancelled: true,
      safeCalendarStatus: calSyncStatus,
      safeNotificationStatus: notifStatus,
    };
  }

  // 5. Ineligible status checks
  if (existing.status === "rejected") {
    return {
      success: false,
      errorCode: "INELIGIBLE_STATUS",
      error: "Cannot cancel a rejected booking request.",
    };
  }

  if (existing.status === "completed" || existing.status === "no_show") {
    return {
      success: false,
      errorCode: "INELIGIBLE_STATUS",
      error: `Cannot cancel a ${existing.status} booking.`,
    };
  }

  if (existing.status !== "confirmed" && existing.status !== "pending") {
    return {
      success: false,
      errorCode: "INELIGIBLE_STATUS",
      error: `Cannot cancel a booking in '${existing.status}' status.`,
    };
  }

  // 6. Time check: cannot cancel past appointments
  const now = new Date();
  if (new Date(existing.startTime).getTime() < now.getTime()) {
    return {
      success: false,
      errorCode: "PAST_BOOKING",
      error: "Cannot cancel an appointment that has already passed.",
    };
  }

  const host = existing.host;
  const hostTimezone = resolveTimezone(host.timezone, "UTC");
  const guestTimezone = resolveTimezone(existing.guestTimezone, hostTimezone);

  // 7. Prepare notification intent
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://usemorrow.xyz";
  const notificationType = cancelledBy === "guest" ? "guest_cancellation" : "host_cancellation";

  const notificationPayload: DurableNotificationPayload =
    cancelledBy === "guest"
      ? {
          toEmail: host.email,
          hostName: host.name,
          guestName: existing.guestName,
          guestEmail: existing.guestEmail,
          eventTitle: existing.eventType?.title || "Meeting",
          dateStr: getDateStringInTimezone(existing.startTime, hostTimezone),
          timeStr: formatTime12(existing.startTime, hostTimezone),
          reason: sanitizedReason,
          dashboardUrl: `${appUrl}/dashboard/bookings`,
        }
      : {
          toEmail: existing.guestEmail,
          guestName: existing.guestName,
          hostName: host.name,
          eventTitle: existing.eventType?.title || "Meeting",
          dateStr: getDateStringInTimezone(existing.startTime, guestTimezone),
          timeStr: formatTime12(existing.startTime, guestTimezone),
          reason: sanitizedReason,
          bookingUrl: `${appUrl}/${host.slug}`,
          rebookUrl: `${appUrl}/${host.slug}`,
        };

  // 8. Atomic conditional status update (prevents race conditions)
  // Sets calendarSyncStatus to 'pending' atomically if gcalEventId exists, preventing
  // crash window where a process exits before external calendar cleanup.
  const [transitionWon] = await dbClient
    .update(bookings)
    .set({
      status: "cancelled",
      cancelledAt: now,
      cancellationReason: sanitizedReason || null,
      calendarSyncStatus: existing.gcalEventId ? "pending" : "not_applicable",
      lastSyncError: null,
      notificationType,
      notificationStatus: "pending",
      notificationAttempts: 0,
      notificationLastError: null,
      notificationClaimToken: null,
      notificationClaimedAt: null,
      notificationPayload,
      updatedAt: now,
    })
    .where(
      and(
        eq(bookings.id, existing.id),
        inArray(bookings.status, ["confirmed", "pending"])
      )
    )
    .returning();

  if (!transitionWon) {
    // Another concurrent operation changed the status
    const fresh = await dbClient.query.bookings.findFirst({
      where: eq(bookings.id, existing.id),
      with: { eventType: true, host: true },
    });

    if (fresh?.status === "cancelled") {
      const safeCal = mapDbCalendarSyncToSafeStatus(fresh.calendarSyncStatus, Boolean(fresh.gcalEventId));
      const safeNotif = mapDbNotificationToSafeStatus(fresh.notificationStatus, true);

      const publicDto = toPublicCancellationDTO(
        fresh,
        "already_cancelled",
        safeCal,
        safeNotif
      );

      return {
        success: true,
        booking: fresh,
        publicDto,
        alreadyCancelled: true,
        safeCalendarStatus: safeCal,
        safeNotificationStatus: safeNotif,
      };
    }

    return {
      success: false,
      errorCode: "CONFLICT",
      error: `Cannot cancel booking: current status is '${fresh?.status || "unknown"}'.`,
    };
  }

  // 9. External Google Calendar synchronization
  let calResult: CancelGoogleEventResult | undefined;
  let safeCalendarStatus: SafeCalendarSyncStatus = existing.gcalEventId ? "pending" : "not_applicable";

  if (existing.gcalEventId) {
    if (host.googleAccessToken || host.googleRefreshToken) {
      calResult = await cancelGoogleCalendarEventWithDetails(
        { accessToken: host.googleAccessToken, refreshToken: host.googleRefreshToken },
        existing.gcalEventId
      );

      if (!calResult.success) {
        safeCalendarStatus = "failed";
        await dbClient
          .update(bookings)
          .set({
            calendarSyncStatus: "failed",
            lastSyncError: calResult.error || "Failed to remove Google Calendar event",
            updatedAt: new Date(),
          })
          .where(eq(bookings.id, existing.id));
      } else {
        safeCalendarStatus = "cleaned";
        await dbClient
          .update(bookings)
          .set({
            calendarSyncStatus: "not_applicable",
            lastSyncError: null,
            updatedAt: new Date(),
          })
          .where(eq(bookings.id, existing.id));
      }
    } else {
      // Event ID exists but no credentials available
      safeCalendarStatus = "failed";
      await dbClient
        .update(bookings)
        .set({
          calendarSyncStatus: "failed",
          lastSyncError: "Google Calendar credentials not found or disconnected.",
          updatedAt: new Date(),
        })
        .where(eq(bookings.id, existing.id));
    }
  }

  // 10. Dispatch durable notification outbox
  const notifyResult: DispatchNotificationResult = await dispatchDurableBookingNotification(existing.id, dbClient);
  const safeNotificationStatus: SafeNotificationStatus = mapDispatchResultToSafeStatus(notifyResult);

  // 11. Fetch final record
  try {
    realtimeBus.broadcast(`host:${existing.hostId}`, "booking.cancelled", {
      id: existing.id,
      guestName: existing.guestName,
      guestEmail: existing.guestEmail,
      eventTitle: existing.eventType?.title || "Meeting",
      reason: sanitizedReason,
    });
    if (existing.host?.slug) {
      realtimeBus.broadcast(`public:host:${existing.host.slug}`, "booking.cancelled", {
        id: existing.id,
        eventSlug: existing.eventType?.slug,
      });
    }
  } catch (err) {
    console.error("Failed to broadcast realtime cancellation:", err);
  }
  const finalBooking = await dbClient.query.bookings.findFirst({
    where: eq(bookings.id, existing.id),
    with: { eventType: true, host: true },
  });

  const recordForDto = {
    ...existing,
    ...transitionWon,
    ...(finalBooking || {}),
    eventType: finalBooking?.eventType || existing.eventType,
    host: finalBooking?.host || existing.host,
  };

  const publicDto = toPublicCancellationDTO(
    recordForDto,
    "cancelled",
    safeCalendarStatus,
    safeNotificationStatus
  );

  return {
    success: true,
    booking: finalBooking || transitionWon,
    publicDto,
    alreadyCancelled: false,
    safeCalendarStatus,
    safeNotificationStatus,
    calendarSyncResult: {
      attempted: Boolean(existing.gcalEventId),
      success: calResult ? calResult.success : (!existing.gcalEventId),
      alreadyRemoved: calResult?.alreadyRemoved,
      error: calResult?.error,
    },
  };
}
