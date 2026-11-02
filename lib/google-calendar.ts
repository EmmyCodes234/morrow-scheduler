import { google } from "googleapis";
import crypto from "crypto";

/**
 * Generates a stable, deterministic Google Calendar event ID derived from a Morrow booking ID.
 * Conforms to Google Calendar event ID requirements (RFC 4648 base32hex: lowercase letters [a-v] and digits [0-9],
 * length 5-1024 characters).
 * SHA-256 hexadecimal output uses strictly [0-9a-f] (length 64), which is fully compatible with base32hex.
 */
export function generateGcalEventId(bookingId: string): string {
  return crypto.createHash("sha256").update(`morrow_gcal_event_${bookingId}`).digest("hex");
}

/**
 * Generates a deterministic Google Meet conference creation requestId.
 * Google Meet conferenceData.createRequest.requestId requires base32hex (lowercase letters [a-v] and digits [0-9],
 * length 1-64 characters). No hyphens or uppercase characters allowed.
 */
export function generateGcalConferenceRequestId(bookingId: string): string {
  return crypto.createHash("sha256").update(`morrow_gcal_conf_${bookingId}`).digest("hex").slice(0, 32);
}

export function getCalendarClient(tokens: {
  accessToken?: string | null;
  refreshToken?: string | null;
}) {
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );

  auth.setCredentials({
    access_token: tokens.accessToken || undefined,
    refresh_token: tokens.refreshToken || undefined,
  });

  return google.calendar({ version: "v3", auth });
}

export interface FreeBusyBlock {
  start: string;
  end: string;
}

export interface FreeBusyResult {
  success: boolean;
  busy: FreeBusyBlock[];
  error?: string;
}

export async function fetchGoogleBusyBlocks(
  tokens: { accessToken?: string | null; refreshToken?: string | null },
  timeMin: Date,
  timeMax: Date
): Promise<FreeBusyResult> {
  try {
    const calendar = getCalendarClient(tokens);
    const response = await calendar.freebusy.query({
      requestBody: {
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        items: [{ id: "primary" }],
      },
    });

    const busy = response.data.calendars?.primary?.busy || [];
    return {
      success: true,
      busy: busy.map((b: { start?: string | null; end?: string | null }) => ({
        start: b.start || "",
        end: b.end || "",
      })),
    };
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error("Error querying Google Calendar FreeBusy:", errorMessage);
    return {
      success: false,
      busy: [],
      error: errorMessage,
    };
  }
}

export interface CreateEventParams {
  tokens: { accessToken?: string | null; refreshToken?: string | null };
  summary: string;
  description?: string;
  startTime: Date;
  endTime: Date;
  guestEmail: string;
  guestName: string;
  timeZone?: string;
  locationType?: string; // "google_meet" | "zoom" | "in_person" | "phone" | "custom"
  locationUrl?: string | null;
  eventId?: string; // Stable deterministic calendar event ID (RFC 4648 base32hex)
  requestId?: string; // Legacy parameter or fallback
  confRequestId?: string; // Google Meet conference creation requestId (base32hex, no hyphens)
}

export interface CreateEventResult {
  success: boolean;
  eventId?: string;
  meetLink?: string;
  location?: string;
  error?: string;
  isDuplicate?: boolean;
}

