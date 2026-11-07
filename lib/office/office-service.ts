import { db } from "@/db";
import { users, officeKnocks } from "@/db/schema";
import { eq, and, asc } from "drizzle-orm";
import { createGoogleCalendarEvent, generateGcalEventId } from "@/lib/google-calendar";

export interface HostOfficeScheduleConfig {
  officeStatus?: string;
  officeAutoSchedule?: boolean;
  officeScheduleDays?: number[] | null;
  officeScheduleStart?: string | null;
  officeScheduleEnd?: string | null;
  timezone?: string | null;
}

const DAY_MAP: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/**
 * Evaluates whether the host is currently in an active scheduled office hours window.
 */
export function isHostWithinOfficeSchedule(
  host: HostOfficeScheduleConfig,
  now: Date = new Date()
): {
  inSchedule: boolean;
  effectiveStatus: "open" | "busy" | "closed";
} {
  // If host is explicitly set to "busy" (e.g. In Meeting), that takes priority
  if (host.officeStatus === "busy") {
    return { inSchedule: false, effectiveStatus: "busy" };
  }

  // If auto-schedule is disabled, respect the manual status directly
  if (!host.officeAutoSchedule) {
    const status = (host.officeStatus as "open" | "busy" | "closed") || "closed";
    return { inSchedule: status === "open", effectiveStatus: status };
  }

  const timezone = host.timezone || "UTC";

  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      hourCycle: "h23",
    });

    const parts = formatter.formatToParts(now);
    const weekdayStr = parts.find((p) => p.type === "weekday")?.value || "Sun";
    const hourStr = parts.find((p) => p.type === "hour")?.value || "0";
    const minStr = parts.find((p) => p.type === "minute")?.value || "0";

    const dayOfWeek = DAY_MAP[weekdayStr] ?? 0;

    const activeDays = Array.isArray(host.officeScheduleDays)
      ? host.officeScheduleDays
      : [1, 2, 3, 4, 5];

    if (!activeDays.includes(dayOfWeek)) {
      return { inSchedule: false, effectiveStatus: "closed" };
    }

    const currentMins = parseInt(hourStr, 10) * 60 + parseInt(minStr, 10);

    const [startH, startM] = (host.officeScheduleStart || "14:00").split(":").map(Number);
    const [endH, endM] = (host.officeScheduleEnd || "16:00").split(":").map(Number);

    const startMins = (startH || 14) * 60 + (startM || 0);
    const endMins = (endH || 16) * 60 + (endM || 0);

    const inSchedule = currentMins >= startMins && currentMins < endMins;

    return {
      inSchedule,
      effectiveStatus: inSchedule ? "open" : "closed",
    };
  } catch (err) {
    console.error("[Office Schedule] Error evaluating schedule window:", err);
    return { inSchedule: false, effectiveStatus: (host.officeStatus as "open" | "busy" | "closed") || "closed" };
  }
}

/**
 * Creates an event on the host's Google Calendar to reserve the speed-chat window.
 */
export async function createOfficeHoursCalendarEvent(params: {
  host: {
    id: string;
    email: string;
    name: string;
    timezone?: string | null;
    googleAccessToken?: string | null;
    googleRefreshToken?: string | null;
  };
  knock: {
    id: string;
    guestName: string;
    guestEmail: string;
    topic: string;
    meetLink?: string | null;
  };
  speedChatMins: number;
}): Promise<string | null> {
  const { host, knock, speedChatMins } = params;

  if (!host.googleAccessToken && !host.googleRefreshToken) {
    return null;
  }

  const startTime = new Date();
  const endTime = new Date(startTime.getTime() + speedChatMins * 60 * 1000);
  const eventId = generateGcalEventId(`office_${knock.id}`);

  try {
    const result = await createGoogleCalendarEvent({
      tokens: {
        accessToken: host.googleAccessToken,
        refreshToken: host.googleRefreshToken,
      },
      summary: `Office Hours: ${knock.guestName}`,
      description: `Visitor: ${knock.guestName} (${knock.guestEmail})\nTopic: "${knock.topic}"\n\nDrop-in speed chat via Morrow Virtual Office.\nMeeting room: ${knock.meetLink || "Google Meet"}`,
      startTime,
      endTime,
      guestEmail: knock.guestEmail,
      guestName: knock.guestName,
      bookingId: `office_${knock.id}`,
      timeZone: host.timezone || "UTC",
      locationType: "google_meet",
      eventId,
    });

    if (result.success && result.eventId) {
      await db
        .update(officeKnocks)
        .set({
          googleCalendarEventId: result.eventId,
          updatedAt: new Date(),
        })
        .where(eq(officeKnocks.id, knock.id));

      return result.eventId;
    }
  } catch (err) {
    console.error("[Office Hours] Failed to create Google Calendar event hold:", err);
  }

  return null;
}

/**
 * Promotes the next queued visitor to ringing when an active chat concludes.
 */
export async function promoteNextQueuedKnock(hostId: string): Promise<typeof officeKnocks.$inferSelect | null> {
  try {
    const nextKnock = await db.query.officeKnocks.findFirst({
      where: and(
        eq(officeKnocks.hostId, hostId),
        eq(officeKnocks.status, "queued")
      ),
      orderBy: [asc(officeKnocks.createdAt)],
    });

    if (!nextKnock) return null;

    const [promoted] = await db
      .update(officeKnocks)
      .set({
        status: "ringing",
        createdAt: new Date(), // Reset 60s active ringing timer
        updatedAt: new Date(),
      })
      .where(eq(officeKnocks.id, nextKnock.id))
      .returning();

    return promoted;
  } catch (err) {
    console.error("[Office Queue] Error promoting next queued knock:", err);
    return null;
  }
}
