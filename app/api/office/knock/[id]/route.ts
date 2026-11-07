import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { users, officeKnocks } from "@/db/schema";
import { eq, and } from "drizzle-orm";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const knock = await db.query.officeKnocks.findFirst({
      where: eq(officeKnocks.id, id),
      with: {
        host: true,
      },
    });

    if (!knock) {
      return NextResponse.json({ error: "Knock not found" }, { status: 404 });
    }

    // Auto-timeout after 60 seconds
    const createdAtMs = new Date(knock.createdAt).getTime();
    const elapsedMs = Date.now() - createdAtMs;

    if (knock.status === "ringing" && elapsedMs > 60000) {
      const [updated] = await db
        .update(officeKnocks)
        .set({
          status: "missed",
          updatedAt: new Date(),
        })
        .where(eq(officeKnocks.id, knock.id))
        .returning();

      return NextResponse.json({
        knock: {
          id: updated.id,
          status: updated.status,
          createdAt: updated.createdAt,
          meetLink: updated.meetLink,
        },
      });
    }

    return NextResponse.json({
      knock: {
        id: knock.id,
        status: knock.status,
        createdAt: knock.createdAt,
        meetLink: knock.meetLink,
        admittedAt: knock.admittedAt,
        concludedAt: knock.concludedAt,
        hostName: knock.host?.name,
      },
    });
  } catch (err) {
    console.error("Error fetching knock status:", err);
    return NextResponse.json({ error: "Failed to load knock status" }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const action = body.action; // "admit" | "decline" | "conclude" | "cancel"

    const knock = await db.query.officeKnocks.findFirst({
      where: eq(officeKnocks.id, id),
      with: {
        host: true,
      },
    });

    if (!knock) {
      return NextResponse.json({ error: "Knock not found" }, { status: 404 });
    }

    // Guest cancellation
    if (action === "cancel") {
      const [updated] = await db
        .update(officeKnocks)
        .set({
          status: "cancelled",
          updatedAt: new Date(),
        })
        .where(eq(officeKnocks.id, knock.id))
        .returning();

      return NextResponse.json({ success: true, knock: updated });
    }

    // Host actions require authenticated session matching host
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const host = await db.query.users.findFirst({
      where: eq(users.email, session.user.email),
    });

    if (!host || host.id !== knock.hostId) {
      return NextResponse.json({ error: "Forbidden: You are not the host" }, { status: 403 });
    }

    if (action === "admit") {
      // Determine host's video room URL
      let meetLink: string = "https://meet.google.com/new";
      if (host.defaultLocationType === "zoom" && host.zoomMeetingUrl) {
        meetLink = host.zoomMeetingUrl;
      } else if (host.defaultLocationType === "teams" && host.teamsMeetingUrl) {
        meetLink = host.teamsMeetingUrl;
      } else if (host.zoomMeetingUrl) {
        meetLink = host.zoomMeetingUrl;
      }

      const [updatedKnock] = await db
        .update(officeKnocks)
        .set({
          status: "admitted",
          meetLink,
          admittedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(officeKnocks.id, knock.id))
        .returning();

      // Update host status to busy
      await db
        .update(users)
        .set({
          officeStatus: "busy",
          updatedAt: new Date(),
        })
        .where(eq(users.id, host.id));

      return NextResponse.json({
        success: true,
        knock: updatedKnock,
        meetLink,
      });
    }

    if (action === "decline") {
      const [updatedKnock] = await db
        .update(officeKnocks)
        .set({
          status: "declined",
          updatedAt: new Date(),
        })
        .where(eq(officeKnocks.id, knock.id))
        .returning();

      return NextResponse.json({ success: true, knock: updatedKnock });
    }

    if (action === "conclude") {
      const [updatedKnock] = await db
        .update(officeKnocks)
        .set({
          status: "concluded",
          concludedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(officeKnocks.id, knock.id))
        .returning();

      // Check if other knocks are ringing: if not, revert host to open
      const remainingKnocks = await db.query.officeKnocks.findMany({
        where: and(
          eq(officeKnocks.hostId, host.id),
          eq(officeKnocks.status, "ringing")
        ),
      });

      if (remainingKnocks.length === 0) {
        await db
          .update(users)
          .set({
            officeStatus: "open",
            updatedAt: new Date(),
          })
          .where(eq(users.id, host.id));
      }

      return NextResponse.json({ success: true, knock: updatedKnock });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (err) {
    console.error("Error updating knock:", err);
    return NextResponse.json({ error: "Failed to update knock" }, { status: 500 });
  }
}