export async function createGoogleCalendarEvent({
  tokens,
  summary,
  description,
  startTime,
  endTime,
  guestEmail,
  guestName,
  timeZone = "UTC",
  locationType = "google_meet",
  locationUrl,
  eventId,
  requestId,
  confRequestId,
}: CreateEventParams): Promise<CreateEventResult> {
  try {
    const calendar = getCalendarClient(tokens);
    const resolvedConfRequestId =
      confRequestId ||
      (requestId && !requestId.includes("-") ? requestId : generateGcalConferenceRequestId(eventId || `${Date.now()}_${Math.random()}`));

    const isGoogleMeet = locationType === "google_meet";
    const resolvedLocation = isGoogleMeet ? undefined : locationUrl || undefined;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const requestBody: Record<string, any> = {
      summary,
      description,
      start: {
        dateTime: startTime.toISOString(),
        timeZone,
      },
      end: {
        dateTime: endTime.toISOString(),
        timeZone,
      },
      attendees: [{ email: guestEmail, displayName: guestName }],
    };

    if (eventId) {
      requestBody.id = eventId;
    }

    if (resolvedLocation) {
      requestBody.location = resolvedLocation;
    }

    if (isGoogleMeet) {
      requestBody.conferenceData = {
        createRequest: {
          requestId: resolvedConfRequestId,
          conferenceSolutionKey: {
            type: "hangoutsMeet",
          },
        },
      };
    }

    const event = await calendar.events.insert({
      calendarId: "primary",
      conferenceDataVersion: isGoogleMeet ? 1 : 0,
      sendUpdates: "all",
      requestBody,
    });

    let meetLink: string | undefined = undefined;
    if (isGoogleMeet) {
      meetLink =
        event.data.hangoutLink ||
        event.data.conferenceData?.entryPoints?.find(
          (ep: { entryPointType?: string | null; uri?: string | null }) => ep.entryPointType === "video"
        )?.uri ||
        undefined;
    } else {
      meetLink = locationUrl || undefined;
    }

    return {
      success: true,
      eventId: event.data.id || eventId || undefined,
      meetLink,
      location: resolvedLocation || meetLink,
    };
  } catch (err: unknown) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const errObj = err as any;
    const status = errObj.status || errObj.code || (errObj.response && errObj.response.status);
    const errorMessage = err instanceof Error ? err.message : String(err);
    const isDuplicate = status === 409 || errorMessage.toLowerCase().includes("identifier already exists");
    console.error("Failed to create Google Calendar event:", errorMessage);
    return {
      success: false,
      error: errorMessage,
      isDuplicate,
    };
  }
}

// Backward-compatible alias
export const createGoogleMeetEvent = createGoogleCalendarEvent;

export async function getGoogleCalendarEvent(
  tokens: { accessToken?: string | null; refreshToken?: string | null },
  eventId: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<{ success: boolean; event?: any; error?: string; notFound?: boolean }> {
  try {
    const calendar = getCalendarClient(tokens);
    const response = await calendar.events.get({
      calendarId: "primary",
      eventId,
    });
    return { success: true, event: response.data };
  } catch (err: unknown) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const errObj = err as any;
    const status = errObj.status || errObj.code || (errObj.response && errObj.response.status);
    const notFound = status === 404 || status === 410;
    const errorMessage = err instanceof Error ? err.message : String(err);
    return { success: false, error: errorMessage, notFound };
  }
}

export interface PatchEventTimeParams {
  tokens: { accessToken?: string | null; refreshToken?: string | null };
  eventId: string;
  startTime: Date;
  endTime: Date;
  timeZone?: string;
  summary?: string;
  description?: string;
}

export async function patchGoogleCalendarEventTime({
  tokens,
  eventId,
  startTime,
  endTime,
  timeZone = "UTC",
  summary,
  description,
}: PatchEventTimeParams): Promise<{ success: boolean; eventId?: string; meetLink?: string; error?: string }> {
  try {
    const calendar = getCalendarClient(tokens);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const requestBody: Record<string, any> = {
      start: {
        dateTime: startTime.toISOString(),
        timeZone,
      },
      end: {
        dateTime: endTime.toISOString(),
        timeZone,
      },
    };
    if (summary) requestBody.summary = summary;
    if (description) requestBody.description = description;

    const response = await calendar.events.patch({
      calendarId: "primary",
      eventId,
      sendUpdates: "all",
      requestBody,
    });

    const meetLink =
      response.data.hangoutLink ||
      response.data.conferenceData?.entryPoints?.find(
        (ep: { entryPointType?: string | null; uri?: string | null }) => ep.entryPointType === "video"
      )?.uri ||
      undefined;

    return {
      success: true,
      eventId: response.data.id || eventId,
      meetLink,
    };
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error("Failed to patch Google Calendar event time:", errorMessage);
    return {
      success: false,
      error: errorMessage,
    };
  }
}

export async function cancelGoogleCalendarEvent(
  tokens: { accessToken?: string | null; refreshToken?: string | null },
  eventId: string
): Promise<boolean> {
  try {
    const calendar = getCalendarClient(tokens);
    await calendar.events.delete({
      calendarId: "primary",
      eventId,
      sendUpdates: "all",
    });
    return true;
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error("Failed to cancel Google Calendar event:", errorMessage);
    return false;
  }
}
