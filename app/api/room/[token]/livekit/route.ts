import { NextRequest, NextResponse } from "next/server";
import { getRoomByAccessToken } from "@/lib/room/room-service";
import { createLiveKitToken } from "@/lib/room/livekit-token";
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

    if (room.status === "concluded") {
      return NextResponse.json(
        { error: "Meeting has concluded" },
        { status: 403 }
      );
    }

    // Server-authoritative participant identity:
    // Only the authenticated user matching booking.host.id is granted the Host role.
    // All other callers receive the Guest role, derived strictly from the booking record.
    const session = await auth();
    const isHost = Boolean(session?.user?.id && session.user.id === room.booking.host.id);

    const role: "host" | "guest" = isHost ? "host" : "guest";
    const participantName = isHost
      ? room.booking.host.name
      : (room.booking.guest.name || "Guest");

    const randomSuffix = Math.random().toString(36).substring(2, 7);
    const identity = isHost
      ? `host-${room.booking.host.id}-${randomSuffix}`
      : `guest-${room.booking.id}-${randomSuffix}`;

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
