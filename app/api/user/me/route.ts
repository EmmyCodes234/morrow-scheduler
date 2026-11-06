import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function GET() {
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

    return NextResponse.json({
      user: {
        id: host.id,
        name: host.name,
        email: host.email,
        slug: host.slug,
        avatarUrl: host.avatarUrl,
        timezone: host.timezone,
        brandColor: host.brandColor,
        welcomeMessage: host.welcomeMessage,
        defaultLocationType: host.defaultLocationType || "google_meet",
        zoomMeetingUrl: host.zoomMeetingUrl || "",
        teamsMeetingUrl: host.teamsMeetingUrl || "",
        zoomEmail: host.zoomEmail || null,
        zoomConnectedAt: host.zoomConnectedAt || null,
        bufferMins: host.bufferMins ?? 10,
        minNoticeHours: host.minNoticeHours ?? 2,
        maxBookingDays: host.maxBookingDays ?? 30,
        onboardedAt: host.onboardedAt,
        hasGoogleCalendar: Boolean(host.googleAccessToken || host.googleRefreshToken),
      },
    });
  } catch (err) {
    console.error("Error fetching user profile:", err);
    return NextResponse.json({ error: "Failed to fetch profile" }, { status: 500 });
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

    if (body.name !== undefined) updateData.name = body.name.trim();
    if (body.timezone !== undefined) updateData.timezone = body.timezone;
    if (body.brandColor !== undefined) updateData.brandColor = body.brandColor;
    if (body.welcomeMessage !== undefined) updateData.welcomeMessage = body.welcomeMessage;
    if (body.defaultLocationType !== undefined) updateData.defaultLocationType = body.defaultLocationType;
    if (body.zoomMeetingUrl !== undefined) updateData.zoomMeetingUrl = body.zoomMeetingUrl.trim();
    if (body.teamsMeetingUrl !== undefined) updateData.teamsMeetingUrl = body.teamsMeetingUrl.trim();
    if (body.bufferMins !== undefined) updateData.bufferMins = Number(body.bufferMins);
    if (body.minNoticeHours !== undefined) updateData.minNoticeHours = Number(body.minNoticeHours);
    if (body.maxBookingDays !== undefined) updateData.maxBookingDays = Number(body.maxBookingDays);

    if (body.slug !== undefined) {
      const sanitizedSlug = body.slug
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");

      if (sanitizedSlug && sanitizedSlug !== host.slug) {
        const existing = await db.query.users.findFirst({
          where: eq(users.slug, sanitizedSlug),
        });
        if (existing && existing.id !== host.id) {
          return NextResponse.json({ error: "Slug is already taken by another user" }, { status: 400 });
        }
        updateData.slug = sanitizedSlug;
      }
    }

    const [updated] = await db
      .update(users)
      .set(updateData)
      .where(eq(users.id, host.id))
      .returning();

    return NextResponse.json({
      success: true,
      user: {
        id: updated.id,
        name: updated.name,
        email: updated.email,
        slug: updated.slug,
        avatarUrl: updated.avatarUrl,
        timezone: updated.timezone,
        brandColor: updated.brandColor,
        welcomeMessage: updated.welcomeMessage,
        defaultLocationType: updated.defaultLocationType,
        zoomMeetingUrl: updated.zoomMeetingUrl,
        teamsMeetingUrl: updated.teamsMeetingUrl || "",
        bufferMins: updated.bufferMins,
        minNoticeHours: updated.minNoticeHours,
        maxBookingDays: updated.maxBookingDays,
        onboardedAt: updated.onboardedAt,
        hasGoogleCalendar: Boolean(updated.googleAccessToken || updated.googleRefreshToken),
      },
    });
  } catch (err) {
    console.error("Error updating user profile:", err);
    return NextResponse.json({ error: "Failed to update profile" }, { status: 500 });
  }
}
