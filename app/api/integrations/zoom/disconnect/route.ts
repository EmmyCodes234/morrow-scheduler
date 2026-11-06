import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db, users } from "@/db";
import { eq } from "drizzle-orm";

export async function POST(req: NextRequest) {
  try {
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

    await db
      .update(users)
      .set({
        zoomAccessToken: null,
        zoomRefreshToken: null,
        zoomTokenExpiry: null,
        zoomEmail: null,
        zoomConnectedAt: null,
        defaultLocationType: "google_meet",
        updatedAt: new Date(),
      })
      .where(eq(users.id, host.id));

    return NextResponse.json({ success: true, message: "Zoom disconnected successfully" });
  } catch (err) {
    console.error("[Zoom Disconnect API] Error:", err);
    return NextResponse.json({ error: "Failed to disconnect Zoom" }, { status: 500 });
  }
}
