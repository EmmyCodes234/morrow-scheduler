import { db } from "@/db";
import { bookings, eventTypes } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import {
  cancelGoogleCalendarEventWithDetails,
  type CancelGoogleEventResult,
} from "@/lib/google-calendar";
import {
  dispatchDurableBookingNotification,
  type DurableNotificationPayload,
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

export interface CancelBookingResult {
  success: boolean;
  booking?: typeof bookings.$inferSelect & {
    eventType?: typeof eventTypes.$inferSelect | null;
  };
  alreadyCancelled?: boolean;
  errorCode?: CancelBookingErrorCode;
  error?: string;
  calendarSyncResult?: {
    attempted: boolean;
    success: boolean;
    alreadyRemoved?: boolean;
    error?: string;
  };
}

export interface PublicBookingCancellationSummary {
  id: string;
  cancelToken: string;
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
    id: booking.id,
    cancelToken: booking.cancelToken,
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
    cancellationReason: booking.cancellationReason,
    cancelledAt: booking.cancelledAt?.toISOString() || null,
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
    return {
      success: true,
      booking: existing,
      alreadyCancelled: true,
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
      with: { eventType: true },
    });

    if (fresh?.status === "cancelled") {
      return {
        success: true,
        booking: fresh,
        alreadyCancelled: true,
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
  if (existing.gcalEventId && (host.googleAccessToken || host.googleRefreshToken)) {
    calResult = await cancelGoogleCalendarEventWithDetails(
      { accessToken: host.googleAccessToken, refreshToken: host.googleRefreshToken },
      existing.gcalEventId
    );

    if (!calResult.success) {
      // Record failure on the booking record without rolling back the DB cancellation
      await db
        .update(bookings)
        .set({
          calendarSyncStatus: "failed",
          lastSyncError: calResult.error || "Failed to remove Google Calendar event",
          updatedAt: new Date(),
        })
        .where(eq(bookings.id, existing.id));
    } else {
      // Event removed successfully or was already removed externally
      await db
        .update(bookings)
        .set({
          calendarSyncStatus: "not_applicable",
          lastSyncError: null,
          updatedAt: new Date(),
        })
        .where(eq(bookings.id, existing.id));
    }
  }

  // 10. Dispatch durable notification outbox
  await dispatchDurableBookingNotification(existing.id);

  // 11. Fetch final record to return
  const finalBooking = await db.query.bookings.findFirst({
    where: eq(bookings.id, existing.id),
    with: { eventType: true },
  });

  return {
    success: true,
    booking: finalBooking || transitionWon,
    alreadyCancelled: false,
    calendarSyncResult: {
      attempted: Boolean(existing.gcalEventId),
      success: calResult ? calResult.success : true,
      alreadyRemoved: calResult?.alreadyRemoved,
      error: calResult?.error,
    },
  };
}
