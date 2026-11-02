import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users, eventTypes, availability, availabilityOverrides, bookings } from "@/db/schema";
import { eq, and, ne } from "drizzle-orm";
import { fetchGoogleBusyBlocks } from "@/lib/google-calendar";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const url = new URL(req.url);
    const dateParam = url.searchParams.get("date"); // YYYY-MM-DD
    const durationParam = url.searchParams.get("duration"); // e.g. 15, 30, 45, 60

    if (!dateParam) {
      return NextResponse.json({ error: "Missing date parameter (YYYY-MM-DD)" }, { status: 400 });
    }

    // 1. Find user by slug
    const host = await db.query.users.findFirst({
      where: eq(users.slug, slug),
    });

    if (!host) {
      return NextResponse.json({ error: "Host not found" }, { status: 404 });
    }

    // 2. Parse date
    const [year, month, day] = dateParam.split("-").map(Number);
    const requestedDate = new Date(Date.UTC(year, month - 1, day));
    const dayOfWeek = requestedDate.getUTCDay(); // 0 = Sun, 1 = Mon ...

    // 3. Check for date overrides
    const override = await db.query.availabilityOverrides.findFirst({
      where: and(
        eq(availabilityOverrides.userId, host.id),
        eq(availabilityOverrides.date, dateParam)
      ),
    });

    if (override?.isBlocked) {
      return NextResponse.json({ slots: [], message: "Host is unavailable on this date" });
    }

    // 4. Get standard hours
    const hostHours = await db.query.availability.findFirst({
      where: and(
        eq(availability.userId, host.id),
        eq(availability.dayOfWeek, dayOfWeek)
      ),
    });

    if ((!hostHours || !hostHours.isEnabled) && !override) {
      return NextResponse.json({ slots: [], message: "No availability on this day of week" });
    }

    const startStr = override?.startTime || hostHours?.startTime || "09:00";
    const endStr = override?.endTime || hostHours?.endTime || "17:00";

    const [startHour, startMinute] = startStr.split(":").map(Number);
    const [endHour, endMinute] = endStr.split(":").map(Number);

    const slotDuration = durationParam ? parseInt(durationParam, 10) : 30;

    // 5. Build start and end of working day in UTC
    const windowStart = new Date(Date.UTC(year, month - 1, day, startHour, startMinute, 0));
    const windowEnd = new Date(Date.UTC(year, month - 1, day, endHour, endMinute, 0));

    // 6. Fetch existing bookings on this day for the host
    const existingBookings = await db.query.bookings.findMany({
      where: and(
        eq(bookings.hostId, host.id),
        ne(bookings.status, "cancelled")
      ),
    });

    // Filter to this day's bookings
    const dayBookings = existingBookings.filter((b) => {
      const bDate = b.startTime.toISOString().split("T")[0];
      return bDate === dateParam;
    });

    // 7. Fetch Google Calendar busy blocks if tokens exist
    let googleBusy: Array<{ start: string; end: string }> = [];
    if (host.googleAccessToken || host.googleRefreshToken) {
      googleBusy = await fetchGoogleBusyBlocks(
        { accessToken: host.googleAccessToken, refreshToken: host.googleRefreshToken },
        windowStart,
        windowEnd
      );
    }

    // 8. Generate potential slots
    const availableSlots: string[] = [];
    let currentSlot = new Date(windowStart);

    while (currentSlot.getTime() + slotDuration * 60 * 1000 <= windowEnd.getTime()) {
      const slotEnd = new Date(currentSlot.getTime() + slotDuration * 60 * 1000);

      // Check conflict with existing bookings
      const bookingConflict = dayBookings.some((b) => {
        return (
          (currentSlot >= b.startTime && currentSlot < b.endTime) ||
          (slotEnd > b.startTime && slotEnd <= b.endTime) ||
          (currentSlot <= b.startTime && slotEnd >= b.endTime)
        );
      });

      // Check conflict with Google Calendar busy blocks
      const googleConflict = googleBusy.some((block) => {
        const bStart = new Date(block.start);
        const bEnd = new Date(block.end);
        return (
          (currentSlot >= bStart && currentSlot < bEnd) ||
          (slotEnd > bStart && slotEnd <= bEnd) ||
          (currentSlot <= bStart && slotEnd >= bEnd)
        );
      });

      if (!bookingConflict && !googleConflict) {
        // Format to 12-hour time: "09:30 AM"
        const hours = currentSlot.getUTCHours();
        const minutes = currentSlot.getUTCMinutes();
        const ampm = hours >= 12 ? "PM" : "AM";
        const formattedHour = hours % 12 === 0 ? 12 : hours % 12;
        const formattedMinute = minutes < 10 ? `0${minutes}` : `${minutes}`;
        availableSlots.push(`${formattedHour < 10 ? "0" : ""}${formattedHour}:${formattedMinute} ${ampm}`);
      }

      // Step forward by slotDuration
      currentSlot = new Date(currentSlot.getTime() + slotDuration * 60 * 1000);
    }

    return NextResponse.json({
      host: {
        id: host.id,
        name: host.name,
        slug: host.slug,
        avatarUrl: host.avatarUrl,
        timezone: host.timezone,
      },
      date: dateParam,
      duration: slotDuration,
      slots: availableSlots,
    });
  } catch (error) {
    console.error("Error computing available slots:", error);
    return NextResponse.json({ error: "Failed to compute slots" }, { status: 500 });
  }
}
