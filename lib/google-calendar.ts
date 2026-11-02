import { google } from "googleapis";

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
  requestId?: string;
}

export interface CreateEventResult {
  success: boolean;
  eventId?: string;
  meetLink?: string;
  location?: string;
  error?: string;
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
  requestId,
}: CreateEventParams): Promise<CreateEventResult> {
  try {
    const calendar = getCalendarClient(tokens);
    const reqId = requestId || `morrow-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

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

    if (resolvedLocation) {
      requestBody.location = resolvedLocation;
    }

    if (isGoogleMeet) {
      requestBody.conferenceData = {
        createRequest: {
          requestId: reqId,
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
      eventId: event.data.id || undefined,
      meetLink,
      location: resolvedLocation || meetLink,
    };
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error("Failed to create Google Calendar event:", errorMessage);
    return {
      success: false,
      error: errorMessage,
    };
  }
}

// Backward-compatible alias
export const createGoogleMeetEvent = createGoogleCalendarEvent;

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
