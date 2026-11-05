import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { rotateMeetingInvitationToken } from "@/lib/meetings/meeting-service";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function POST(
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

    const result = await rotateMeetingInvitationToken(id, host.id);

    return NextResponse.json({
      success: true,
      invitationToken: result.invitationToken,
      invitationUrl: result.invitationUrl,
    });
  } catch (err) {
    console.error("[Rotate Token API] POST error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to rotate invitation token" },
      { status: 500 }
    );
  }
}
