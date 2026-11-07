import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { createMeeting, listHostMeetings } from "@/lib/meetings/meeting-service";
import { localWallClockToUtcDate } from "@/lib/scheduling/timezone";
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
    const {
      title,
      date,
      startTime,
      durationMins = 60,
      timezone,
      description,
      preparationMaterial,
      agenda,
    } = body;

    // 1. Title validation
    if (!title || typeof title !== "string" || title.trim().length === 0) {
      return NextResponse.json(
        { error: "Meeting title is required." },
        { status: 400 }
      );
    }

    // 2. Timezone resolution & validation
    const tz = (typeof timezone === "string" && timezone.trim().length > 0 ? timezone.trim() : null) || host.timezone || "Africa/Lagos";
    try {
      Intl.DateTimeFormat(undefined, { timeZone: tz });
    } catch {
      return NextResponse.json(
        { error: `Invalid IANA timezone identifier: "${tz}".` },
        { status: 400 }
      );
    }

    // 3. Duration validation
    const duration = Number(durationMins);
    if (isNaN(duration) || duration < 15 || duration > 1440) {
      return NextResponse.json(
        { error: "Meeting duration must be between 15 and 1440 minutes." },
        { status: 400 }
      );
    }

    let startDateTime: Date;
    let endDateTime: Date;

    // 4. Date & Start Time resolution
    if (typeof date === "string" && typeof startTime === "string") {
      const trimmedDate = date.trim();
      const trimmedTime = startTime.trim();

      if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmedDate)) {
        return NextResponse.json(
          { error: "Date must be in YYYY-MM-DD format." },
          { status: 400 }
        );
      }

      if (!/^\d{1,2}:\d{2}$/.test(trimmedTime)) {
        return NextResponse.json(
          { error: "Start time must be in HH:MM format (24-hour clock)." },
          { status: 400 }
        );
      }

      try {
        startDateTime = localWallClockToUtcDate(trimmedDate, trimmedTime, tz);
      } catch (err) {
        return NextResponse.json(
          { error: `Failed to convert local wall-clock time to UTC: ${err instanceof Error ? err.message : String(err)}` },
          { status: 400 }
        );
      }

      endDateTime = new Date(startDateTime.getTime() + duration * 60 * 1000);
    } else if (body.startTime && body.endTime) {
      // Fallback for direct ISO timestamps
      startDateTime = new Date(body.startTime);
      endDateTime = new Date(body.endTime);

      if (isNaN(startDateTime.getTime()) || isNaN(endDateTime.getTime())) {
        return NextResponse.json(
          { error: "Invalid start or end time format." },
          { status: 400 }
        );
      }

      if (endDateTime <= startDateTime) {
        return NextResponse.json(
          { error: "Meeting end time must be after start time." },
          { status: 400 }
        );
      }
    } else {
      return NextResponse.json(
        { error: "Date (YYYY-MM-DD) and startTime (HH:MM) are required." },
        { status: 400 }
      );
    }

    const result = await createMeeting(host.id, {
      title: title.trim(),
      startTime: startDateTime,
      endTime: endDateTime,
      timezone: tz,
      description: description?.trim() || null,
      preparationMaterial: preparationMaterial?.trim() || null,
      agenda: agenda || [],
      locationType: body.locationType,
      locationUrl: body.locationUrl,
    });

    return NextResponse.json(
      {
        success: true,
        meeting: result.meeting,
        room: result.room,
        roomAccessToken: result.room.accessToken,
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
