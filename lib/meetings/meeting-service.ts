import crypto from "crypto";
import { db as defaultDb } from "@/db";
import { meetings, meetingAttendees, users, rooms } from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { getOrCreateRoomForMeeting, type RoomDb } from "@/lib/room/room-service";
import type { VeraAgendaItem } from "@/lib/intelligence/vera";

export type MeetingDb = typeof defaultDb;

export function hashInvitationToken(token: string): string {
  return crypto.createHash("sha256").update(token.trim()).digest("hex");
}

export interface CreateMeetingInput {
  title: string;
  startTime: Date | string;
  endTime: Date | string;
  timezone?: string;
  description?: string | null;
  preparationMaterial?: string | null;
  agenda?: VeraAgendaItem[];
}

export interface RegisteredAttendeeResult {
  id: string;
  meetingId: string;
  name: string;
  email: string;
  status: "registered" | "joined" | "declined";
  sessionToken: string;
  joinedAt?: string | null;
  createdAt: string;
}

/**
 * Creates a first-class group meeting and idempotently provisions its dedicated room.
 */
export async function createMeeting(
  hostId: string,
  input: CreateMeetingInput,
  dbClient: MeetingDb = defaultDb
) {
  if (!hostId || typeof hostId !== "string") {
    throw new Error("A valid host ID is required to create a meeting.");
  }

  const title = input.title?.trim();
  if (!title) {
    throw new Error("Meeting title is required.");
  }

  const host = await dbClient.query.users.findFirst({
    where: eq(users.id, hostId),
  });

  if (!host) {
    throw new Error(`Host user with ID "${hostId}" not found.`);
  }

  const startTime = new Date(input.startTime);
  const endTime = new Date(input.endTime);

  if (isNaN(startTime.getTime()) || isNaN(endTime.getTime())) {
    throw new Error("Invalid start or end time format.");
  }

  if (endTime <= startTime) {
    throw new Error("Meeting end time must be after start time.");
  }

  const timezone = input.timezone?.trim() || host.timezone || "UTC";
  const rawInvitationToken = crypto.randomBytes(24).toString("hex");
  const invitationTokenHash = hashInvitationToken(rawInvitationToken);

  const [newMeeting] = await dbClient
    .insert(meetings)
    .values({
      hostId,
      title,
      description: input.description?.trim() || null,
      startTime,
      endTime,
      timezone,
      status: "scheduled",
      invitationToken: rawInvitationToken,
      invitationTokenHash,
      preparationMaterial: input.preparationMaterial?.trim() || null,
      agenda: input.agenda || [],
    })
    .returning();

  if (!newMeeting) {
    throw new Error("Failed to persist meeting record.");
  }

  // Idempotently provision the persistent Morrow Room for this meeting
  const room = await getOrCreateRoomForMeeting(newMeeting.id, dbClient);

  return {
    meeting: newMeeting,
    room,
    invitationToken: rawInvitationToken,
    invitationUrl: `/j/${rawInvitationToken}`,
  };
}

/**
 * Looks up a meeting by raw invitation token (verifying against stored hash or token).
 */
export async function getMeetingByInvitationToken(
  rawToken: string,
  dbClient: MeetingDb = defaultDb
) {
  if (!rawToken || typeof rawToken !== "string") return null;

  const trimmed = rawToken.trim();
  const tokenHash = hashInvitationToken(trimmed);

  const meeting = await dbClient.query.meetings.findFirst({
    where: eq(meetings.invitationTokenHash, tokenHash),
    with: {
      host: true,
      room: true,
      attendees: true,
    },
  });

  if (meeting) return meeting;

  // Fallback to direct raw token query
  return await dbClient.query.meetings.findFirst({
    where: eq(meetings.invitationToken, trimmed),
    with: {
      host: true,
      room: true,
      attendees: true,
    },
  });
}

/**
 * Retrieves a meeting by ID, optionally verifying host ownership.
 */
export async function getMeetingById(
  id: string,
  hostId?: string,
  dbClient: MeetingDb = defaultDb
) {
  if (!id) return null;

  const meeting = await dbClient.query.meetings.findFirst({
    where: eq(meetings.id, id),
    with: {
      host: true,
      room: true,
      attendees: {
        orderBy: desc(meetingAttendees.createdAt),
      },
    },
  });

  if (!meeting) return null;
  if (hostId && meeting.hostId !== hostId) {
    return null;
  }

  return meeting;
}

