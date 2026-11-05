import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { createMeeting, listHostMeetings } from "@/lib/meetings/meeting-service";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";

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
      return NextResponse.json({ error: "Host not found" }, { status: 404 });
    }

    const meetingsList = await listHostMeetings(host.id);

    return NextResponse.json({
      success: true,
      meetings: meetingsList,
    });
  } catch (err) {
    console.error("[Meetings API] GET error:", err);
    return NextResponse.json(
      { error: "Failed to list meetings" },
      { status: 500 }
    );
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
      return NextResponse.json({ error: "Host not found" }, { status: 404 });
    }

    const body = await req.json().catch(() => ({}));
    const { title, date, startTime, durationMins = 60, timezone, description, preparationMaterial, agenda } = body;

    if (!title || typeof title !== "string" || title.trim().length === 0) {
      return NextResponse.json(
        { error: "Meeting title is required." },
        { status: 400 }
      );
    }

    if (!date || !startTime) {
      return NextResponse.json(
        { error: "Date and start time are required." },
        { status: 400 }
      );
    }

    // Construct start & end ISO strings
    // Format: "YYYY-MM-DD" and "HH:MM"
    const startIso = `${date}T${startTime}:00`;
    const startDateTime = new Date(startIso);

    if (isNaN(startDateTime.getTime())) {
      return NextResponse.json(
        { error: "Invalid date or start time format." },
        { status: 400 }
      );
    }

    const duration = typeof durationMins === "number" && durationMins > 0 ? durationMins : 60;
    const endDateTime = new Date(startDateTime.getTime() + duration * 60 * 1000);

    const result = await createMeeting(host.id, {
      title: title.trim(),
      startTime: startDateTime,
      endTime: endDateTime,
      timezone: timezone || host.timezone || "Africa/Lagos",
      description: description || null,
      preparationMaterial: preparationMaterial || null,
      agenda: agenda || [],
    });

    return NextResponse.json(
      {
        success: true,
        meeting: result.meeting,
        room: result.room,
        invitationToken: result.invitationToken,
        invitationUrl: result.invitationUrl,
      },
      { status: 201 }
    );
  } catch (err) {
    console.error("[Meetings API] POST error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create meeting" },
      { status: 500 }
    );
  }
}
