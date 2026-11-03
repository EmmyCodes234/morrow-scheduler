import { db } from "@/db";
import { bookings } from "@/db/schema";
import { and, eq, inArray, lt, or, sql } from "drizzle-orm";
import { sendBookingApprovalEmail, sendBookingRejectionEmail } from "@/lib/email";

export interface DurableNotificationPayload {
  toEmail: string;
  guestName: string;
  hostName: string;
  hostEmail?: string;
  eventTitle: string;
  dateStr: string;
  timeStr: string;
  durationMins?: number;
  calendarSynced?: boolean;
  locationType?: string;
  locationUrl?: string | null;
  meetLink?: string;
  cancelUrl?: string;
  reason?: string;
  bookingUrl?: string;
  [key: string]: unknown;
}

/**
 * Centrally defined delivery lease duration.
 * An in-flight 'sending' claim is considered abandoned and recoverable after this duration.
 */
export const NOTIFICATION_LEASE_MS = 60_000; // 60 seconds

/**
 * Generates a stable provider idempotency key for email delivery retries.
 * Stable across retries for the same booking and notification type.
 */
export function generateResendIdempotencyKey(
  bookingId: string,
  notificationType: string
): string {
  return `morrow-booking-${bookingId}-${notificationType}-v1`;
}

export type DispatchNotificationStatus =
  | "sent"
  | "already_sent"
  | "sending"
  | "failed"
  | "claim_locked"
  | "claim_failed"
  | "stale_worker"
  | "idle"
  | "not_found";

export interface DispatchNotificationResult {
  success: boolean;
  status: DispatchNotificationStatus;
  error?: string;
  claimToken?: string;
}

/**
 * Dispatches a durable notification from the booking outbox with atomic claiming,
 * fence token protection, and provider idempotency keys.
 * 
 * State Machine:
 *   idle → pending → sending → sent
 *   sending → failed → sending
 * 
 * Lease & Stale Worker Protection:
 *   - Uses conditional PostgreSQL update to claim the notification row atomically.
 *   - A unique claim token is generated per attempt.
 *   - Completion updates (both success and failure) are fenced to the specific claim token and 'sending' status.
 *   - If a worker's lease expires and another worker acquires the claim, the stale worker's final update is safely ignored.
 * 
 * Resend Idempotency:
 *   - Generates stable key: `morrow-booking-${bookingId}-${notificationType}-v1`.
 *   - The payload and key remain immutable across retries.
 *   - Provider Limitation Note: Resend retains idempotency keys for 24 hours. Application-level recovery
 *     beyond this 24-hour window maintains delivery state independently via PostgreSQL.
 */
