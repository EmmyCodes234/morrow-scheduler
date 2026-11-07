import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { users, officeKnocks } from "@/db/schema";
import { eq, desc, and, or, inArray } from "drizzle-orm";

export async function GET(req: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const host = await db.query.users.findFirst({
      where: eq(users.email, session.user.email),
    });

    if (!host) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Load active and recent knocks
    const knocks = await db.query.officeKnocks.findMany({
      where: eq(officeKnocks.hostId, host.id),
      orderBy: [desc(officeKnocks.createdAt)],
      limit: 20,
    });

    return NextResponse.json({
      officeStatus: host.officeStatus || "closed",
      officeTopic: host.officeTopic || "",
      officeSpeedChatMins: host.officeSpeedChatMins || 10,
      officeNotifyEmail: host.officeNotifyEmail !== false,
      knocks: knocks.map((k) => ({
        id: k.id,
        guestName: k.guestName,
        guestEmail: k.guestEmail,
        guestAvatarUrl: k.guestAvatarUrl,
        topic: k.topic,
        status: k.status,
        meetLink: k.meetLink,
        admittedAt: k.admittedAt,
        createdAt: k.createdAt,
        expiresAt: new Date(new Date(k.createdAt).getTime() + 60000).toISOString(),
        isExpired: k.status === "ringing" && Date.now() - new Date(k.createdAt).getTime() > 60000,
      })),
    });
  } catch (err) {
    console.error("Error fetching host office state:", err);
    return NextResponse.json({ error: "Failed to load office state" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const host = await db.query.users.findFirst({
      where: eq(users.email, session.user.email),
    });

    if (!host) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const body = await req.json();
    const updateData: Partial<typeof users.$inferInsert> = {
      updatedAt: new Date(),
    };

    if (body.officeStatus !== undefined) {
      const status = body.officeStatus;
      if (["open", "busy", "closed"].includes(status)) {
        updateData.officeStatus = status;
      }
    }

    if (body.officeTopic !== undefined) {
      updateData.officeTopic = typeof body.officeTopic === "string" ? body.officeTopic.trim().slice(0, 140) : null;
    }

    if (body.officeSpeedChatMins !== undefined) {
      const mins = Number(body.officeSpeedChatMins);
      if ([5, 10, 15, 20].includes(mins)) {
        updateData.officeSpeedChatMins = mins;
      }
    }

    if (body.officeNotifyEmail !== undefined) {
      updateData.officeNotifyEmail = Boolean(body.officeNotifyEmail);
    }

    const [updated] = await db
      .update(users)
      .set(updateData)
      .where(eq(users.id, host.id))
      .returning();

    return NextResponse.json({
      success: true,
      user: {
        officeStatus: updated.officeStatus,
        officeTopic: updated.officeTopic,
        officeSpeedChatMins: updated.officeSpeedChatMins,
        officeNotifyEmail: updated.officeNotifyEmail,
      },
    });
  } catch (err) {
    console.error("Error updating host office settings:", err);
    return NextResponse.json({ error: "Failed to update office settings" }, { status: 500 });
  }
}
