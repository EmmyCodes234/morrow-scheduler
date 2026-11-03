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
  bookingId?: string; // Private booking metadata identifier
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
  bookingId,
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
      extendedProperties: {
        private: {
          morrowBookingId: bookingId || "",
          morrowApp: "morrow-scheduler",
        },
      },
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
  status?: string; // e.g. "confirmed" to restore a cancelled event
  bookingId?: string; // Private booking metadata identifier
}

export async function patchGoogleCalendarEventTime({
  tokens,
  eventId,
  startTime,
  endTime,
  timeZone = "UTC",
  summary,
  description,
  status,
  bookingId,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
}: PatchEventTimeParams): Promise<{ success: boolean; eventId?: string; meetLink?: string; error?: string; event?: any }> {
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
    if (status) requestBody.status = status;
    if (bookingId) {
      requestBody.extendedProperties = {
        private: {
          morrowBookingId: bookingId,
          morrowApp: "morrow-scheduler",
        },
      };
    }

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
      event: response.data,
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

export interface GoogleCalendarEventLike {
  id?: string | null;
  status?: string | null;
  attendees?: Array<{ email?: string | null }> | null;
  description?: string | null;
  summary?: string | null;
  extendedProperties?: {
    private?: Record<string, string | null | undefined> | null;
    shared?: Record<string, string | null | undefined> | null;
  } | null;
  [key: string]: unknown;
}

/**
 * Validates whether an existing Google Calendar event securely belongs to the specified booking.
 * 
 * Supported forms of evidence:
 * 1. Exact private extendedProperties match: morrowBookingId === booking.id
 * 2. Exact database mapping match: booking.gcalEventId === event.id
 * 3. Exact deterministic Calendar event ID derived from booking ID: event.id === generateGcalEventId(booking.id)
 * 4. Exact booking-ID description marker where legacy format can be reliably identified.
 * 
 * Explicitly rejected as proof of ownership:
 * - Guest email alone
 * - Generic "Scheduled via Morrow" phrase alone
 * - Generic meeting summary/title alone
 */
export function isGoogleEventMatchingBooking(
  event: GoogleCalendarEventLike | null | undefined,
  booking: { id: string; guestEmail?: string; gcalEventId?: string | null }
): boolean {
  if (!event || typeof event !== "object") return false;

  // 1. Exact private booking reference in extendedProperties (authoritative marker)
  const extProps = event.extendedProperties?.private;
  if (extProps && typeof extProps === "object") {
    if (extProps.morrowBookingId) {
      return extProps.morrowBookingId === booking.id;
    }
  }

  // 2. Exact legacy booking marker in description
  const description = typeof event.description === "string" ? event.description : "";
  const bookingIdMarkerMatch = description.match(/Booking (?:ID|Reference):\s*([a-zA-Z0-9-]+)/i);
  if (bookingIdMarkerMatch && bookingIdMarkerMatch[1]) {
    return bookingIdMarkerMatch[1] === booking.id;
  }

  // 3. Exact existing database mapping
  if (booking.gcalEventId && event.id === booking.gcalEventId) {
    return true;
  }

  // 4. Exact deterministic Calendar event ID derived from booking ID
  if (event.id === generateGcalEventId(booking.id)) {
    return true;
  }

  // 5. Explicit bracketed token match [morrow:<id>]
  if (
    description.includes(`[morrow:${booking.id}]`) ||
    (booking.id.length >= 8 && description.includes(booking.id))
  ) {
    return true;
  }

  // Explicitly reject guest email alone, "Scheduled via Morrow" alone, or generic title
  return false;
}

export interface CancelGoogleEventResult {
  success: boolean;
  alreadyRemoved?: boolean;
  error?: string;
}

export async function cancelGoogleCalendarEventWithDetails(
  tokens: { accessToken?: string | null; refreshToken?: string | null },
  eventId: string
): Promise<CancelGoogleEventResult> {
  try {
    const calendar = getCalendarClient(tokens);
    await calendar.events.delete({
      calendarId: "primary",
      eventId,
      sendUpdates: "all",
    });
    return { success: true };
  } catch (err: unknown) {
    const errObj = err as { code?: number | string; status?: number; message?: string };
    const statusCode = Number(errObj?.code || errObj?.status);
    const message = err instanceof Error ? err.message : String(err);

    // 404 = Not Found, 410 = Gone / Resource has been deleted
    if (
      statusCode === 404 ||
      statusCode === 410 ||
      /not found|resource has been deleted|gone/i.test(message)
    ) {
      console.log(`[Google Calendar] Event ${eventId} was already removed externally.`);
      return { success: true, alreadyRemoved: true };
    }

    console.error("Failed to cancel Google Calendar event:", message);
    return { success: false, error: message };
  }
}

export async function cancelGoogleCalendarEvent(
  tokens: { accessToken?: string | null; refreshToken?: string | null },
  eventId: string
): Promise<boolean> {
  const result = await cancelGoogleCalendarEventWithDetails(tokens, eventId);
  return result.success;
}
