import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { users, officeKnocks } from "@/db/schema";
import { eq, and, asc, inArray } from "drizzle-orm";
import {
  createOfficeHoursCalendarEvent,
  promoteNextQueuedKnock,
  isHostWithinOfficeSchedule,
} from "@/lib/office/office-service";
import { realtimeBus } from "@/lib/realtime/event-bus";

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

    // Auto-timeout after 60 seconds (for ringing knocks only)
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

      // Check if another knock is queued to promote
      await promoteNextQueuedKnock(knock.hostId);

      return NextResponse.json({
        knock: {
          id: updated.id,
          status: updated.status,
          createdAt: updated.createdAt,
          meetLink: updated.meetLink,
        },
      });
    }

    // Calculate queue position if visitor is currently queued in waiting room
    let queuePosition = knock.queuePosition || 0;
    if (knock.status === "queued") {
      const queueItems = await db.query.officeKnocks.findMany({
        where: and(
          eq(officeKnocks.hostId, knock.hostId),
          inArray(officeKnocks.status, ["ringing", "queued"])
        ),
        orderBy: [asc(officeKnocks.createdAt)],
      });
      const idx = queueItems.findIndex((k) => k.id === knock.id);
      queuePosition = idx >= 0 ? idx + 1 : 1;
    }

    return NextResponse.json({
      knock: {
        id: knock.id,
        status: knock.status,
        queuePosition,
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

      realtimeBus.broadcast(`host:${knock.hostId}`, "knock.cancelled", { id: updated.id });
      realtimeBus.broadcast(`knock:${updated.id}`, "knock.cancelled", { id: updated.id });
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
      let meetLink: string | null = null;
      let googleCalendarEventId: string | null = null;

      // 1. If host has Google Calendar connected, synchronously provision a real, unique Google Meet link!
      if (host.googleAccessToken || host.googleRefreshToken) {
        try {
          const gcalResult = await createOfficeHoursCalendarEvent({
            host: {
              id: host.id,
              name: host.name,
              email: host.email,
              timezone: host.timezone,
              googleAccessToken: host.googleAccessToken,
              googleRefreshToken: host.googleRefreshToken,
            },
            knock: {
              id: knock.id,
              guestName: knock.guestName,
              guestEmail: knock.guestEmail,
              topic: knock.topic,
            },
            speedChatMins: host.officeSpeedChatMins || 10,
          });

          if (gcalResult?.meetLink) {
            meetLink = gcalResult.meetLink;
            googleCalendarEventId = gcalResult.eventId;
          }
        } catch (err) {
          console.error("[Google Calendar] Failed to create speed-chat hold:", err);
        }
      }

      // 2. If host has Zoom or Teams configured
      if (!meetLink) {
        if (host.defaultLocationType === "zoom" && host.zoomMeetingUrl) {
          meetLink = host.zoomMeetingUrl;
        } else if (host.defaultLocationType === "teams" && host.teamsMeetingUrl) {
          meetLink = host.teamsMeetingUrl;
        } else if (host.zoomMeetingUrl) {
          meetLink = host.zoomMeetingUrl;
        } else if (host.teamsMeetingUrl) {
          meetLink = host.teamsMeetingUrl;
        }
      }

      // 3. Fallback: NEVER use "https://meet.google.com/new" (which puts host and guest in separate rooms)!
      // If host has no external provider configured, provide a dedicated Morrow meeting room for this knock
      if (!meetLink) {
        meetLink = `${process.env.NEXT_PUBLIC_APP_URL || ""}/room/office_${knock.id}`;
      }

      const [updatedKnock] = await db
        .update(officeKnocks)
        .set({
          status: "admitted",
          meetLink,
          ...(googleCalendarEventId ? { googleCalendarEventId } : {}),
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

      // Formulate host's direct link with authuser parameter to prevent Google Meet account switching collision
      const hostMeetLink =
        host.email && meetLink.includes("meet.google.com")
          ? `${meetLink}${meetLink.includes("?") ? "&" : "?"}authuser=${encodeURIComponent(host.email)}`
          : meetLink;

      realtimeBus.broadcast(`knock:${updatedKnock.id}`, "knock.admitted", {
        id: updatedKnock.id,
        status: "admitted",
        meetLink,
      });
      realtimeBus.broadcast(`host:${host.id}`, "knock.updated", {
        id: updatedKnock.id,
        status: "admitted",
        meetLink: hostMeetLink,
      });

      return NextResponse.json({
        success: true,
        knock: updatedKnock,
        meetLink: hostMeetLink,
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

      realtimeBus.broadcast(`knock:${updatedKnock.id}`, "knock.declined", {
        id: updatedKnock.id,
        status: "declined",
      });
      realtimeBus.broadcast(`host:${host.id}`, "knock.updated", {
        id: updatedKnock.id,
        status: "declined",
      });

      // Check if another visitor is in queue and promote them
      const promoted = await promoteNextQueuedKnock(host.id);
      if (promoted) {
        realtimeBus.broadcast(`knock:${promoted.id}`, "knock.promoted", promoted);
        realtimeBus.broadcast(`host:${host.id}`, "knock.created", promoted);
      }

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

      // Check if a queued knock is waiting: promote the next visitor (Feature 4)
      const nextPromoted = await promoteNextQueuedKnock(host.id);

      if (!nextPromoted) {
        // If no one is queued or ringing, evaluate host's schedule
        const { effectiveStatus } = isHostWithinOfficeSchedule(host);
        await db
          .update(users)
          .set({
            officeStatus: effectiveStatus,
            updatedAt: new Date(),
          })
          .where(eq(users.id, host.id));
      }

      realtimeBus.broadcast(`knock:${updatedKnock.id}`, "knock.concluded", {
        id: updatedKnock.id,
        status: "concluded",
      });
      realtimeBus.broadcast(`host:${host.id}`, "knock.updated", {
        id: updatedKnock.id,
        status: "concluded",
      });

      if (nextPromoted) {
        realtimeBus.broadcast(`knock:${nextPromoted.id}`, "knock.promoted", nextPromoted);
        realtimeBus.broadcast(`host:${host.id}`, "knock.created", nextPromoted);
      }

      return NextResponse.json({
        success: true,
        knock: updatedKnock,
        promotedNext: Boolean(nextPromoted),
      });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (err) {
    console.error("Error updating knock:", err);
    return NextResponse.json({ error: "Failed to update knock" }, { status: 500 });
  }
}
