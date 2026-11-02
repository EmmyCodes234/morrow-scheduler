import { NextResponse } from "next/server";
import { db } from "@/db";
import { users, eventTypes, availability } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function GET() {
  try {
    // 1. Check if a default host exists
    let host = await db.query.users.findFirst();

    if (!host) {
      const [newHost] = await db
        .insert(users)
        .values({
          name: "Emmanuel Enyi",
          email: "emmanuel@usemorrow.xyz",
          slug: "emmanuel",
          timezone: "Africa/Lagos",
          brandColor: "#2563EB",
          welcomeMessage: "Pick a time that works for you. Let's build something extraordinary.",
        })
        .returning();
      host = newHost;
    }

    // 2. Check if default event types exist
    const existingEvents = await db.query.eventTypes.findMany({
      where: eq(eventTypes.userId, host.id),
    });

    if (existingEvents.length === 0) {
      await db.insert(eventTypes).values([
        {
          userId: host.id,
          title: "15 Min Quick Catchup",
          slug: "quick",
          durationMins: 15,
          description: "A fast sync to align on priorities or answer quick questions.",
          locationType: "google_meet",
          color: "blue",
          isActive: true,
        },
        {
          userId: host.id,
          title: "30 Min Strategy Call",
          slug: "strategy",
          durationMins: 30,
          description: "Discuss product roadmap, technical feasibility, and next milestones.",
          locationType: "google_meet",
          color: "emerald",
          isActive: true,
        },
        {
          userId: host.id,
          title: "45 Min Deep Dive",
          slug: "deep-dive",
          durationMins: 45,
          description: "In-depth architecture review, technical design, or partner discovery.",
          locationType: "google_meet",
          color: "violet",
          isActive: true,
        },
      ]);
    }

    // 3. Check if default weekly availability exists
    const existingHours = await db.query.availability.findMany({
      where: eq(availability.userId, host.id),
    });

    if (existingHours.length === 0) {
      const days = [
        { dayOfWeek: 1, startTime: "09:00", endTime: "17:00", isEnabled: true }, // Mon
        { dayOfWeek: 2, startTime: "09:00", endTime: "17:00", isEnabled: true }, // Tue
        { dayOfWeek: 3, startTime: "09:00", endTime: "17:00", isEnabled: true }, // Wed
        { dayOfWeek: 4, startTime: "09:00", endTime: "17:00", isEnabled: true }, // Thu
        { dayOfWeek: 5, startTime: "09:00", endTime: "17:00", isEnabled: true }, // Fri
        { dayOfWeek: 6, startTime: "10:00", endTime: "14:00", isEnabled: false }, // Sat
        { dayOfWeek: 0, startTime: "10:00", endTime: "14:00", isEnabled: false }, // Sun
      ];

      for (const d of days) {
        await db.insert(availability).values({
          userId: host.id,
          ...d,
        });
      }
    }

    return NextResponse.json({
      success: true,
      message: "Database initialized with host, default event types, and weekly availability.",
      host: {
        id: host.id,
        name: host.name,
        slug: host.slug,
        email: host.email,
      },
    });
  } catch (err: any) {
    console.error("Seed error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
