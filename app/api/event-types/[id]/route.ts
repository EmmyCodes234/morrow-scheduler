import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { eventTypes, users } from "@/db/schema";
import { eq, and } from "drizzle-orm";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

    const { id } = await params;
    const body = await req.json();

    const existing = await db.query.eventTypes.findFirst({
      where: and(eq(eventTypes.id, id), eq(eventTypes.userId, host.id)),
    });

    if (!existing) {
      return NextResponse.json({ error: "Event type not found" }, { status: 404 });
    }

    const updateData: Partial<typeof eventTypes.$inferInsert> = {
      updatedAt: new Date(),
    };

    if (body.title !== undefined) updateData.title = body.title.trim();
    if (body.slug !== undefined) {
      updateData.slug = body.slug.toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-");
    }
    if (body.durationMins !== undefined) updateData.durationMins = Number(body.durationMins);
    if (body.description !== undefined) updateData.description = body.description;
    if (body.locationType !== undefined) updateData.locationType = body.locationType;
    if (body.isActive !== undefined) updateData.isActive = Boolean(body.isActive);
    if (body.color !== undefined) updateData.color = body.color;
    if (body.maxAttendees !== undefined) updateData.maxAttendees = Number(body.maxAttendees) || 1;
    if (body.showRemainingSpots !== undefined) updateData.showRemainingSpots = Boolean(body.showRemainingSpots);
    if (body.minAttendees !== undefined) updateData.minAttendees = Number(body.minAttendees) || 1;

    const [updated] = await db
      .update(eventTypes)
      .set(updateData)
      .where(eq(eventTypes.id, id))
      .returning();

    return NextResponse.json({ success: true, eventType: updated });
  } catch (err) {
    console.error("Error updating event type:", err);
    return NextResponse.json({ error: "Failed to update event type" }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

    const { id } = await params;

    const existing = await db.query.eventTypes.findFirst({
      where: and(eq(eventTypes.id, id), eq(eventTypes.userId, host.id)),
    });

    if (!existing) {
      return NextResponse.json({ error: "Event type not found" }, { status: 404 });
    }

    await db.delete(eventTypes).where(eq(eventTypes.id, id));

    return NextResponse.json({ success: true, deletedId: id });
  } catch (err) {
    console.error("Error deleting event type:", err);
    return NextResponse.json({ error: "Failed to delete event type" }, { status: 500 });
  }
}
