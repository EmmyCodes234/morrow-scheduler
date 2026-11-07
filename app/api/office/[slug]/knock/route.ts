import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users, officeKnocks } from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { sendDoorbellKnockEmail } from "@/lib/email";

const EMAIL_REGEX =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const body = await req.json();

    const guestName = typeof body.guestName === "string" ? body.guestName.trim() : "";
    const guestEmail = typeof body.guestEmail === "string" ? body.guestEmail.trim().toLowerCase() : "";
    const guestAvatarUrl = typeof body.guestAvatarUrl === "string" ? body.guestAvatarUrl.trim() : null;
    const topic = typeof body.topic === "string" ? body.topic.trim() : "";

    if (!guestName || guestName.length === 0) {
      return NextResponse.json({ error: "Your name is required." }, { status: 400 });
    }
    if (!guestEmail || !EMAIL_REGEX.test(guestEmail)) {
      return NextResponse.json({ error: "A valid email address is required." }, { status: 400 });
    }
    if (!topic || topic.length === 0) {
      return NextResponse.json({ error: "Please enter what you'd like to discuss." }, { status: 400 });
    }
    if (topic.length > 140) {
      return NextResponse.json({ error: "Topic cannot exceed 140 characters." }, { status: 400 });
    }

    const host = await db.query.users.findFirst({
      where: eq(users.slug, slug),
    });

    if (!host) {
      return NextResponse.json({ error: "Host not found" }, { status: 404 });
    }

    if (host.officeStatus === "closed") {
      return NextResponse.json(
        { error: "Office hours are currently closed. Please schedule a time on the calendar.", isClosed: true },
        { status: 400 }
      );
    }

    // Check if this guest already has an active ringing knock within the last 60 seconds
    const cutoff = new Date(Date.now() - 60000);
    const existingActiveKnock = await db.query.officeKnocks.findFirst({
      where: and(
        eq(officeKnocks.hostId, host.id),
        eq(officeKnocks.guestEmail, guestEmail),
        eq(officeKnocks.status, "ringing")
      ),
      orderBy: [desc(officeKnocks.createdAt)],
    });

    if (existingActiveKnock && new Date(existingActiveKnock.createdAt).getTime() > cutoff.getTime()) {
      return NextResponse.json({
        success: true,
        knock: {
          id: existingActiveKnock.id,
          status: existingActiveKnock.status,
          createdAt: existingActiveKnock.createdAt,
          expiresAt: new Date(new Date(existingActiveKnock.createdAt).getTime() + 60000).toISOString(),
        },
      });
    }

    // Create new knock
    const [created] = await db
      .insert(officeKnocks)
      .values({
        hostId: host.id,
        guestName,
        guestEmail,
        guestAvatarUrl,
        topic,
        status: "ringing",
      })
      .returning();

    // Fire instant email notification via Resend if enabled
    if (host.officeNotifyEmail !== false) {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://usemorrow.xyz";
      const admitUrl = `${appUrl}/dashboard?tab=office&admitKnock=${created.id}`;
      sendDoorbellKnockEmail({
        toEmail: host.email,
        guestName,
        guestEmail,
        topic,
        speedChatMins: host.officeSpeedChatMins || 10,
        admitUrl,
      }).catch((err) => console.error("[Doorbell Alert] Failed to dispatch knock email:", err));
    }

    return NextResponse.json({
      success: true,
      knock: {
        id: created.id,
        status: created.status,
        createdAt: created.createdAt,
        expiresAt: new Date(new Date(created.createdAt).getTime() + 60000).toISOString(),
      },
    }, { status: 201 });
  } catch (err) {
    console.error("Error creating office knock:", err);
    return NextResponse.json({ error: "Failed to knock on door" }, { status: 500 });
  }
}
