import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { eventTypes, users } from "@/db/schema";
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
      return NextResponse.json({ eventTypes: [] });
    }

    const items = await db.query.eventTypes.findMany({
      where: eq(eventTypes.userId, host.id),
      orderBy: [desc(eventTypes.createdAt)],
    });

    return NextResponse.json({ eventTypes: items });
  } catch (err) {
    console.error("Error fetching event types:", err);
    return NextResponse.json({ error: "Failed to load event types" }, { status: 500 });
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
    const {
      title,
      slug,
      durationMins = 30,
      description = "",
      locationType = "google_meet",
      maxAttendees = 1,
      showRemainingSpots = true,
      minAttendees = 1,
    } = body;

    if (!title || !slug) {
      return NextResponse.json({ error: "Title and slug are required" }, { status: 400 });
    }

    const [created] = await db
      .insert(eventTypes)
      .values({
        userId: host.id,
        title,
        slug,
        durationMins,
        description,
        locationType,
        maxAttendees: Number(maxAttendees) || 1,
        showRemainingSpots: Boolean(showRemainingSpots),
        minAttendees: Number(minAttendees) || 1,
      })
      .returning();

    return NextResponse.json({ eventType: created }, { status: 201 });
  } catch (err) {
    console.error("Error creating event type:", err);
    return NextResponse.json({ error: "Failed to create event type" }, { status: 500 });
  }
}
