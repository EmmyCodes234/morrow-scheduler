import { NextRequest, NextResponse } from "next/server";
import { getRoomByAccessToken } from "@/lib/room/room-service";
import { openMeetingEarly, isMeetingCallOpen } from "@/lib/meetings/meeting-service";
import { auth } from "@/auth";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Authentication required to open room early." },
        { status: 401 }
      );
    }

    const room = await getRoomByAccessToken(token);
    if (!room) {
      return NextResponse.json({ error: "Room not found." }, { status: 404 });
    }

    if (room.type !== "group_meeting" || !room.meeting) {
      return NextResponse.json(
        { error: "Only group meetings support early room opening." },
        { status: 400 }
      );
    }

    if (room.meeting.host.id !== session.user.id) {
      return NextResponse.json(
        { error: "Forbidden: only the meeting host can open the room early." },
        { status: 403 }
      );
    }

    const updated = await openMeetingEarly(room.meeting.id, session.user.id);
    const callAccessStatus = isMeetingCallOpen(updated);

    return NextResponse.json({
      success: true,
      meeting: updated,
      openedEarlyAt: updated.openedEarlyAt?.toISOString() || null,
      callAccessStatus,
    });
  } catch (err) {
    console.error("[Room Open Early API] Error:", err);
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Failed to open room early.",
      },
      { status: 500 }
    );
  }
}
