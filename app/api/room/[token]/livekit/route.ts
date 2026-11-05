import { NextRequest, NextResponse } from "next/server";
import { getRoomByAccessToken } from "@/lib/room/room-service";
import { createLiveKitToken } from "@/lib/room/livekit-token";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    const room = await getRoomByAccessToken(token);

    if (!room) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 });
    }

    const searchParams = req.nextUrl.searchParams;
    const participantName = searchParams.get("name") || "Participant";
    const role = searchParams.get("role") || "guest";

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
      identity: `${role}-${token.slice(0, 8)}-${Date.now()}`,
      name: participantName,
      room: room.id,
    });

    return NextResponse.json({
      token: jwt,
      url: livekitUrl,
      roomName: room.id,
      participantName,
    });
  } catch (err) {
    console.error("[LiveKit Token] Error:", err);
    return NextResponse.json(
      { error: "Failed to create LiveKit token" },
      { status: 500 }
    );
  }
}
