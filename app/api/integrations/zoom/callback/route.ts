import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db, users } from "@/db";
import { eq } from "drizzle-orm";
import { exchangeZoomCode, getZoomUserProfile } from "@/lib/integrations/zoom";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const error = searchParams.get("error");
  const state = searchParams.get("state");

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  if (error || !code) {
    console.warn("[Zoom OAuth Callback] Error or missing code:", error);
    return NextResponse.redirect(`${baseUrl}/dashboard?tab=integrations&zoomError=${error || "missing_code"}`);
  }

  try {
    const session = await auth();
    let host = null;

    if (session?.user?.email) {
      host = await db.query.users.findFirst({
        where: eq(users.email, session.user.email),
      });
    } else if (state) {
      // Fallback via state param
      host = await db.query.users.findFirst({
        where: eq(users.id, state),
      });
    }

    if (!host) {
      return NextResponse.redirect(`${baseUrl}/login`);
    }

    const tokenData = await exchangeZoomCode(code);
    if (!tokenData) {
      return NextResponse.redirect(`${baseUrl}/dashboard?tab=integrations&zoomError=token_exchange_failed`);
    }

    const profile = await getZoomUserProfile(tokenData.accessToken);
    const expiry = new Date(Date.now() + tokenData.expiresIn * 1000);

    // Save tokens and connect Zoom
    await db
      .update(users)
      .set({
        zoomAccessToken: tokenData.accessToken,
        zoomRefreshToken: tokenData.refreshToken,
        zoomTokenExpiry: expiry,
        zoomEmail: profile?.email || null,
        zoomConnectedAt: new Date(),
        defaultLocationType: "zoom",
        updatedAt: new Date(),
      })
      .where(eq(users.id, host.id));

    return NextResponse.redirect(`${baseUrl}/dashboard?tab=integrations&zoom=connected`);
  } catch (err) {
    console.error("[Zoom OAuth Callback] Unexpected error:", err);
    return NextResponse.redirect(`${baseUrl}/dashboard?tab=integrations&zoomError=callback_exception`);
  }
}
