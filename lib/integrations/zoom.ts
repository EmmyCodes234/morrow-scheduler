import { db, users } from "@/db";
import { eq } from "drizzle-orm";

const ZOOM_AUTH_ENDPOINT = "https://zoom.us/oauth/authorize";
const ZOOM_TOKEN_ENDPOINT = "https://zoom.us/oauth/token";
const ZOOM_API_BASE = "https://api.zoom.us/v2";

export function getZoomCredentials() {
  const clientId = process.env.ZOOM_CLIENT_ID;
  const clientSecret = process.env.ZOOM_CLIENT_SECRET;
  const redirectUri =
    process.env.ZOOM_REDIRECT_URI ||
    `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/api/integrations/zoom/callback`;

  if (!clientId || !clientSecret) {
    return null;
  }

  return { clientId, clientSecret, redirectUri };
}

/**
 * Build the Zoom OAuth Authorization URL for a host.
 */
export function getZoomAuthorizeUrl(state?: string): string | null {
  const creds = getZoomCredentials();
  if (!creds) return null;

  const params = new URLSearchParams({
    response_type: "code",
    client_id: creds.clientId,
    redirect_uri: creds.redirectUri,
  });

  if (state) {
    params.set("state", state);
  }

  return `${ZOOM_AUTH_ENDPOINT}?${params.toString()}`;
}

/**
 * Exchange authorization code for Zoom access & refresh tokens.
 */
export async function exchangeZoomCode(code: string): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  scope?: string;
} | null> {
  const creds = getZoomCredentials();
  if (!creds) return null;

  const basicAuth = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString("base64");

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: creds.redirectUri,
  });

  const res = await fetch(ZOOM_TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => "");
    console.error(`[Zoom OAuth] Token exchange error (${res.status}):`, errorText);
    return null;
  }

  const data = await res.json();
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
    scope: data.scope,
  };
}

/**
 * Refresh an expired Zoom access token using the refresh token.
 */
export async function refreshZoomToken(refreshToken: string): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
} | null> {
  const creds = getZoomCredentials();
  if (!creds) return null;

  const basicAuth = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString("base64");

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  const res = await fetch(ZOOM_TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => "");
    console.error(`[Zoom OAuth] Token refresh error (${res.status}):`, errorText);
    return null;
  }

  const data = await res.json();
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
  };
}

/**
 * Fetch basic user profile info from Zoom API to identify account.
 */
export async function getZoomUserProfile(accessToken: string): Promise<{
  email: string;
  pmi?: number;
  vanityUrl?: string;
} | null> {
  try {
    const res = await fetch(`${ZOOM_API_BASE}/users/me`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!res.ok) return null;
    const data = await res.json();
    return {
      email: data.email,
      pmi: data.pmi,
      vanityUrl: data.vanity_url,
    };
  } catch (err) {
    console.error("[Zoom API] Error fetching user profile:", err);
    return null;
  }
}

/**
 * Ensure user has a valid Zoom access token, refreshing if necessary.
 */
async function getValidZoomToken(user: typeof users.$inferSelect): Promise<string | null> {
  if (!user.zoomAccessToken) return null;

  const now = new Date();
  const bufferMs = 5 * 60 * 1000; // 5 min safety buffer
  const isExpired = user.zoomTokenExpiry
    ? new Date(user.zoomTokenExpiry).getTime() - bufferMs < now.getTime()
    : false;

  if (!isExpired) {
    return user.zoomAccessToken;
  }

  if (!user.zoomRefreshToken) {
    return null;
  }

  const refreshed = await refreshZoomToken(user.zoomRefreshToken);
  if (!refreshed) {
    return null;
  }

  const newExpiry = new Date(Date.now() + refreshed.expiresIn * 1000);

  await db
    .update(users)
    .set({
      zoomAccessToken: refreshed.accessToken,
      zoomRefreshToken: refreshed.refreshToken,
      zoomTokenExpiry: newExpiry,
      updatedAt: new Date(),
    })
    .where(eq(users.id, user.id));

  return refreshed.accessToken;
}

/**
 * Create a dedicated, unique Zoom meeting for a booking.
 * Gracefully falls back to personal meeting URL if OAuth is not active.
 */
export async function createDynamicZoomMeeting(
  userId: string,
  options: {
    topic: string;
    startTime: Date;
    durationMins: number;
    timezone?: string;
  }
): Promise<{
  joinUrl: string;
  startUrl?: string;
  meetingId?: string;
  password?: string;
  isDynamic: boolean;
}> {
  const host = await db.query.users.findFirst({
    where: eq(users.id, userId),
  });

  if (!host) {
    throw new Error("Host user not found for Zoom meeting creation");
  }

  // 1. Attempt dynamic OAuth meeting creation if host connected Zoom
  const accessToken = await getValidZoomToken(host);
  if (accessToken) {
    try {
      const res = await fetch(`${ZOOM_API_BASE}/users/me/meetings`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          topic: options.topic,
          type: 2, // Scheduled meeting
          start_time: options.startTime.toISOString(),
          duration: options.durationMins,
          timezone: options.timezone || "UTC",
          settings: {
            host_video: true,
            participant_video: true,
            join_before_host: false,
            waiting_room: true,
            mute_upon_entry: true,
          },
        }),
      });

      if (res.ok) {
        const data = await res.json();
        return {
          joinUrl: data.join_url,
          startUrl: data.start_url,
          meetingId: String(data.id),
          password: data.password,
          isDynamic: true,
        };
      } else {
        const errText = await res.text().catch(() => "");
        console.warn(`[Zoom API] Dynamic meeting creation failed (${res.status}): ${errText}`);
      }
    } catch (err) {
      console.error("[Zoom API] Error calling create meeting:", err);
    }
  }

  // 2. Resilient Fallback: Host's static Personal Meeting Link
  if (host.zoomMeetingUrl) {
    return {
      joinUrl: host.zoomMeetingUrl,
      isDynamic: false,
    };
  }

  throw new Error("No Zoom meeting link configured by host");
}
