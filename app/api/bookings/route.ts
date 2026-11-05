import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { bookings, users, eventTypes } from "@/db/schema";
import { eq, desc } from "drizzle-orm";

export async function GET(req: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const host = await db.query.users.findFirst({
      where: eq(users.email, session.user.email),
    });

    if (!host) {
      return NextResponse.json({ bookings: [] });
    }

    const hostBookings = await db.query.bookings.findMany({
      where: eq(bookings.hostId, host.id),
      orderBy: [desc(bookings.startTime)],
      with: {
        eventType: true,
        room: true,
      },
    });

    return NextResponse.json({
      bookings: hostBookings.map((b) => ({
        id: b.id,
        guestName: b.guestName,
        guestEmail: b.guestEmail,
        eventTitle: b.eventType?.title || "Meeting",
        date: new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" }).format(b.startTime),
        time: new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "numeric", hour12: true }).format(b.startTime),
        rawStartTime: b.startTime.toISOString(),
        rawEndTime: b.endTime.toISOString(),
        meetLink: b.meetLink,
        roomToken: b.room?.accessToken,
        status: b.status,
        guestNotes: b.guestNotes,
        hostNotes: b.hostNotes,
        cancelToken: b.cancelToken,
      })),
    });
  } catch (err) {
    console.error("Error fetching bookings:", err);
    return NextResponse.json({ error: "Failed to load bookings" }, { status: 500 });
  }
}
