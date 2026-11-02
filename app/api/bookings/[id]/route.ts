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
  sendBookingApprovalEmail,
  sendBookingRejectionEmail,
} from "@/lib/email";
import {
  getDateStringInTimezone,
  formatTime12,
  resolveTimezone,
} from "@/lib/scheduling/timezone";
import { validateBookingRequest } from "@/lib/scheduling/validation";
import { resolveEffectiveLocation } from "@/lib/scheduling/location";

export async function PATCH(
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
    const body = await req.json();

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

    // 1. Action: Manual Calendar Sync Recovery
    if (body.action === "retry_sync") {
      const syncResult = await reconcileBookingCalendarSync(existing.id, host.id);
      const updated = await db.query.bookings.findFirst({
        where: eq(bookings.id, id),
      });
      return NextResponse.json({ success: true, booking: updated, syncResult });
    }

    // 2. Action: Status Transitions
    if (body.status !== undefined) {
      const requestedStatus = body.status;

      // Pending -> Confirmed (Approval Workflow)
      if (requestedStatus === "confirmed") {
        if (existing.status === "confirmed") {
          // Idempotent retry: already confirmed
          return NextResponse.json({ success: true, booking: existing });
        }
        if (existing.status !== "pending") {
          return NextResponse.json(
            { error: `Cannot approve booking in '${existing.status}' status (only pending bookings can be approved).` },
            { status: 400 }
          );
        }

        // Transition to confirmed
        await db
          .update(bookings)
          .set({
            status: "confirmed",
            updatedAt: new Date(),
          })
          .where(eq(bookings.id, id));

        // Synchronize with external calendar
        await reconcileBookingCalendarSync(existing.id, host.id);

        const updated = await db.query.bookings.findFirst({
          where: eq(bookings.id, id),
          with: { eventType: true },
        });

        const effectiveLocation = resolveEffectiveLocation({
          eventType: existing.eventType,
          host,
        });

        // Notify guest that booking was approved
        sendBookingApprovalEmail({
          toEmail: existing.guestEmail,
          guestName: existing.guestName,
          hostName: host.name,
          hostEmail: host.email,
          eventTitle: existing.eventType?.title || "Meeting",
          dateStr: getDateStringInTimezone(existing.startTime, hostTimezone),
          timeStr: formatTime12(existing.startTime, hostTimezone),
          durationMins: existing.eventType?.durationMins || 30,
          calendarSynced: updated?.calendarSyncStatus === "synced",
          locationType: effectiveLocation.locationType,
          locationUrl: effectiveLocation.locationUrl,
          meetLink: updated?.meetLink || undefined,
          cancelUrl: `${process.env.NEXT_PUBLIC_APP_URL || "https://usemorrow.xyz"}/cancel/${existing.cancelToken}`,
        }).catch((err) => console.error("Error sending approval email:", err));

        return NextResponse.json({ success: true, booking: updated });
      }

      // Pending -> Rejected (Rejection Workflow)
      if (requestedStatus === "rejected") {
        if (existing.status === "rejected") {
          // Idempotent retry: already rejected
          return NextResponse.json({ success: true, booking: existing });
        }
        if (existing.status !== "pending") {
          return NextResponse.json(
            { error: `Cannot reject booking in '${existing.status}' status (only pending bookings can be rejected).` },
            { status: 400 }
          );
        }

        // Updating to 'rejected' releases the reserved slot in the exclusion constraint
        const [updated] = await db
          .update(bookings)
          .set({
            status: "rejected",
            updatedAt: new Date(),
          })
          .where(eq(bookings.id, id))
          .returning();

        // Notify guest of rejection
        sendBookingRejectionEmail({
          toEmail: existing.guestEmail,
          guestName: existing.guestName,
          hostName: host.name,
          eventTitle: existing.eventType?.title || "Meeting",
          dateStr: getDateStringInTimezone(existing.startTime, hostTimezone),
          timeStr: formatTime12(existing.startTime, hostTimezone),
          reason: typeof body.reason === "string" ? body.reason : undefined,
          bookingUrl: `${process.env.NEXT_PUBLIC_APP_URL || "https://usemorrow.xyz"}/${host.slug}`,
        }).catch((err) => console.error("Error sending rejection email:", err));

        return NextResponse.json({ success: true, booking: updated });
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

    // 3. Action: Rescheduling / Updating Appointment Time with Full Buffer Recalculation
    if (body.startTime !== undefined) {
      if (existing.status === "cancelled" || existing.status === "rejected") {
        return NextResponse.json(
          { error: `Cannot reschedule a ${existing.status} booking.` },
          { status: 400 }
        );
      }

      const newStartTime = new Date(body.startTime);
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

        // If calendar was synced, reconcile with updated time
        if (existing.calendarSyncStatus === "synced" && existing.status === "confirmed") {
          await reconcileBookingCalendarSync(existing.id, host.id);
        }

        return NextResponse.json({ success: true, booking: updated });
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

    // 4. Action: Host Notes update
    if (body.hostNotes !== undefined) {
      const [updated] = await db
        .update(bookings)
        .set({ hostNotes: body.hostNotes, updatedAt: new Date() })
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
