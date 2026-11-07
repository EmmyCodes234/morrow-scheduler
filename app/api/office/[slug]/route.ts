import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users, officeKnocks } from "@/db/schema";
import { eq, and, or, inArray, count } from "drizzle-orm";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;

    const host = await db.query.users.findFirst({
      where: eq(users.slug, slug),
    });

    if (!host) {
      return NextResponse.json({ error: "Host not found" }, { status: 404 });
    }

    // Count people currently in queue (ringing or admitted)
    const activeKnocks = await db
      .select({ count: count() })
      .from(officeKnocks)
      .where(
        and(
          eq(officeKnocks.hostId, host.id),
          inArray(officeKnocks.status, ["ringing", "admitted"])
        )
      );

    const queueLength = Number(activeKnocks[0]?.count) || 0;

    return NextResponse.json({
      host: {
        id: host.id,
        name: host.name,
        slug: host.slug,
        avatarUrl: host.avatarUrl,
        timezone: host.timezone,
        officeStatus: host.officeStatus || "closed",
        officeTopic: host.officeTopic || null,
        officeSpeedChatMins: host.officeSpeedChatMins || 10,
      },
      queueLength,
      isOpen: host.officeStatus === "open",
      isBusy: host.officeStatus === "busy",
      isClosed: host.officeStatus === "closed",
    });
  } catch (err) {
    console.error("Error fetching office status:", err);
    return NextResponse.json({ error: "Failed to load office" }, { status: 500 });
  }
}
