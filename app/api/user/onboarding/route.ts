import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { users, availability, eventTypes } from "@/db/schema";
import { eq } from "drizzle-orm";

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
    const { slug, displayName, timezone, weekDays, eventTitle, duration } = body;

    // 1. Update user profile and mark onboarded
    await db
      .update(users)
      .set({
        name: displayName || host.name,
        slug: slug || host.slug,
        timezone: timezone || host.timezone,
        onboardedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(users.id, host.id));

    // 2. Save working hours availability if provided
    if (weekDays && Array.isArray(weekDays)) {
      // Clear old availability
      await db.delete(availability).where(eq(availability.userId, host.id));

      const dayMap: Record<string, number> = {
        Sunday: 0,
        Monday: 1,
        Tuesday: 2,
        Wednesday: 3,
        Thursday: 4,
        Friday: 5,
        Saturday: 6,
      };

      await db.insert(availability).values(
        weekDays.map((d: any) => ({
          userId: host.id,
          dayOfWeek: dayMap[d.day] ?? 1,
          startTime: d.start?.replace(" AM", "").replace(" PM", "") || "09:00",
          endTime: d.end?.replace(" AM", "").replace(" PM", "") || "17:00",
          isEnabled: !!d.enabled,
        }))
      );
    }

    // 3. Upsert primary event type if specified
    if (eventTitle) {
      const existingEvent = await db.query.eventTypes.findFirst({
        where: eq(eventTypes.userId, host.id),
      });

      if (existingEvent) {
        await db
          .update(eventTypes)
          .set({
            title: eventTitle,
            durationMins: duration || 30,
            updatedAt: new Date(),
          })
          .where(eq(eventTypes.id, existingEvent.id));
      } else {
        await db.insert(eventTypes).values({
          userId: host.id,
          title: eventTitle,
          slug: (eventTitle as string).toLowerCase().replace(/[^a-z0-9]/g, "-"),
          durationMins: duration || 30,
          locationType: "google_meet",
        });
      }
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Error in onboarding API:", err);
    return NextResponse.json({ error: "Failed to complete onboarding" }, { status: 500 });
  }
}
