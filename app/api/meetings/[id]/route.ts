import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getMeetingById, updateMeeting, cancelMeeting } from "@/lib/meetings/meeting-service";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
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

    const meeting = await getMeetingById(id, host.id);
    if (!meeting) {
      return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, meeting });
  } catch (err) {
    console.error("[Meeting Detail API] GET error:", err);
    return NextResponse.json({ error: "Failed to load meeting" }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
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
    const updated = await updateMeeting(id, host.id, body);

    return NextResponse.json({ success: true, meeting: updated });
  } catch (err) {
    console.error("[Meeting Detail API] PATCH error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to update meeting" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
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

    const cancelled = await cancelMeeting(id, host.id);

    return NextResponse.json({ success: true, meeting: cancelled });
  } catch (err) {
    console.error("[Meeting Detail API] DELETE error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to cancel meeting" },
      { status: 500 }
    );
  }
}
