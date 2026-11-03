import { db } from "@/db";
import { bookings, eventTypes, users } from "@/db/schema";
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
}

export interface CancelledCalendarCleanupResult {
  success: boolean;
  status: "not_applicable" | "cleaned" | "failed";
  alreadyRemoved?: boolean;
  error?: string;
  booking?: typeof bookings.$inferSelect;
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
  token: string
): Promise<PublicBookingCancellationSummary | null> {
  if (!token || typeof token !== "string" || token.trim().length === 0) {
    return null;
  }

  const booking = await db.query.bookings.findFirst({
    where: eq(bookings.cancelToken, token.trim()),
    with: {
      eventType: true,
      host: true,
    },
  });

  if (!booking || !booking.host) {
    return null;
  }

  const host = booking.host;
  const guestTimezone = resolveTimezone(booking.guestTimezone, host.timezone || "UTC");
  const now = new Date();
  const isPast = new Date(booking.startTime).getTime() < now.getTime();
  const canCancel = (booking.status === "confirmed" || booking.status === "pending") && !isPast;

  return {
    eventTitle: booking.eventType?.title || "Meeting",
    hostName: host.name || "Host",
    hostSlug: host.slug || "",
    guestName: booking.guestName,
    startTime: booking.startTime.toISOString(),
    endTime: booking.endTime.toISOString(),
    dateStr: getDateStringInTimezone(booking.startTime, guestTimezone),
    timeStr: formatTime12(booking.startTime, guestTimezone),
    timezone: guestTimezone,
    status: booking.status,
    isPast,
    canCancel,
    cancellationReason: booking.cancellationReason || null,
    cancelledAt: booking.cancelledAt?.toISOString() || null,
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
  hostId: string
): Promise<CancelledCalendarCleanupResult> {
  const booking = await db.query.bookings.findFirst({
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
    await db
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
      status: "failed",
      error: errorMsg,
    };
  }

  // 3. Retry deletion
  const calResult = await cancelGoogleCalendarEventWithDetails(
    { accessToken: host.googleAccessToken, refreshToken: host.googleRefreshToken },
    booking.gcalEventId
  );

  if (!calResult.success) {
    const errorMsg = calResult.error || "Failed to remove Google Calendar event.";
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
      status: "failed",
      error: errorMsg,
    };
  }

  // Succeeded or already removed
  const [updated] = await db
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
  params: CancelBookingParams
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

  const existing = await db.query.bookings.findFirst({
    where:
      identifierType === "token"
        ? eq(bookings.cancelToken, identifier.trim())
        : eq(bookings.id, identifier.trim()),
    with: {
      eventType: true,
      host: true,
    },
  });

  if (!existing || !existing.host) {
    return {
      success: false,
      errorCode: "NOT_FOUND",
      error: "Booking not found.",
    };
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
      if (existing.calendarSyncStatus === "failed") {
        // Attempt recovery of failed calendar cleanup
        const cleanup = await retryCancelledBookingCalendarCleanup(existing.id, existing.hostId);
        calSyncStatus = cleanup.success ? "cleaned" : "failed";
      } else {
        calSyncStatus = "cleaned";
      }
    }

    let notifStatus: SafeNotificationStatus = "already_sent";
    if (existing.notificationStatus === "failed" || existing.notificationStatus === "pending") {
      const retryResult = await dispatchDurableBookingNotification(existing.id);
      notifStatus = retryResult.status === "sent" ? "sent" : "failed";
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
  const [transitionWon] = await db
    .update(bookings)
    .set({
      status: "cancelled",
      cancelledAt: now,
      cancellationReason: sanitizedReason || null,
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
    const fresh = await db.query.bookings.findFirst({
      where: eq(bookings.id, existing.id),
      with: { eventType: true, host: true },
    });

    if (fresh?.status === "cancelled") {
      const publicDto = toPublicCancellationDTO(
        fresh,
        "already_cancelled",
        fresh.gcalEventId ? (fresh.calendarSyncStatus === "failed" ? "failed" : "cleaned") : "not_applicable",
        fresh.notificationStatus === "sent" ? "already_sent" : "failed"
      );

      return {
        success: true,
        booking: fresh,
        publicDto,
        alreadyCancelled: true,
        safeCalendarStatus: publicDto.calendarSync.status,
        safeNotificationStatus: publicDto.notification.status,
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
  let safeCalendarStatus: SafeCalendarSyncStatus = "not_applicable";

  if (existing.gcalEventId) {
    if (host.googleAccessToken || host.googleRefreshToken) {
      calResult = await cancelGoogleCalendarEventWithDetails(
        { accessToken: host.googleAccessToken, refreshToken: host.googleRefreshToken },
        existing.gcalEventId
      );

      if (!calResult.success) {
        safeCalendarStatus = "failed";
        await db
          .update(bookings)
          .set({
            calendarSyncStatus: "failed",
            lastSyncError: calResult.error || "Failed to remove Google Calendar event",
            updatedAt: new Date(),
          })
          .where(eq(bookings.id, existing.id));
      } else {
        safeCalendarStatus = "cleaned";
        await db
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
      await db
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
  const notifyResult: DispatchNotificationResult = await dispatchDurableBookingNotification(existing.id);

  let safeNotificationStatus: SafeNotificationStatus;
  if (notifyResult.status === "sent") {
    safeNotificationStatus = "sent";
  } else if (notifyResult.status === "already_sent") {
    safeNotificationStatus = "already_sent";
  } else if (notifyResult.status === "sending" || notifyResult.status === "claim_locked") {
    safeNotificationStatus = "pending";
  } else {
    safeNotificationStatus = "failed";
  }

  // 11. Fetch final record
  const finalBooking = await db.query.bookings.findFirst({
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
