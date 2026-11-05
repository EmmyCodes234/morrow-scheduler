import { NextRequest, NextResponse } from "next/server";
import { openMeetingEarly, getMeetingById, isMeetingCallOpen } from "@/lib/meetings/meeting-service";
import { auth } from "@/auth";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Authentication required to open meeting early." },
        { status: 401 }
      );
    }

    const meeting = await getMeetingById(id, session.user.id);
    if (!meeting) {
      return NextResponse.json(
        { error: "Meeting not found or unauthorized." },
        { status: 404 }
      );
    }

    const updated = await openMeetingEarly(id, session.user.id);
    const callAccessStatus = isMeetingCallOpen(updated);

    return NextResponse.json({
      success: true,
      meeting: updated,
      openedEarlyAt: updated.openedEarlyAt?.toISOString() || null,
      callAccessStatus,
    });
  } catch (err) {
    console.error("[Meeting Open Early API] Error:", err);
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Failed to open meeting early.",
      },
      { status: 500 }
    );
  }
}
