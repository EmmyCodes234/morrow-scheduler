import { NextRequest, NextResponse } from "next/server";
import { getRoomByAccessToken } from "@/lib/room/room-service";
import { createLiveKitToken } from "@/lib/room/livekit-token";
import { getAttendeeBySessionToken, markAttendeeJoined, isMeetingCallOpen } from "@/lib/meetings/meeting-service";
import { auth } from "@/auth";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    const room = await getRoomByAccessToken(token);

    if (!room) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 });
    }

    if (room.status === "concluded") {
      return NextResponse.json(
        { error: "Meeting has concluded" },
        { status: 403 }
      );
    }

    // Lifecycle verification
    if (room.type === "group_meeting" && room.meeting) {
      if (room.meeting.status === "cancelled") {
        return NextResponse.json(
          { error: "Meeting has been cancelled" },
          { status: 403 }
        );
      }
    } else if (room.booking) {
      // Enforce booking eligibility before issuing LiveKit tokens
      const bookingStatus = room.booking.status;
      if (bookingStatus === "cancelled") {
        return NextResponse.json(
          { error: "Booking has been cancelled" },
          { status: 403 }
        );
      }
      if (bookingStatus === "rejected") {
        return NextResponse.json(
          { error: "Booking was declined" },
          { status: 403 }
        );
      }
      if (bookingStatus === "pending") {
        return NextResponse.json(
          { error: "Booking is pending approval" },
          { status: 403 }
        );
      }
      if (bookingStatus === "completed" || bookingStatus === "no_show") {
        return NextResponse.json(
          { error: "Booking has already finished" },
          { status: 403 }
        );
      }
      if (bookingStatus !== "confirmed") {
        return NextResponse.json(
          { error: "Booking is not eligible for video session" },
          { status: 403 }
        );
      }
    }

    // Server-authoritative participant identity:
    // Only the authenticated user matching host.id is granted the Host role.
    const session = await auth();
    const hostId = room.meeting?.host?.id || room.booking?.host?.id;
    const isHost = Boolean(session?.user?.id && session.user.id === hostId);

    let role: "host" | "guest" = isHost ? "host" : "guest";
    let participantName: string;
    let identity: string;

    if (isHost) {
      participantName = room.meeting?.host?.name || room.booking?.host?.name || "Host";
      identity = `host-${hostId}`;
    } else if (room.type === "group_meeting" && room.meeting) {
      // Group meeting guest identity resolution:
      // Read attendee session token from cookie, header, or body
      const body = await req.json().catch(() => ({}));
      const attendeeSessionCookie = req.cookies.get("morrow_attendee_session")?.value;
      const attendeeSessionHeader = req.headers.get("x-attendee-session");
      const attendeeSessionToken =
        attendeeSessionCookie || attendeeSessionHeader || (body && body.attendeeSessionToken);

      if (!attendeeSessionToken) {
        return NextResponse.json(
          {
            error: "Please register via the meeting invitation link before entering the room.",
            code: "ATTENDEE_REGISTRATION_REQUIRED",
          },
          { status: 403 }
        );
      }

      const attendee = await getAttendeeBySessionToken(
        attendeeSessionToken,
        room.meeting.id
      );

      if (!attendee) {
        return NextResponse.json(
          {
            error: "Invalid or expired attendee registration. Please register again.",
            code: "ATTENDEE_SESSION_INVALID",
          },
          { status: 403 }
        );
      }

      // Authoritative early-call access policy check
      const callStatus = isMeetingCallOpen(room.meeting);
      if (!callStatus.isOpen) {
        return NextResponse.json(
          {
            error: "Call is not open yet.",
            code: "CALL_NOT_OPEN_YET",
            opensAt: callStatus.opensAt.toISOString(),
            scheduledStartTime: callStatus.scheduledStartTime.toISOString(),
            earlyAccessMinutes: 15,
            timezone: room.meeting.timezone,
          },
          { status: 425 }
        );
      }

      role = "guest";
      participantName = attendee.name;
      identity = `attendee-${attendee.id}`;

      // Mark attendee as joined
      if (attendee.status !== "joined") {
        markAttendeeJoined(attendee.id).catch((err) =>
          console.warn("[LiveKit Token] Error updating attendee joined status:", err)
        );
      }
    } else {
      // 1-on-1 booking guest identity
      role = "guest";
      participantName = room.booking?.guest?.name || "Guest";
      const randomSuffix = Math.random().toString(36).substring(2, 7);
      identity = `guest-${room.booking.id}-${randomSuffix}`;
    }

    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    const livekitUrl = process.env.NEXT_PUBLIC_LIVEKIT_URL || process.env.LIVEKIT_URL;

    if (!apiKey || !apiSecret || !livekitUrl) {
      return NextResponse.json(
        { error: "LiveKit server credentials are not configured" },
        { status: 500 }
      );
    }

    const jwt = createLiveKitToken({
      apiKey,
      apiSecret,
      identity,
      name: participantName,
      room: room.id,
      ttlSeconds: 7200,
    });

    return NextResponse.json({
      token: jwt,
      url: livekitUrl,
      roomName: room.id,
      participantName,
      role,
    });
  } catch (err) {
    console.error("[LiveKit Token] Error:", err);
    return NextResponse.json(
      { error: "Failed to create LiveKit token" },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json(
    { error: "Method not allowed. LiveKit tokens must be requested via POST." },
    { status: 405 }
  );
}