/**
 * Lists all meetings created by a host.
 */
export async function listHostMeetings(
  hostId: string,
  dbClient: MeetingDb = defaultDb
) {
  if (!hostId) return [];

  return await dbClient.query.meetings.findMany({
    where: eq(meetings.hostId, hostId),
    with: {
      room: true,
      attendees: true,
    },
    orderBy: desc(meetings.startTime),
  });
}

/**
 * Registers an attendee for a group meeting.
 * Deduplicates by case-insensitive email address.
 * Generates an unforgeable sessionToken for cookie persistence.
 */
export async function registerMeetingAttendee(
  params: {
    invitationToken: string;
    name: string;
    email: string;
  },
  dbClient: MeetingDb = defaultDb
): Promise<{
  success: boolean;
  attendee?: RegisteredAttendeeResult;
  isExisting?: boolean;
  error?: string;
  meeting?: typeof meetings.$inferSelect;
  roomAccessToken?: string;
}> {
  const { invitationToken, name, email } = params;

  const trimmedName = name?.trim();
  const trimmedEmail = email?.trim();

  if (!trimmedName || trimmedName.length < 2) {
    return { success: false, error: "Please enter your full name (at least 2 characters)." };
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!trimmedEmail || !emailRegex.test(trimmedEmail)) {
    return { success: false, error: "Please enter a valid email address." };
  }

  const meeting = await getMeetingByInvitationToken(invitationToken, dbClient);
  if (!meeting) {
    return { success: false, error: "Meeting not found or invitation link is invalid." };
  }

  if (meeting.status === "cancelled") {
    return { success: false, error: "This meeting has been cancelled by the organiser." };
  }

  const emailNormalized = trimmedEmail.toLowerCase();

  // Deduplication check: case-insensitive email for this meeting
  const existingAttendee = await dbClient.query.meetingAttendees.findFirst({
    where: and(
      eq(meetingAttendees.meetingId, meeting.id),
      eq(meetingAttendees.emailNormalized, emailNormalized)
    ),
  });

  let room = meeting.room;
  if (!room) {
    room = await getOrCreateRoomForMeeting(meeting.id, dbClient);
  }

  if (existingAttendee) {
    // If the attendee re-registers, update their display name if different
    if (existingAttendee.name !== trimmedName) {
      const [updated] = await dbClient
        .update(meetingAttendees)
        .set({
          name: trimmedName,
          updatedAt: new Date(),
        })
        .where(eq(meetingAttendees.id, existingAttendee.id))
        .returning();

      return {
        success: true,
        attendee: {
          id: updated.id,
          meetingId: updated.meetingId,
          name: updated.name,
          email: updated.email,
          status: updated.status as "registered" | "joined" | "declined",
          sessionToken: updated.sessionToken,
          joinedAt: updated.joinedAt?.toISOString() || null,
          createdAt: updated.createdAt.toISOString(),
        },
        isExisting: true,
        meeting,
        roomAccessToken: room.accessToken,
      };
    }

    return {
      success: true,
      attendee: {
        id: existingAttendee.id,
        meetingId: existingAttendee.meetingId,
        name: existingAttendee.name,
        email: existingAttendee.email,
        status: existingAttendee.status as "registered" | "joined" | "declined",
        sessionToken: existingAttendee.sessionToken,
        joinedAt: existingAttendee.joinedAt?.toISOString() || null,
        createdAt: existingAttendee.createdAt.toISOString(),
      },
      isExisting: true,
      meeting,
      roomAccessToken: room.accessToken,
    };
  }

  // Create new attendee record
  const sessionToken = crypto.randomBytes(32).toString("hex");

  const [newAttendee] = await dbClient
    .insert(meetingAttendees)
    .values({
      meetingId: meeting.id,
      name: trimmedName,
      email: trimmedEmail,
      emailNormalized,
      status: "registered",
      sessionToken,
    })
    .returning();

  return {
    success: true,
    attendee: {
      id: newAttendee.id,
      meetingId: newAttendee.meetingId,
      name: newAttendee.name,
      email: newAttendee.email,
      status: newAttendee.status as "registered" | "joined" | "declined",
      sessionToken: newAttendee.sessionToken,
      joinedAt: newAttendee.joinedAt?.toISOString() || null,
      createdAt: newAttendee.createdAt.toISOString(),
    },
    isExisting: false,
    meeting,
    roomAccessToken: room.accessToken,
  };
}

