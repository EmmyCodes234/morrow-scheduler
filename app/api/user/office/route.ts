import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { users, officeKnocks } from "@/db/schema";
import { realtimeBus } from "@/lib/realtime/event-bus";
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
      officeAutoSchedule: host.officeAutoSchedule || false,
      officeScheduleDays: host.officeScheduleDays || [1, 2, 3, 4, 5],
      officeScheduleStart: host.officeScheduleStart || "14:00",
      officeScheduleEnd: host.officeScheduleEnd || "16:00",
      knocks: knocks.map((k) => ({
        id: k.id,
        guestName: k.guestName,
        guestEmail: k.guestEmail,
        guestAvatarUrl: k.guestAvatarUrl,
        topic: k.topic,
        status: k.status,
        queuePosition: k.queuePosition || 0,
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

    if (body.officeAutoSchedule !== undefined) {
      updateData.officeAutoSchedule = Boolean(body.officeAutoSchedule);
    }

    if (body.officeScheduleDays !== undefined && Array.isArray(body.officeScheduleDays)) {
      updateData.officeScheduleDays = (body.officeScheduleDays as unknown[]).filter(
        (d): d is number => typeof d === "number" && d >= 0 && d <= 6
      );
    }

    if (body.officeScheduleStart !== undefined && typeof body.officeScheduleStart === "string") {
      updateData.officeScheduleStart = body.officeScheduleStart;
    }

    if (body.officeScheduleEnd !== undefined && typeof body.officeScheduleEnd === "string") {
      updateData.officeScheduleEnd = body.officeScheduleEnd;
    }

    const [updated] = await db
      .update(users)
      .set(updateData)
      .where(eq(users.id, host.id))
      .returning();

    const officePayload = {
      officeStatus: updated.officeStatus,
      officeTopic: updated.officeTopic,
      officeSpeedChatMins: updated.officeSpeedChatMins,
      officeNotifyEmail: updated.officeNotifyEmail,
      officeAutoSchedule: updated.officeAutoSchedule,
      officeScheduleDays: updated.officeScheduleDays,
      officeScheduleStart: updated.officeScheduleStart,
      officeScheduleEnd: updated.officeScheduleEnd,
    };

    realtimeBus.broadcast(`host:${host.id}`, "office.status_changed", officePayload);
    if (host.slug) {
      realtimeBus.broadcast(`public:host:${host.slug}`, "office.status_changed", {
        officeStatus: updated.officeStatus,
        officeTopic: updated.officeTopic,
      });
    }

    return NextResponse.json({
      success: true,
      user: officePayload,
    });
  } catch (err) {
    console.error("Error updating host office settings:", err);
    return NextResponse.json({ error: "Failed to update office settings" }, { status: 500 });
  }
}