export async function dispatchDurableBookingNotification(
  bookingId: string
): Promise<DispatchNotificationResult> {
  const claimToken = crypto.randomUUID();
  const now = new Date();
  const leaseCutoff = new Date(now.getTime() - NOTIFICATION_LEASE_MS);

  // 1. Atomic Claim via conditional update
  // Only claim if status is 'pending' or 'failed', or if status is 'sending' and lease has expired.
  // Never claim 'idle' (requires explicit intent) or 'sent'.
  let claimedBooking: typeof bookings.$inferSelect | undefined;

  try {
    const [claimed] = await db
      .update(bookings)
      .set({
        notificationStatus: "sending",
        notificationClaimToken: claimToken,
        notificationClaimedAt: now,
        notificationAttempts: sql`${bookings.notificationAttempts} + 1`,
        updatedAt: now,
      })
      .where(
        and(
          eq(bookings.id, bookingId),
          or(
            inArray(bookings.notificationStatus, ["pending", "failed"]),
            and(
              eq(bookings.notificationStatus, "sending"),
              lt(bookings.notificationClaimedAt, leaseCutoff)
            )
          )
        )
      )
      .returning();

    claimedBooking = claimed;
  } catch (claimErr) {
    console.error("[Notification Outbox] Error during atomic claim:", claimErr);
    return {
      success: false,
      status: "claim_failed",
      error: claimErr instanceof Error ? claimErr.message : String(claimErr),
    };
  }

  // 2. If row was not claimed, inspect existing state to return precise reason
  if (!claimedBooking) {
    const existing = await db.query.bookings.findFirst({
      where: eq(bookings.id, bookingId),
    });

    if (!existing) {
      return { success: false, status: "not_found", error: "Booking not found" };
    }

    if (existing.notificationStatus === "sent") {
      return { success: true, status: "already_sent" };
    }

    if (existing.notificationStatus === "idle") {
      return {
        success: false,
        status: "idle",
        error: "No notification intent found on booking (status is idle)",
      };
    }

    if (existing.notificationStatus === "sending") {
      // Lease still active under another worker
      return {
        success: false,
        status: "claim_locked",
        error: "Another worker currently owns the notification delivery lease",
      };
    }

    return {
      success: false,
      status: "claim_failed",
      error: `Could not acquire notification claim for status '${existing.notificationStatus}'`,
    };
  }

  // 3. Validate notification payload and intent
  const payload = claimedBooking.notificationPayload as unknown as DurableNotificationPayload | null;
  if (!payload || !claimedBooking.notificationType) {
    // Release claim back to failed with descriptive error
    await db
      .update(bookings)
      .set({
        notificationStatus: "failed",
        notificationLastError: "Missing notification payload or notification type",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(bookings.id, bookingId),
          eq(bookings.notificationClaimToken, claimToken),
          eq(bookings.notificationStatus, "sending")
        )
      );

    return {
      success: false,
      status: "failed",
      error: "No notification intent found on booking",
    };
  }

  // 4. Stable Resend Idempotency Key (immutable across retries)
  const notificationType = claimedBooking.notificationType;
  const idempotencyKey = generateResendIdempotencyKey(bookingId, notificationType);

  let emailAccepted = false;
  let deliveryError: string | null = null;

  try {
    if (notificationType === "approval") {
      emailAccepted = await sendBookingApprovalEmail(
        {
          toEmail: payload.toEmail,
          guestName: payload.guestName,
          hostName: payload.hostName,
          hostEmail: payload.hostEmail || "",
          eventTitle: payload.eventTitle,
          dateStr: payload.dateStr,
          timeStr: payload.timeStr,
          durationMins: payload.durationMins || 30,
          calendarSynced: Boolean(payload.calendarSynced),
          locationType: payload.locationType || "google_meet",
          locationUrl: payload.locationUrl || undefined,
          meetLink: payload.meetLink,
          cancelUrl: payload.cancelUrl || "",
        },
        idempotencyKey
      );
    } else if (notificationType === "rejection") {
      emailAccepted = await sendBookingRejectionEmail(
        {
          toEmail: payload.toEmail,
          guestName: payload.guestName,
          hostName: payload.hostName,
          eventTitle: payload.eventTitle,
          dateStr: payload.dateStr,
          timeStr: payload.timeStr,
          reason: payload.reason,
          bookingUrl: payload.bookingUrl || "",
        },
        idempotencyKey
      );
    } else {
      deliveryError = `Unsupported notification type: ${notificationType}`;
    }

    if (!emailAccepted && !deliveryError) {
      deliveryError = "Email provider rejected or failed to accept message";
    }
  } catch (sendErr) {
    emailAccepted = false;
    deliveryError = sendErr instanceof Error ? sendErr.message : String(sendErr);
  }

  // 5. Fenced Status Update (Protects against stale workers whose lease expired)
  const [fencedRow] = await db
    .update(bookings)
    .set(
      emailAccepted
        ? {
            notificationStatus: "sent",
            notificationSentAt: new Date(),
            notificationLastError: null,
            updatedAt: new Date(),
          }
        : {
            notificationStatus: "failed",
            notificationLastError: deliveryError || "Notification delivery failed",
            updatedAt: new Date(),
          }
    )
    .where(
      and(
        eq(bookings.id, bookingId),
        eq(bookings.notificationClaimToken, claimToken),
        eq(bookings.notificationStatus, "sending")
      )
    )
    .returning();

  if (!fencedRow) {
    console.warn(
      `[Notification Outbox] Stale worker claim detected for booking ${bookingId}. Lease expired and claim was re-acquired.`
    );
    return {
      success: false,
      status: "stale_worker",
      error: "Notification claim expired and was acquired by another worker",
      claimToken,
    };
  }

  if (emailAccepted) {
    return { success: true, status: "sent", claimToken };
  }

  return {
    success: false,
    status: "failed",
    error: deliveryError || "Delivery rejected by email provider",
    claimToken,
  };
}