/**
 * Retrieves an attendee by session token.
 */
export async function getAttendeeBySessionToken(
  sessionToken: string,
  meetingId?: string,
  dbClient: MeetingDb = defaultDb
) {
  if (!sessionToken || typeof sessionToken !== "string") return null;

  const attendee = await dbClient.query.meetingAttendees.findFirst({
    where: eq(meetingAttendees.sessionToken, sessionToken.trim()),
    with: {
      meeting: {
        with: {
          host: true,
          room: true,
        },
      },
    },
  });

  if (!attendee) return null;
  if (meetingId && attendee.meetingId !== meetingId) {
    return null;
  }

  return attendee;
}

/**
 * Updates an attendee's status (e.g. marked as "joined" upon entering LiveKit room).
 */
export async function markAttendeeJoined(
  attendeeId: string,
  dbClient: MeetingDb = defaultDb
) {
  const [updated] = await dbClient
    .update(meetingAttendees)
    .set({
      status: "joined",
      joinedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(meetingAttendees.id, attendeeId))
    .returning();

  return updated;
}

/**
 * Updates meeting details by authenticated host.
 */
export async function updateMeeting(
  meetingId: string,
  hostId: string,
  updates: Partial<CreateMeetingInput>,
  dbClient: MeetingDb = defaultDb
) {
  const existing = await dbClient.query.meetings.findFirst({
    where: eq(meetings.id, meetingId),
  });

  if (!existing || existing.hostId !== hostId) {
    throw new Error("Meeting not found or unauthorized.");
  }

  const patch: Record<string, unknown> = {
    updatedAt: new Date(),
  };

  if (updates.title) patch.title = updates.title.trim();
  if (updates.description !== undefined) patch.description = updates.description?.trim() || null;
  if (updates.startTime) patch.startTime = new Date(updates.startTime);
  if (updates.endTime) patch.endTime = new Date(updates.endTime);
  if (updates.timezone) patch.timezone = updates.timezone.trim();
  if (updates.preparationMaterial !== undefined) patch.preparationMaterial = updates.preparationMaterial?.trim() || null;
  if (updates.agenda) patch.agenda = updates.agenda;

  const [updated] = await dbClient
    .update(meetings)
    .set(patch)
    .where(eq(meetings.id, meetingId))
    .returning();

  return updated;
}

/**
 * Cancels a meeting by authenticated host.
 */
export async function cancelMeeting(
  meetingId: string,
  hostId: string,
  dbClient: MeetingDb = defaultDb
) {
  const existing = await dbClient.query.meetings.findFirst({
    where: eq(meetings.id, meetingId),
  });

  if (!existing || existing.hostId !== hostId) {
    throw new Error("Meeting not found or unauthorized.");
  }

  const [cancelled] = await dbClient
    .update(meetings)
    .set({
      status: "cancelled",
      updatedAt: new Date(),
    })
    .where(eq(meetings.id, meetingId))
    .returning();

  return cancelled;
}

/**
 * Rotates the shareable invitation token for a meeting.
 */
export async function rotateMeetingInvitationToken(
  meetingId: string,
  hostId: string,
  dbClient: MeetingDb = defaultDb
) {
  const existing = await dbClient.query.meetings.findFirst({
    where: eq(meetings.id, meetingId),
  });

  if (!existing || existing.hostId !== hostId) {
    throw new Error("Meeting not found or unauthorized.");
  }

  const newInvitationToken = crypto.randomBytes(24).toString("hex");
  const newInvitationTokenHash = hashInvitationToken(newInvitationToken);

  const [updated] = await dbClient
    .update(meetings)
    .set({
      invitationToken: newInvitationToken,
      invitationTokenHash: newInvitationTokenHash,
      updatedAt: new Date(),
    })
    .where(eq(meetings.id, meetingId))
    .returning();

  return {
    meeting: updated,
    invitationToken: newInvitationToken,
    invitationUrl: `/j/${newInvitationToken}`,
  };
}

export const DEFAULT_EARLY_ACCESS_MINUTES = 15;

export interface MeetingCallAccessStatus {
  isOpen: boolean;
  opensAt: Date;
  scheduledStartTime: Date;
  scheduledEndTime: Date;
  timezone: string;
  earlyAccessOpened: boolean;
  reason:
    | "early_access_opened"
    | "early_window"
    | "scheduled_time"
    | "call_not_open_yet"
    | "meeting_cancelled"
    | "meeting_concluded";
}

/**
 * Authoritatively evaluates whether a meeting's LiveKit call is open for participant entry.
 * Policy:
 * 1. Cancelled or concluded meetings are never open.
 * 2. If host opened the room early (openedEarlyAt is set), call is open immediately.
 * 3. Default early window: opens 15 minutes before scheduled start time.
 * 4. At/after scheduled start time, call is open automatically and allows late arrivals.
 * 5. Scheduled end time does not automatically terminate or deny access.
 */
export function isMeetingCallOpen(
  meeting: {
    status: string;
    startTime: Date | string;
    endTime: Date | string;
    timezone?: string;
    openedEarlyAt?: Date | string | null;
  },
  now = new Date()
): MeetingCallAccessStatus {
  const scheduledStartTime = new Date(meeting.startTime);
  const scheduledEndTime = new Date(meeting.endTime);
  const timezone = meeting.timezone || "UTC";

  if (meeting.status === "cancelled") {
    return {
      isOpen: false,
      opensAt: scheduledStartTime,
      scheduledStartTime,
      scheduledEndTime,
      timezone,
      earlyAccessOpened: false,
      reason: "meeting_cancelled",
    };
  }

  if (meeting.status === "concluded") {
    return {
      isOpen: false,
      opensAt: scheduledStartTime,
      scheduledStartTime,
      scheduledEndTime,
      timezone,
      earlyAccessOpened: false,
      reason: "meeting_concluded",
    };
  }

  if (meeting.openedEarlyAt) {
    const openedEarlyDate = new Date(meeting.openedEarlyAt);
    return {
      isOpen: true,
      opensAt: openedEarlyDate,
      scheduledStartTime,
      scheduledEndTime,
      timezone,
      earlyAccessOpened: true,
      reason: "early_access_opened",
    };
  }

  const defaultEarlyWindowMs = DEFAULT_EARLY_ACCESS_MINUTES * 60 * 1000;
  const earlyAccessOpensAt = new Date(scheduledStartTime.getTime() - defaultEarlyWindowMs);

  const nowMs = now.getTime();
  if (nowMs >= scheduledStartTime.getTime()) {
    return {
      isOpen: true,
      opensAt: earlyAccessOpensAt,
      scheduledStartTime,
      scheduledEndTime,
      timezone,
      earlyAccessOpened: false,
      reason: "scheduled_time",
    };
  }

  if (nowMs >= earlyAccessOpensAt.getTime()) {
    return {
      isOpen: true,
      opensAt: earlyAccessOpensAt,
      scheduledStartTime,
      scheduledEndTime,
      timezone,
      earlyAccessOpened: false,
      reason: "early_window",
    };
  }

  return {
    isOpen: false,
    opensAt: earlyAccessOpensAt,
    scheduledStartTime,
    scheduledEndTime,
    timezone,
    earlyAccessOpened: false,
    reason: "call_not_open_yet",
  };
}

/**
 * Organiser-controlled early room opening.
 * Persists the early open timestamp on the meeting.
 */
export async function openMeetingEarly(
  meetingId: string,
  hostId: string,
  openedAt = new Date(),
  dbClient: MeetingDb = defaultDb
) {
  const existing = await dbClient.query.meetings.findFirst({
    where: eq(meetings.id, meetingId),
  });

  if (!existing || existing.hostId !== hostId) {
    throw new Error("Meeting not found or unauthorized.");
  }

  if (existing.status === "cancelled" || existing.status === "concluded") {
    throw new Error(`Cannot open early: meeting is already ${existing.status}.`);
  }

  const [updated] = await dbClient
    .update(meetings)
    .set({
      openedEarlyAt: openedAt,
      updatedAt: new Date(),
    })
    .where(eq(meetings.id, meetingId))
    .returning();

  return updated;
}


/**
 * Sends a registration confirmation email to an attendee via Resend.
 * Records the outcome truthfully.
 */
export async function sendAttendeeConfirmationEmail(params: {
  toEmail: string;
  attendeeName: string;
  hostName: string;
  meetingTitle: string;
  startTime: Date | string;
  timezone: string;
  roomAccessToken: string;
  invitationToken: string;
  origin?: string;
}): Promise<{ sent: boolean; reason?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || apiKey.includes("re_...") || !apiKey.startsWith("re_")) {
    console.log(
      `[Email] Resend API key unconfigured. Registration confirmation skipped for ${params.toEmail}`
    );
    return { sent: false, reason: "RESEND_API_KEY_UNCONFIGURED" };
  }

  const baseUrl = params.origin || process.env.NEXTAUTH_URL || "https://usemorrow.xyz";
  const roomUrl = `${baseUrl}/room/${params.roomAccessToken}`;
  const lobbyUrl = `${baseUrl}/j/${params.invitationToken}`;

  const formattedDate = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: params.timezone || "UTC",
    timeZoneName: "short",
  }).format(new Date(params.startTime));

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Meeting Registration Confirmed</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f7f9fa; color: #1a1a1a; margin: 0; padding: 24px; }
    .card { max-width: 540px; margin: 0 auto; background: #ffffff; border-radius: 16px; border: 1px solid #e5e7eb; padding: 32px; }
    .badge { display: inline-block; padding: 4px 10px; background: #eff6ff; color: #2563eb; font-size: 12px; font-weight: 600; border-radius: 9999px; text-transform: uppercase; margin-bottom: 16px; }
    h1 { font-size: 22px; margin-top: 0; margin-bottom: 8px; color: #0f172a; }
    p { font-size: 15px; line-height: 1.5; color: #475569; margin: 12px 0; }
    .meta-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; margin: 20px 0; }
    .meta-row { display: flex; margin-bottom: 8px; font-size: 14px; }
    .meta-label { color: #64748b; width: 100px; font-weight: 500; }
    .meta-value { color: #0f172a; font-weight: 600; flex: 1; }
    .btn { display: inline-block; padding: 12px 24px; background: #0f172a; color: #ffffff; text-decoration: none; border-radius: 10px; font-weight: 600; font-size: 15px; text-align: center; margin-top: 12px; }
    .footer { font-size: 12px; color: #94a3b8; margin-top: 24px; text-align: center; }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">Registration Confirmed</div>
    <h1>You are registered for ${params.meetingTitle}</h1>
    <p>Hello ${params.attendeeName},</p>
    <p>Your registration for the upcoming meeting organised by <strong>${params.hostName}</strong> has been confirmed.</p>
    
    <div class="meta-box">
      <div class="meta-row">
        <span class="meta-label">Meeting:</span>
        <span class="meta-value">${params.meetingTitle}</span>
      </div>
      <div class="meta-row">
        <span class="meta-label">Date & Time:</span>
        <span class="meta-value">${formattedDate}</span>
      </div>
      <div class="meta-row">
        <span class="meta-label">Organiser:</span>
        <span class="meta-value">${params.hostName}</span>
      </div>
    </div>

    <p>You can access meeting preparation notes, agenda, and previous minutes in the meeting lobby ahead of time.</p>

    <div style="text-align: center; margin: 24px 0;">
      <a href="${roomUrl}" class="btn" style="color: #ffffff;">Enter Morrow Room</a>
    </div>

    <p style="font-size: 13px; text-align: center; color: #64748b;">
      Or view meeting preparation: <a href="${lobbyUrl}" style="color: #2563eb;">Open Meeting Lobby</a>
    </p>

    <div class="footer">
      Morrow — Intelligent, private meeting rooms.
    </div>
  </div>
</body>
</html>
  `;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Morrow <notifications@usemorrow.xyz>",
        to: [params.toEmail],
        subject: `Confirmed: ${params.meetingTitle} with ${params.hostName}`,
        html,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.warn(`[Email] Resend dispatch error (${res.status}): ${errText}`);
      return { sent: false, reason: `RESEND_ERROR_${res.status}` };
    }

    return { sent: true };
  } catch (err) {
    console.error("[Email] Resend network error:", err);
    return { sent: false, reason: "RESEND_NETWORK_ERROR" };
  }
}
