import { db } from "@/db";
import { bookings } from "@/db/schema";
import { eq } from "drizzle-orm";
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
 * Dispatches a durable notification from the booking outbox.
 * 
 * - Ensures repeated approval/rejection calls do not duplicate notification delivery.
 * - Tracks attempts and records delivery state ('sent' or 'failed').
 * - Allows failed notifications to be retried independently without altering the booking status.
 * - External email transmission occurs strictly outside the database state-transition transaction.
 */
export async function dispatchDurableBookingNotification(bookingId: string): Promise<{
  success: boolean;
  status: "sent" | "failed" | "already_sent";
  error?: string;
}> {
  const booking = await db.query.bookings.findFirst({
    where: eq(bookings.id, bookingId),
  });

  if (!booking) {
    return { success: false, status: "failed", error: "Booking not found" };
  }

  // Idempotency: do not resend if already marked sent
  if (booking.notificationStatus === "sent") {
    return { success: true, status: "already_sent" };
  }

  const payload = booking.notificationPayload as unknown as DurableNotificationPayload | null;
  if (!payload || !booking.notificationType) {
    return { success: false, status: "failed", error: "No notification intent found on booking" };
  }

  try {
    if (booking.notificationType === "approval") {
      await sendBookingApprovalEmail({
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
      });
    } else if (booking.notificationType === "rejection") {
      await sendBookingRejectionEmail({
        toEmail: payload.toEmail,
        guestName: payload.guestName,
        hostName: payload.hostName,
        eventTitle: payload.eventTitle,
        dateStr: payload.dateStr,
        timeStr: payload.timeStr,
        reason: payload.reason,
        bookingUrl: payload.bookingUrl || "",
      });
    }

    // Record successful delivery
    await db
      .update(bookings)
      .set({
        notificationStatus: "sent",
        notificationSentAt: new Date(),
        notificationAttempts: (booking.notificationAttempts || 0) + 1,
        notificationLastError: null,
        updatedAt: new Date(),
      })
      .where(eq(bookings.id, bookingId));

    return { success: true, status: "sent" };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[Notification Outbox] Delivery failed for booking ${bookingId}:`, errorMsg);

    // Record failed attempt while keeping status retryable
    await db
      .update(bookings)
      .set({
        notificationStatus: "failed",
        notificationAttempts: (booking.notificationAttempts || 0) + 1,
        notificationLastError: errorMsg,
        updatedAt: new Date(),
      })
      .where(eq(bookings.id, bookingId));

    return { success: false, status: "failed", error: errorMsg };
  }
}
