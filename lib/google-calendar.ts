// eslint-disable-next-line @typescript-eslint/no-require-imports
const { google } = require("googleapis");

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/api/auth/callback/google`
);

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

export async function fetchGoogleBusyBlocks(
  tokens: { accessToken?: string | null; refreshToken?: string | null },
  timeMin: Date,
  timeMax: Date
): Promise<FreeBusyBlock[]> {
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
    return busy.map((b: any) => ({
      start: b.start || "",
      end: b.end || "",
    }));
  } catch (err) {
    console.error("Error querying Google Calendar FreeBusy:", err);
    return [];
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
}

export async function createGoogleMeetEvent({
  tokens,
  summary,
  description,
  startTime,
  endTime,
  guestEmail,
  guestName,
  timeZone = "UTC",
}: CreateEventParams): Promise<{ eventId?: string; meetLink?: string }> {
  try {
    const calendar = getCalendarClient(tokens);
    const requestId = `morrow-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    const event = await calendar.events.insert({
      calendarId: "primary",
      conferenceDataVersion: 1,
      sendUpdates: "all",
      requestBody: {
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
        conferenceData: {
          createRequest: {
            requestId,
            conferenceSolutionKey: {
              type: "hangoutsMeet",
            },
          },
        },
      },
    });

    const meetLink =
      event.data.hangoutLink ||
      event.data.conferenceData?.entryPoints?.find((ep: any) => ep.entryPointType === "video")?.uri ||
      undefined;

    return {
      eventId: event.data.id || undefined,
      meetLink,
    };
  } catch (err) {
    console.error("Failed to create Google Calendar event with Meet:", err);
    return {};
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
  } catch (err) {
    console.error("Failed to cancel Google Calendar event:", err);
    return false;
  }
}
