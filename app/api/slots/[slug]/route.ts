import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users, eventTypes, availability, availabilityOverrides, bookings } from "@/db/schema";
import { eq, and, ne, gte, lte } from "drizzle-orm";
import { fetchGoogleBusyBlocks } from "@/lib/google-calendar";
import { generateAvailableSlots } from "@/lib/scheduling/slot-generator";
import {
  resolveTimezone,
  getStartOfLocalDay,
  getEndOfLocalDay,
} from "@/lib/scheduling/timezone";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const url = new URL(req.url);
    const dateParam = url.searchParams.get("date"); // YYYY-MM-DD
    const eventTypeIdParam = url.searchParams.get("eventTypeId");
    const timezoneParam = url.searchParams.get("timezone");
    const durationParam = url.searchParams.get("duration"); // Legacy fallback

    if (!dateParam) {
      return NextResponse.json(
        { error: "Missing required date parameter (YYYY-MM-DD)" },
        { status: 400 }
      );
    }

    // 1. Find host by slug
    const host = await db.query.users.findFirst({
      where: eq(users.slug, slug),
    });

    if (!host) {
      return NextResponse.json({ error: "Host not found" }, { status: 404 });
    }

    // 2. Strict event type resolution
    let targetEventType;
    if (eventTypeIdParam) {
      targetEventType = await db.query.eventTypes.findFirst({
        where: and(
          eq(eventTypes.id, eventTypeIdParam),
          eq(eventTypes.userId, host.id)
        ),
      });

      if (!targetEventType) {
        return NextResponse.json(
          { error: "Event type not found or does not belong to this host" },
          { status: 404 }
        );
      }

      if (!targetEventType.isActive) {
        return NextResponse.json(
          { error: "This event type is currently inactive" },
          { status: 400 }
        );
      }
    } else if (durationParam) {
      // Backward compatibility: match active event by duration
      targetEventType = await db.query.eventTypes.findFirst({
        where: and(
          eq(eventTypes.userId, host.id),
          eq(eventTypes.durationMins, parseInt(durationParam, 10)),
          eq(eventTypes.isActive, true)
        ),
      });

      if (!targetEventType) {
        // Fallback to first active event type for the host
        targetEventType = await db.query.eventTypes.findFirst({
          where: and(
            eq(eventTypes.userId, host.id),
            eq(eventTypes.isActive, true)
          ),
        });
      }
    } else {
      // Fallback to first active event type for the host if not specified
      targetEventType = await db.query.eventTypes.findFirst({
        where: and(
          eq(eventTypes.userId, host.id),
          eq(eventTypes.isActive, true)
        ),
      });
    }

    if (!targetEventType) {
      return NextResponse.json(
        { error: "No active event type found for this host" },
        { status: 404 }
      );
    }

    const guestTimezone = resolveTimezone(timezoneParam, host.timezone || "UTC");
    const hostTimezone = resolveTimezone(host.timezone, "UTC");

    // 3. Bounded database query: calculate UTC window for the requested date in guest timezone
    let guestDayStartUtc: Date;
    let guestDayEndUtc: Date;
    try {
      guestDayStartUtc = getStartOfLocalDay(dateParam, guestTimezone);
      guestDayEndUtc = getEndOfLocalDay(dateParam, guestTimezone);
    } catch {
      return NextResponse.json(
        { error: "Invalid date format. Expected YYYY-MM-DD" },
        { status: 400 }
      );
    }

    // Expand query window by 24h on each side to safely cover all host timezone variations & buffers
    const windowStart = new Date(guestDayStartUtc.getTime() - 24 * 60 * 60 * 1000);
    const windowEnd = new Date(guestDayEndUtc.getTime() + 24 * 60 * 60 * 1000);

    const [weeklyRecords, overrideRecords, boundedBookings] = await Promise.all([
      db.query.availability.findMany({
        where: eq(availability.userId, host.id),
      }),
      db.query.availabilityOverrides.findMany({
        where: eq(availabilityOverrides.userId, host.id),
      }),
      db.query.bookings.findMany({
        where: and(
          eq(bookings.hostId, host.id),
          ne(bookings.status, "cancelled"),
          gte(bookings.bufferEndTime, windowStart),
          lte(bookings.bufferStartTime, windowEnd)
        ),
      }),
    ]);

    // 4. External Google Calendar Busy Blocks
    let calendarBusyBlocks: Array<{ start: Date; end: Date }> = [];
    let calendarCheckFailed = false;

    if (host.googleAccessToken || host.googleRefreshToken) {
      const gcalRes = await fetchGoogleBusyBlocks(
        { accessToken: host.googleAccessToken, refreshToken: host.googleRefreshToken },
        windowStart,
        windowEnd
      );

      if (!gcalRes.success) {
        calendarCheckFailed = true;
      } else {
        calendarBusyBlocks = gcalRes.busy.map((b) => ({
          start: new Date(b.start),
          end: new Date(b.end),
        }));
      }
    }

    // 5. Generate slots using the authoritative engine
    const slotResult = generateAvailableSlots({
      host: {
        id: host.id,
        name: host.name,
        email: host.email,
        slug: host.slug,
        timezone: hostTimezone,
        bufferMins: host.bufferMins,
        minNoticeHours: host.minNoticeHours,
        maxBookingDays: host.maxBookingDays,
      },
      eventType: {
        id: targetEventType.id,
        userId: targetEventType.userId,
        title: targetEventType.title,
        slug: targetEventType.slug,
        durationMins: targetEventType.durationMins,
        description: targetEventType.description,
        locationType: targetEventType.locationType,
        locationUrl: targetEventType.locationUrl,
        isActive: targetEventType.isActive,
        bufferBeforeMins: targetEventType.bufferBeforeMins,
        bufferAfterMins: targetEventType.bufferAfterMins,
        minNoticeHours: targetEventType.minNoticeHours,
        maxPerDay: targetEventType.maxPerDay,
        requiresApproval: targetEventType.requiresApproval,
      },
      requestedDate: dateParam,
      guestTimezone,
      weeklyAvailability: weeklyRecords.map((w) => ({
        dayOfWeek: w.dayOfWeek,
        startTime: w.startTime,
        endTime: w.endTime,
        isEnabled: w.isEnabled,
      })),
      overrides: overrideRecords.map((o) => ({
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
      gridIntervalMins: 15,
    });

    if (slotResult.calendarError) {
      return NextResponse.json(
        {
          error: "External calendar availability could not be verified. Please try again later.",
          calendarError: true,
          slots: [],
        },
        { status: 503 }
      );
    }

    return NextResponse.json({
      host: {
        id: host.id,
        name: host.name,
        slug: host.slug,
        avatarUrl: host.avatarUrl,
        timezone: host.timezone,
      },
      eventType: {
        id: targetEventType.id,
        title: targetEventType.title,
        duration: targetEventType.durationMins,
      },
      date: dateParam,
      timezone: guestTimezone,
      slots: slotResult.slots,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    console.error("Error computing available slots:", message);
    return NextResponse.json({ error: "Failed to compute slots" }, { status: 500 });
  }
}
