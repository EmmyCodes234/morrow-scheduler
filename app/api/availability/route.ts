import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { availability, users } from "@/db/schema";
import { eq, asc } from "drizzle-orm";
import { realtimeBus } from "@/lib/realtime/event-bus";

function to24Hour(timeStr?: string, fallback: string = "09:00"): string {
  if (!timeStr) return fallback;
  const match = timeStr.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (!match) return timeStr;
  let hour = parseInt(match[1], 10);
  const min = match[2];
  const ampm = match[3]?.toUpperCase();
  if (ampm === "PM" && hour < 12) hour += 12;
  if (ampm === "AM" && hour === 12) hour = 0;
  return `${hour.toString().padStart(2, "0")}:${min}`;
}

export async function GET() {
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

    const records = await db.query.availability.findMany({
      where: eq(availability.userId, host.id),
      orderBy: [asc(availability.dayOfWeek)],
    });

    return NextResponse.json({ availability: records, timezone: host.timezone });
  } catch (err) {
    console.error("Error fetching availability:", err);
    return NextResponse.json({ error: "Failed to fetch availability" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
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

    const body = await req.json();
    const { days, timezone } = body; // Array of { dayOfWeek: number, startTime: string, endTime: string, isEnabled: boolean }

    if (timezone && timezone !== host.timezone) {
      await db.update(users).set({ timezone }).where(eq(users.id, host.id));
    }

    if (Array.isArray(days)) {
      // Upsert availability for each day
      for (const d of days) {
        const existing = await db.query.availability.findFirst({
          where: eq(availability.userId, host.id),
        });

        // Delete existing and bulk insert fresh, or update
      }

      await db.delete(availability).where(eq(availability.userId, host.id));

      await db.insert(availability).values(
        days.map((d: any) => ({
          userId: host.id,
          dayOfWeek: Number(d.dayOfWeek),
          startTime: to24Hour(d.startTime, "09:00"),
          endTime: to24Hour(d.endTime, "17:00"),
          isEnabled: Boolean(d.isEnabled),
        }))
      );
    }

    const updated = await db.query.availability.findMany({
      where: eq(availability.userId, host.id),
      orderBy: [asc(availability.dayOfWeek)],
    });

    try {
      realtimeBus.broadcast(`host:${host.id}`, "availability.updated", {
        availability: updated,
        timezone: timezone || host.timezone,
      });
      if (host.slug) {
        realtimeBus.broadcast(`public:host:${host.slug}`, "availability.updated", {
          updatedAt: new Date().toISOString(),
        });
      }
    } catch (err) {
      console.error("Failed to broadcast realtime availability update:", err);
    }

    return NextResponse.json({ success: true, availability: updated });
  } catch (err) {
    console.error("Error saving availability:", err);
    return NextResponse.json({ error: "Failed to save availability" }, { status: 500 });
  }
}
