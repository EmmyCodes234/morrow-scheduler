import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { bookings, users, availability, availabilityOverrides } from "@/db/schema";
import { eq, and, ne, gte, lte } from "drizzle-orm";
import {
  reconcileBookingCalendarSync,
} from "@/lib/scheduling/booking-service";
import {
  cancelGoogleCalendarEvent,
  fetchGoogleBusyBlocks,
} from "@/lib/google-calendar";
import {
  getDateStringInTimezone,
  formatTime12,
  resolveTimezone,
} from "@/lib/scheduling/timezone";
import { validateBookingRequest } from "@/lib/scheduling/validation";
import { resolveEffectiveLocation } from "@/lib/scheduling/location";
import { parseJsonRequest } from "@/lib/http/parse-json";
import { dispatchDurableBookingNotification, type DurableNotificationPayload } from "@/lib/scheduling/notification-service";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // 1. Safe JSON parsing: catch JSON syntax errors (400) and reject null / array payloads
  const parsed = await parseJsonRequest(req);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error, errorCode: parsed.errorCode },
      { status: parsed.status }
    );
  }
  const body = parsed.data;

  try {
    const session = await auth();

    if (!session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const host = await db.query.users.findFirst({
      where: eq(users.email, session.user.email),
    });

    if (!host) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const { id } = await params;

    const existing = await db.query.bookings.findFirst({
      where: and(eq(bookings.id, id), eq(bookings.hostId, host.id)),
      with: {
        eventType: true,
      },
    });

    if (!existing) {
      return NextResponse.json({ error: "Booking not found" }, { status: 404 });
    }

    const hostTimezone = resolveTimezone(host.timezone, "UTC");

    // 2. Action: Manual Calendar Sync Recovery
    if (body.action === "retry_sync") {
      const syncResult = await reconcileBookingCalendarSync(existing.id, host.id);
      const updated = await db.query.bookings.findFirst({
        where: eq(bookings.id, id),
        with: { eventType: true },
      });

      if (!syncResult.success || !syncResult.calendarSynced) {
        return NextResponse.json(
          {
            success: false,
            error: syncResult.error || "Calendar synchronization failed.",
            booking: updated || existing,
            syncResult,
          },
          { status: 502 }
        );
      }

      return NextResponse.json({ success: true, booking: updated, syncResult });
    }

    // 3. Action: Manual Notification Outbox Retry
    if (body.action === "retry_notification") {
      const notifyResult = await dispatchDurableBookingNotification(existing.id);
      const updated = await db.query.bookings.findFirst({
        where: eq(bookings.id, id),
        with: { eventType: true },
      });

      if (!notifyResult.success) {
        return NextResponse.json(
          {
            success: false,
            error: notifyResult.error || "Notification delivery failed.",
            booking: updated || existing,
            notifyResult,
          },
          { status: 502 }
        );
      }

      return NextResponse.json({ success: true, booking: updated, notifyResult });
    }

    // 4. Action: Status Transitions
    if (body.status !== undefined) {
      const requestedStatus = body.status;

      // Pending -> Confirmed (Approval Workflow with Durable Notification Outbox)
      if (requestedStatus === "confirmed") {
        if (existing.status === "confirmed") {
          // Idempotent retry: already confirmed
          return NextResponse.json({ success: true, booking: existing });
        }
        if (existing.status !== "pending") {
          return NextResponse.json(
            { error: `Cannot approve booking in '${existing.status}' status (only pending bookings can be approved).`, errorCode: "CONFLICT" },
            { status: 409 }
          );
        }

        const effectiveLocation = resolveEffectiveLocation({
          eventType: existing.eventType,
          host,
        });

        const notificationPayload: DurableNotificationPayload = {
          toEmail: existing.guestEmail,
          guestName: existing.guestName,
          hostName: host.name,
          hostEmail: host.email,
          eventTitle: existing.eventType?.title || "Meeting",
          dateStr: getDateStringInTimezone(existing.startTime, hostTimezone),
          timeStr: formatTime12(existing.startTime, hostTimezone),
          durationMins: existing.eventType?.durationMins || 30,
          locationType: effectiveLocation.locationType,
          locationUrl: effectiveLocation.locationUrl,
          cancelUrl: `${process.env.NEXT_PUBLIC_APP_URL || "https://usemorrow.xyz"}/cancel/${existing.cancelToken}`,
        };

        // Atomic conditional update: transitions status AND stores notification intent in one atomic statement
        const [transitionWon] = await db
          .update(bookings)
          .set({
            status: "confirmed",
            notificationType: "approval",
            notificationStatus: "pending",
            notificationAttempts: 0,
            notificationLastError: null,
            notificationPayload,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(bookings.id, id),
              eq(bookings.hostId, host.id),
              eq(bookings.status, "pending")
            )
          )
          .returning();

        if (!transitionWon) {
          // Lost race to a concurrent request. Fetch fresh record.
          const fresh = await db.query.bookings.findFirst({
            where: and(eq(bookings.id, id), eq(bookings.hostId, host.id)),
            with: { eventType: true },
          });
          if (!fresh) {
            return NextResponse.json({ error: "Booking not found" }, { status: 404 });
          }
          if (fresh.status === "confirmed") {
            // Idempotent: another concurrent approval won
            return NextResponse.json({ success: true, booking: fresh });
          }
          return NextResponse.json(
            { error: `Cannot approve booking: current status is '${fresh.status}'.`, errorCode: "CONFLICT" },
            { status: 409 }
          );
        }

        // Synchronize with external calendar only once for winning transition
        const syncResult = await reconcileBookingCalendarSync(existing.id, host.id);

        // Fetch fresh record to preserve any concurrently updated payload fields and avoid stale overwrites
        const freshForPayload = await db.query.bookings.findFirst({
          where: eq(bookings.id, id),
        });
        const currentPayload = (freshForPayload?.notificationPayload as unknown as DurableNotificationPayload) || notificationPayload;

        // Persist calendar synchronization outcome independently of Meet link presence
        currentPayload.calendarSynced = Boolean(syncResult.calendarSynced);
        if (syncResult.meetLink) {
          currentPayload.meetLink = syncResult.meetLink;
        }
        // Preserve meeting location and URL in the payload
        if (effectiveLocation.locationType) {
          currentPayload.locationType = effectiveLocation.locationType;
        }
        if (effectiveLocation.locationUrl && !currentPayload.locationUrl) {
          currentPayload.locationUrl = effectiveLocation.locationUrl;
        }

        await db
          .update(bookings)
          .set({ notificationPayload: currentPayload as unknown as Record<string, unknown> })
          .where(eq(bookings.id, id));

        // Dispatch durable notification outside the DB transaction
        await dispatchDurableBookingNotification(existing.id);

        const updated = await db.query.bookings.findFirst({
          where: eq(bookings.id, id),
          with: { eventType: true },
        });

        return NextResponse.json({ success: true, booking: updated });
      }

      // Pending -> Rejected (Rejection Workflow with Durable Notification Outbox)
      if (requestedStatus === "rejected") {
        if (existing.status === "rejected") {
          // Idempotent retry: already rejected
          return NextResponse.json({ success: true, booking: existing });
        }
        if (existing.status !== "pending") {
          return NextResponse.json(
            { error: `Cannot reject booking in '${existing.status}' status (only pending bookings can be rejected).`, errorCode: "CONFLICT" },
            { status: 409 }
          );
        }

        const notificationPayload: DurableNotificationPayload = {
          toEmail: existing.guestEmail,
          guestName: existing.guestName,
          hostName: host.name,
          eventTitle: existing.eventType?.title || "Meeting",
          dateStr: getDateStringInTimezone(existing.startTime, hostTimezone),
          timeStr: formatTime12(existing.startTime, hostTimezone),
          reason: typeof body.reason === "string" ? body.reason : undefined,
          bookingUrl: `${process.env.NEXT_PUBLIC_APP_URL || "https://usemorrow.xyz"}/${host.slug}`,
        };

        // Atomic conditional update: transitions status AND stores rejection notification intent in one statement
        const [transitionWon] = await db
          .update(bookings)
          .set({
            status: "rejected",
            notificationType: "rejection",
            notificationStatus: "pending",
            notificationAttempts: 0,
            notificationLastError: null,
            notificationPayload,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(bookings.id, id),
              eq(bookings.hostId, host.id),
              eq(bookings.status, "pending")
            )
          )
          .returning();

        if (!transitionWon) {
          const fresh = await db.query.bookings.findFirst({
            where: and(eq(bookings.id, id), eq(bookings.hostId, host.id)),
            with: { eventType: true },
          });
          if (!fresh) {
            return NextResponse.json({ error: "Booking not found" }, { status: 404 });
          }
          if (fresh.status === "rejected") {
            return NextResponse.json({ success: true, booking: fresh });
          }
          return NextResponse.json(
            { error: `Cannot reject booking: current status is '${fresh.status}'.`, errorCode: "CONFLICT" },
            { status: 409 }
          );
        }

        // Dispatch durable rejection notification outside the DB transaction
        await dispatchDurableBookingNotification(existing.id);

        const updated = await db.query.bookings.findFirst({
          where: eq(bookings.id, id),
          with: { eventType: true },
        });

        return NextResponse.json({ success: true, booking: updated || transitionWon });
      }

      // Confirmed -> Cancelled (Cancellation Workflow)
      if (requestedStatus === "cancelled") {
        if (existing.status === "cancelled") {
          return NextResponse.json({ success: true, booking: existing });
        }

        // Cancel external Google Calendar event if present
        if (existing.gcalEventId && (host.googleAccessToken || host.googleRefreshToken)) {
          await cancelGoogleCalendarEvent(
            { accessToken: host.googleAccessToken, refreshToken: host.googleRefreshToken },
            existing.gcalEventId
          );
        }

        const [updated] = await db
          .update(bookings)
          .set({
            status: "cancelled",
            cancelledAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(bookings.id, id))
          .returning();

        return NextResponse.json({ success: true, booking: updated });
      }

      // Allowed post-meeting statuses
      if (requestedStatus === "completed" || requestedStatus === "no_show") {
        if (existing.status !== "confirmed") {
          return NextResponse.json(
            { error: `Cannot mark '${existing.status}' booking as ${requestedStatus}.` },
            { status: 400 }
          );
        }
        const [updated] = await db
          .update(bookings)
          .set({ status: requestedStatus, updatedAt: new Date() })
          .where(eq(bookings.id, id))
          .returning();

        return NextResponse.json({ success: true, booking: updated });
      }

      return NextResponse.json(
        { error: `Invalid status transition to '${requestedStatus}'.` },
        { status: 400 }
      );
    }

    // 5. Action: Rescheduling / Updating Appointment Time with Full Buffer Recalculation
    if (body.startTime !== undefined) {
      if (existing.status === "cancelled" || existing.status === "rejected") {
        return NextResponse.json(
          { error: `Cannot reschedule a ${existing.status} booking.` },
          { status: 400 }
        );
      }

      const newStartTime = new Date(body.startTime as string);
      if (isNaN(newStartTime.getTime())) {
        return NextResponse.json({ error: "Invalid startTime date string." }, { status: 400 });
      }

      if (!existing.eventType) {
        return NextResponse.json({ error: "Event type not found for booking." }, { status: 404 });
      }

      // Authoritative duration and buffer recalculation
      const durationMins = existing.eventType.durationMins;
      const newEndTime = new Date(newStartTime.getTime() + durationMins * 60 * 1000);

      const bufferBeforeMins = existing.eventType.bufferBeforeMins || 0;
      const bufferAfterMins =
        existing.eventType.bufferAfterMins > 0
          ? existing.eventType.bufferAfterMins
          : (host.bufferMins ?? 0);

      const newBufferStartTime = new Date(newStartTime.getTime() - bufferBeforeMins * 60 * 1000);
      const newBufferEndTime = new Date(newEndTime.getTime() + bufferAfterMins * 60 * 1000);

      // Bounded queries for validation (excluding the current booking itself)
      const queryWindowStart = new Date(newBufferStartTime.getTime() - 24 * 60 * 60 * 1000);
      const queryWindowEnd = new Date(newBufferEndTime.getTime() + 24 * 60 * 60 * 1000);

      const [hostWeekly, hostOverrides, otherBookings] = await Promise.all([
        db.query.availability.findMany({
          where: eq(availability.userId, host.id),
        }),
        db.query.availabilityOverrides.findMany({
          where: and(
            eq(availabilityOverrides.userId, host.id),
            eq(
              availabilityOverrides.date,
              getDateStringInTimezone(newStartTime, hostTimezone)
            )
          ),
        }),
        db.query.bookings.findMany({
          where: and(
            eq(bookings.hostId, host.id),
            ne(bookings.id, existing.id), // Exclude current booking
            ne(bookings.status, "cancelled"),
            ne(bookings.status, "rejected"),
            gte(bookings.bufferEndTime, queryWindowStart),
            lte(bookings.bufferStartTime, queryWindowEnd)
          ),
        }),
      ]);

      // FreeBusy check
      let calendarBusyBlocks: Array<{ start: Date; end: Date }> = [];
      let calendarCheckFailed = false;

      if (host.googleAccessToken || host.googleRefreshToken) {
        const freeBusyRes = await fetchGoogleBusyBlocks(
          { accessToken: host.googleAccessToken, refreshToken: host.googleRefreshToken },
          newBufferStartTime,
          newBufferEndTime
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

      const requestedDateStr = getDateStringInTimezone(newStartTime, existing.guestTimezone);
      const requestedTimeStr = formatTime12(newStartTime, existing.guestTimezone);

      const validation = validateBookingRequest({
        input: {
          eventTypeId: existing.eventTypeId,
          date: requestedDateStr,
          time: requestedTimeStr,
          guestName: existing.guestName,
          guestEmail: existing.guestEmail,
          guestTimezone: existing.guestTimezone,
        },
        host,
        eventType: existing.eventType,
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
        existingBookings: otherBookings.map((b) => ({
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
        const status = validation.errorCode === "CONFLICT" ? 409 : 400;
        return NextResponse.json(
          { error: validation.error, errorCode: validation.errorCode },
          { status }
        );
      }

      try {
        const [updated] = await db
          .update(bookings)
          .set({
            startTime: newStartTime,
            endTime: newEndTime,
            bufferStartTime: newBufferStartTime,
            bufferEndTime: newBufferEndTime,
            updatedAt: new Date(),
          })
          .where(eq(bookings.id, id))
          .returning();

        // If booking is confirmed and host has calendar tokens, update external Google Calendar event
        if (existing.status === "confirmed" && (host.googleAccessToken || host.googleRefreshToken)) {
          await reconcileBookingCalendarSync(existing.id, host.id);
        }

        const freshRecord = await db.query.bookings.findFirst({
          where: eq(bookings.id, id),
          with: { eventType: true },
        });

        return NextResponse.json({ success: true, booking: freshRecord || updated });
      } catch (dbErr: unknown) {
        const errStr = String(dbErr);
        if (errStr.includes("23P01") || errStr.includes("bookings_host_no_overlap")) {
          return NextResponse.json(
            { error: "The new time slot conflicts with an existing booking or buffer.", errorCode: "CONFLICT" },
            { status: 409 }
          );
        }
        throw dbErr;
      }
    }

    // 6. Action: Host Notes update
    if (body.hostNotes !== undefined) {
      const [updated] = await db
        .update(bookings)
        .set({ hostNotes: body.hostNotes as string, updatedAt: new Date() })
        .where(eq(bookings.id, id))
        .returning();

      return NextResponse.json({ success: true, booking: updated });
    }

    return NextResponse.json({ success: true, booking: existing });
  } catch (err) {
    console.error("Error updating booking:", err);
    return NextResponse.json({ error: "Failed to update booking" }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();

    if (!session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const host = await db.query.users.findFirst({
      where: eq(users.email, session.user.email),
    });

    if (!host) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const { id } = await params;

    const existing = await db.query.bookings.findFirst({
      where: and(eq(bookings.id, id), eq(bookings.hostId, host.id)),
    });

    if (!existing) {
      return NextResponse.json({ error: "Booking not found" }, { status: 404 });
    }

    // Cancel Google Calendar event if present
    if (existing.gcalEventId && (host.googleAccessToken || host.googleRefreshToken)) {
      await cancelGoogleCalendarEvent(
        { accessToken: host.googleAccessToken, refreshToken: host.googleRefreshToken },
        existing.gcalEventId
      );
    }

    // Mark as cancelled rather than hard deleting
    await db
      .update(bookings)
      .set({
        status: "cancelled",
        cancelledAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(bookings.id, id));

    return NextResponse.json({ success: true, cancelledId: id });
  } catch (err) {
    console.error("Error cancelling booking:", err);
    return NextResponse.json({ error: "Failed to cancel booking" }, { status: 500 });
  }
}
