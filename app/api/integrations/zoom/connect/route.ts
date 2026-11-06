import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db, users } from "@/db";
import { eq } from "drizzle-orm";
import { getZoomAuthorizeUrl } from "@/lib/integrations/zoom";

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.redirect(new URL("/login", req.url));
    }

    const host = await db.query.users.findFirst({
      where: eq(users.email, session.user.email),
    });

    if (!host) {
      return NextResponse.redirect(new URL("/login", req.url));
    }

    const authUrl = getZoomAuthorizeUrl(host.id);
    if (!authUrl) {
      return NextResponse.json(
        { error: "Zoom OAuth credentials not configured on server" },
        { status: 500 }
      );
    }

    return NextResponse.redirect(authUrl);
  } catch (err) {
    console.error("[Zoom Connect Route] Error:", err);
    return NextResponse.redirect(
      new URL("/dashboard?tab=integrations&zoomError=connect_failed", req.url)
    );
  }
}
