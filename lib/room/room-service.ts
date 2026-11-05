import crypto from "crypto";
import { db as defaultDb } from "@/db";
import { rooms, bookings, eventTypes, users, meetings } from "@/db/schema";
import { eq, and, or, inArray, ne, lt, isNull } from "drizzle-orm";
import {
  generateVeraPreMeetingBrief,
  generateVeraLedger,
  VeraInsufficientEvidenceError,
  type VeraAgendaItem,
  type VeraLedger,
  type VeraSummaryClaim,
  type VeraDecision,
} from "@/lib/intelligence/vera";

export type RoomDb = typeof defaultDb;

export interface RoomParticipant {
  name: string;
  email?: string;
  role: "host" | "guest" | "scribe";
  avatarInitials: string;
}

export interface RoomFileItem {
  id: string;
  name: string;
  size: number;
  type: string;
  url?: string;
  dataUrl?: string;
  uploadedBy: string;
  uploadedAt: string;
}

export interface RoomDetails {
  id: string;
  accessToken: string;
  status: "pre_meeting" | "in_progress" | "concluded";
  synthesisStatus?: "idle" | "synthesizing" | "completed" | "failed" | "insufficient_evidence";
  type?: "booking" | "group_meeting";
  preparationMaterial?: string | null;
  meeting?: {
    id: string;
    status: string;
    title: string;
    description?: string | null;
    startTime: string;
    endTime: string;
    timezone: string;
    invitationToken: string;
    preparationMaterial?: string | null;
    openedEarlyAt?: string | null;
    host: {
      id: string;
      name: string;
      email?: string;
      slug: string;
      avatarUrl?: string | null;
      timezone: string;
    };
    attendees?: Array<{
      id: string;
      name: string;
      email?: string;
      status: "registered" | "joined" | "declined";
      joinedAt?: string | null;
    }>;
  };
  booking: {
    id: string;
    status: string;
    startTime: string;
    endTime: string;
    eventTitle: string;
    durationMins: number;
    host: {
      id: string;
      name: string;
      email?: string;
      slug: string;
      avatarUrl?: string | null;
      timezone: string;
    };
    guest: {
      name: string;
      email?: string;
      timezone: string;
      notes?: string | null;
    };
  };
  agenda: VeraAgendaItem[];
  sharedNotes: string;
  files: RoomFileItem[];
  veraBrief?: {
    intent?: string;
    talkingPoints?: string[];
    background?: string;
  } | null;
  veraLedger?: {
    executiveSummary?: Array<string | VeraSummaryClaim>;
    actionItems?: Array<{ id: string; task: string; assignee: string; priority: "high" | "medium" | "low"; done: boolean; deadline?: string; evidence?: string }>;
    keyDecisions?: Array<string | VeraDecision>;
    suggestedFollowUp?: string;
    reviewStatus?: "pending_host_review" | "approved";
    approvedAt?: string;
    approvedBy?: string;
  } | null;
}

/**
 * Creates or retrieves the associated Room for a booking.
 * Supports explicit database dependency injection for isolated testing.
 */
export async function getOrCreateRoomForBooking(
  bookingId: string,
  dbClient: RoomDb = defaultDb
): Promise<typeof rooms.$inferSelect> {
  const existing = await dbClient.query.rooms.findFirst({
    where: eq(rooms.bookingId, bookingId),
  });

  if (existing) {
    return existing;
  }

  // Load booking with host and eventType
  const booking = await dbClient.query.bookings.findFirst({
    where: eq(bookings.id, bookingId),
    with: {
      host: true,
      eventType: true,
    },
  });

  if (!booking) {
    throw new Error(`Booking ${bookingId} not found.`);
  }

  const accessToken = crypto.randomBytes(16).toString("hex");

  // Generate initial brief from Vera
  const veraBrief = await generateVeraPreMeetingBrief({
    eventTitle: booking.eventType?.title || "Meeting",
    hostName: booking.host?.name || "Host",
    guestName: booking.guestName,
    guestNotes: booking.guestNotes,
    customAnswers: booking.customAnswers,
  });

  try {
    const [newRoom] = await dbClient
      .insert(rooms)
      .values({
        bookingId: booking.id,
        accessToken,
        status: "pre_meeting",
        agenda: veraBrief.suggestedAgenda,
        sharedNotes: "",
        files: [],
        veraBrief: {
          intent: veraBrief.intent,
          talkingPoints: veraBrief.talkingPoints,
          background: veraBrief.background,
        },
        veraLedger: null,
      })
      .onConflictDoNothing({ target: rooms.bookingId })
      .returning();

    if (newRoom) {
      return newRoom;
    }
  } catch (err) {
    console.warn(`[RoomProvisioning] Conflict on insert for booking ${bookingId}:`, err);
  }

  const winningRoom = await dbClient.query.rooms.findFirst({
    where: eq(rooms.bookingId, bookingId),
  });

  if (!winningRoom) {
    throw new Error(`Failed to provision or retrieve room for booking ${bookingId}`);
  }

  return winningRoom;
}

/**
 * Creates or retrieves the associated Room for a group meeting.
 * Ensures provisioning idempotency via unique meetingId constraint.
 */
export async function getOrCreateRoomForMeeting(
  meetingId: string,
  dbClient: RoomDb = defaultDb
): Promise<typeof rooms.$inferSelect> {
  const existing = await dbClient.query.rooms.findFirst({
    where: eq(rooms.meetingId, meetingId),
  });

  if (existing) {
    return existing;
  }

  const meeting = await dbClient.query.meetings.findFirst({
    where: eq(meetings.id, meetingId),
    with: {
      host: true,
    },
  });

  if (!meeting) {
    throw new Error(`Meeting ${meetingId} not found.`);
  }

  const accessToken = crypto.randomBytes(16).toString("hex");

  const initialAgenda: VeraAgendaItem[] =
    meeting.agenda && Array.isArray(meeting.agenda) && meeting.agenda.length > 0
      ? (meeting.agenda as VeraAgendaItem[])
      : [
          { id: "1", text: "Welcome & Context", done: false, addedBy: "host" },
          { id: "2", text: "Discussion & Updates", done: false, addedBy: "host" },
          { id: "3", text: "Action Items & Next Steps", done: false, addedBy: "host" },
        ];

  try {
    const [newRoom] = await dbClient
      .insert(rooms)
      .values({
        bookingId: null,
        meetingId: meeting.id,
        accessToken,
        status: "pre_meeting",
        agenda: initialAgenda,
        sharedNotes: "",
        files: [],
        veraBrief: {
          intent: meeting.title,
          talkingPoints: [meeting.description || "Group discussion"].filter(Boolean),
          background: meeting.preparationMaterial || "",
        },
        veraLedger: null,
      })
      .onConflictDoNothing({ target: rooms.meetingId })
      .returning();

    if (newRoom) {
      return newRoom;
    }
  } catch (err) {
    console.warn(`[RoomProvisioning] Conflict on insert for meeting ${meetingId}:`, err);
  }

  const winningRoom = await dbClient.query.rooms.findFirst({
    where: eq(rooms.meetingId, meetingId),
  });

  if (!winningRoom) {
    throw new Error(`Failed to provision or retrieve room for meeting ${meetingId}`);
  }

  return winningRoom;
}

/**
 * Retrieves public room state using the secure room access token.
 * Supports explicit database dependency injection for isolated testing.
 */
export async function getRoomByAccessToken(
  token: string,
  dbClient: RoomDb = defaultDb
): Promise<RoomDetails | null> {
  if (!token || typeof token !== "string") return null;

  const room = await dbClient.query.rooms.findFirst({
    where: eq(rooms.accessToken, token.trim()),
    with: {
      booking: {
        with: {
          host: true,
          eventType: true,
        },
      },
      meeting: {
        with: {
          host: true,
          attendees: true,
        },
      },
    },
  });

  if (!room) return null;

  // 1. Handle Booking-based room
  if (room.booking && room.booking.host) {
    const b = room.booking;
    const h = b.host;
    const et = b.eventType;

    return {
      id: room.id,
      accessToken: room.accessToken,
      status: (room.status as "pre_meeting" | "in_progress" | "concluded") || "pre_meeting",
      synthesisStatus: (room.synthesisStatus as "idle" | "synthesizing" | "completed" | "failed" | "insufficient_evidence") || "idle",
      type: "booking",
      booking: {
        id: b.id,
        status: b.status,
        startTime: b.startTime.toISOString(),
        endTime: b.endTime.toISOString(),
        eventTitle: et?.title || "Strategy Call",
        durationMins: et?.durationMins || 30,
        host: {
          id: h.id,
          name: h.name,
          slug: h.slug,
          avatarUrl: h.avatarUrl,
          timezone: h.timezone || "UTC",
        },
        guest: {
          name: b.guestName,
          timezone: b.guestTimezone || "UTC",
          notes: b.guestNotes,
        },
      },
      agenda: room.agenda || [],
      sharedNotes: room.sharedNotes || "",
      files: (room.files as RoomFileItem[]) || [],
      veraBrief: room.veraBrief,
      veraLedger: room.veraLedger,
    };
  }

  // 2. Handle Group Meeting-based room
  if (room.meeting && room.meeting.host) {
    const m = room.meeting;
    const h = m.host;
    const durationMins = Math.max(
      15,
      Math.round((m.endTime.getTime() - m.startTime.getTime()) / (1000 * 60))
    );

    return {
      id: room.id,
      accessToken: room.accessToken,
      status: (room.status as "pre_meeting" | "in_progress" | "concluded") || "pre_meeting",
      synthesisStatus: (room.synthesisStatus as "idle" | "synthesizing" | "completed" | "failed" | "insufficient_evidence") || "idle",
      type: "group_meeting",
      preparationMaterial: m.preparationMaterial,
      meeting: {
        id: m.id,
        status: m.status,
        title: m.title,
        description: m.description,
        startTime: m.startTime.toISOString(),
        endTime: m.endTime.toISOString(),
        timezone: m.timezone || "UTC",
        invitationToken: m.invitationToken,
        preparationMaterial: m.preparationMaterial,
        openedEarlyAt: m.openedEarlyAt?.toISOString() || null,
        host: {
          id: h.id,
          name: h.name,
          slug: h.slug,
          avatarUrl: h.avatarUrl,
          timezone: h.timezone || "UTC",
        },
        attendees: m.attendees?.map((a) => ({
          id: a.id,
          name: a.name,
          status: a.status as "registered" | "joined" | "declined",
          joinedAt: a.joinedAt?.toISOString() || null,
        })),
      },
      // Backward-compatible booking shim so existing host/title access continues working
      booking: {
        id: m.id,
        status: m.status === "scheduled" ? "confirmed" : m.status,
        startTime: m.startTime.toISOString(),
        endTime: m.endTime.toISOString(),
        eventTitle: m.title,
        durationMins,
        host: {
          id: h.id,
          name: h.name,
          slug: h.slug,
          avatarUrl: h.avatarUrl,
          timezone: h.timezone || "UTC",
        },
        guest: {
          name: "Group Meeting Attendees",
          timezone: m.timezone || "UTC",
          notes: m.description,
        },
      },
      agenda: room.agenda || [],
      sharedNotes: room.sharedNotes || "",
      files: (room.files as RoomFileItem[]) || [],
      veraBrief: room.veraBrief,
      veraLedger: room.veraLedger,
    };
  }

  return null;
}

/**
 * Updates the shared notes surface in the room.
 */
export async function updateRoomNotes(
  token: string,
  notes: string,
  dbClient: RoomDb = defaultDb
): Promise<boolean> {
  const result = await dbClient
    .update(rooms)
    .set({
      sharedNotes: notes,
      updatedAt: new Date(),
    })
    .where(eq(rooms.accessToken, token))
    .returning({ id: rooms.id });

  return result.length > 0;
}

/**
 * Adds or updates an agenda item in the room.
 */
export async function updateRoomAgenda(
  token: string,
  agenda: VeraAgendaItem[],
  dbClient: RoomDb = defaultDb
): Promise<boolean> {
  const result = await dbClient
    .update(rooms)
    .set({
      agenda,
      updatedAt: new Date(),
    })
    .where(eq(rooms.accessToken, token))
    .returning({ id: rooms.id });

  return result.length > 0;
}

/**
 * Adds a shared document/file to the room.
 */
export async function addRoomFile(
  token: string,
  file: RoomFileItem,
  dbClient: RoomDb = defaultDb
): Promise<RoomFileItem[] | null> {
  const room = await dbClient.query.rooms.findFirst({
    where: eq(rooms.accessToken, token),
  });
  if (!room) return null;

  const currentFiles = (room.files as RoomFileItem[]) || [];
  const nextFiles = [file, ...currentFiles.filter((f) => f.id !== file.id)];

  await dbClient
    .update(rooms)
    .set({
      files: nextFiles,
      updatedAt: new Date(),
    })
    .where(eq(rooms.accessToken, token));

  return nextFiles;
}

export const SYNTHESIS_LEASE_MS = 60_000; // 60 seconds

export interface ConcludeRoomResult {
  success: boolean;
  status: "concluded" | "synthesizing" | "failed" | "not_found" | "stale_worker" | "insufficient_evidence";
  processing?: boolean;
  alreadyConcluded?: boolean;
  veraLedger?: VeraLedger | null;
  error?: string;
  message?: string;
  code?: string;
}

/**
 * Concludes meeting and requests Vera to synthesize the permanent record
 * using atomic database-level lease claiming to eliminate race conditions.
 * Supports explicit database dependency injection for isolated testing.
 */
export async function concludeRoomAndSynthesize(
  token: string,
  dbClient: RoomDb = defaultDb
): Promise<ConcludeRoomResult> {
  if (!token || typeof token !== "string") {
    return { success: false, status: "not_found", error: "Invalid token." };
  }

  // 1. Fast check if already concluded
  const existing = await dbClient.query.rooms.findFirst({
    where: eq(rooms.accessToken, token.trim()),
    with: {
      booking: {
        with: {
          host: true,
          eventType: true,
        },
      },
      meeting: {
        with: {
          host: true,
        },
      },
    },
  });

  if (!existing || (!existing.booking && !existing.meeting)) {
    return { success: false, status: "not_found", error: "Room not found." };
  }

  if (existing.status === "concluded" || existing.synthesisStatus === "completed") {
    return {
      success: true,
      status: "concluded",
      alreadyConcluded: true,
      veraLedger: existing.veraLedger as VeraLedger | null,
    };
  }

  const claimToken = crypto.randomUUID();
  const now = new Date();
  const leaseCutoff = new Date(now.getTime() - SYNTHESIS_LEASE_MS);

  // 2. Atomic claim via conditional SQL update
  let claimedRoom: typeof rooms.$inferSelect | undefined;
  try {
    const [claimed] = await dbClient
      .update(rooms)
      .set({
        synthesisStatus: "synthesizing",
        synthesisClaimToken: claimToken,
        synthesisClaimedAt: now,
        synthesisLastError: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(rooms.accessToken, token.trim()),
          ne(rooms.status, "concluded"),
          ne(rooms.synthesisStatus, "completed"),
          or(
            isNull(rooms.synthesisStatus),
            inArray(rooms.synthesisStatus, ["idle", "failed", "insufficient_evidence"]),
            and(
              eq(rooms.synthesisStatus, "synthesizing"),
              lt(rooms.synthesisClaimedAt, leaseCutoff)
            )
          )
        )
      )
      .returning();

    claimedRoom = claimed;
  } catch (claimErr) {
    console.error("[Vera Synthesis] Error during atomic claim:", claimErr);
    return {
      success: false,
      status: "failed",
      error: claimErr instanceof Error ? claimErr.message : String(claimErr),
    };
  }

  // 3. If not claimed, inspect current state to return precise status
  if (!claimedRoom) {
    const fresh = await dbClient.query.rooms.findFirst({
      where: eq(rooms.accessToken, token.trim()),
    });

    if (!fresh) {
      return { success: false, status: "not_found", error: "Room not found." };
    }

    if (fresh.status === "concluded" || fresh.synthesisStatus === "completed") {
      return {
        success: true,
        status: "concluded",
        alreadyConcluded: true,
        veraLedger: fresh.veraLedger as VeraLedger | null,
      };
    }

    if (fresh.synthesisStatus === "synthesizing") {
      return {
        success: true,
        status: "synthesizing",
        processing: true,
        message: "Vera summary synthesis is currently in progress.",
      };
    }

    return {
      success: false,
      status: "failed",
      error: "Unable to acquire synthesis claim.",
    };
  }

  // 4. This request holds the exclusive lease. Execute Vera synthesis.
  const b = existing.booking;
  const m = existing.meeting;
  const eventTitle = m?.title || b?.eventType?.title || "Meeting";
  const hostName = m?.host?.name || b?.host?.name || "Host";
  const guestName = m ? "Meeting Attendees" : b?.guestName || "Guest";

  try {
    const ledger = await generateVeraLedger({
      eventTitle,
      hostName,
      guestName,
      agenda: (claimedRoom.agenda as VeraAgendaItem[]) || [],
      sharedNotes: claimedRoom.sharedNotes || undefined,
      transcript: claimedRoom.transcript || undefined,
    });

    // 5. Fenced completion write: only commit if claimToken still matches
    const [finalized] = await dbClient
      .update(rooms)
      .set({
        status: "concluded",
        synthesisStatus: "completed",
        synthesisClaimToken: null,
        veraLedger: ledger,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(rooms.accessToken, token.trim()),
          eq(rooms.synthesisClaimToken, claimToken)
        )
      )
      .returning();

    if (!finalized) {
      console.warn("[Vera Synthesis] Stale worker write ignored — lease expired and was claimed by another worker.");
      return {
        success: false,
        status: "stale_worker",
        error: "Synthesis completed but lease had expired.",
      };
    }

    return {
      success: true,
      status: "concluded",
      veraLedger: finalized.veraLedger as VeraLedger | null,
    };
  } catch (err) {
    console.error("[Vera Synthesis] Error during LLM generation:", err);
    const isInsufficientEvidence =
      err instanceof VeraInsufficientEvidenceError ||
      (err as { code?: string } | undefined)?.code === "INSUFFICIENT_EVIDENCE";

    const failureStatus = isInsufficientEvidence ? "insufficient_evidence" : "failed";
    const errorMessage = isInsufficientEvidence
      ? "Vera needs actual meeting notes or a transcript before it can create a reliable meeting record. Add the missing context and try again."
      : err instanceof Error
      ? err.message
      : "Vera synthesis failed";

    // 6. Release claim on failure ONLY if this worker still holds the claimToken
    await dbClient
      .update(rooms)
      .set({
        synthesisStatus: failureStatus,
        synthesisClaimToken: null,
        synthesisLastError: errorMessage,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(rooms.accessToken, token.trim()),
          eq(rooms.synthesisClaimToken, claimToken)
        )
      );

    return {
      success: false,
      status: failureStatus,
      error: errorMessage,
      code: isInsufficientEvidence ? "INSUFFICIENT_EVIDENCE" : undefined,
    };
  }
}

/**
 * Host-authoritative ledger approval.
 * Transitions a Vera meeting ledger from "pending_host_review" to "approved".
 * Enforces authenticated host ownership and safe idempotency.
 */
export async function approveRoomLedger(
  token: string,
  hostUserId: string,
  dbClient: RoomDb = defaultDb
): Promise<{
  success: boolean;
  status: "approved" | "already_approved" | "not_found" | "forbidden" | "failed";
  veraLedger?: VeraLedger | null;
  error?: string;
}> {
  if (!token || typeof token !== "string" || !hostUserId) {
    return {
      success: false,
      status: "forbidden",
      error: "Missing room token or host identification.",
    };
  }

  const room = await dbClient.query.rooms.findFirst({
    where: eq(rooms.accessToken, token.trim()),
    with: {
      booking: {
        with: {
          host: true,
        },
      },
      meeting: {
        with: {
          host: true,
        },
      },
    },
  });

  const hostUser = room?.booking?.host || room?.meeting?.host;
  if (!room || !hostUser) {
    return { success: false, status: "not_found", error: "Room not found." };
  }

  if (hostUser.id !== hostUserId) {
    return {
      success: false,
      status: "forbidden",
      error: "Forbidden: Only the authenticated meeting host can approve this ledger.",
    };
  }

  if (!room.veraLedger) {
    return {
      success: false,
      status: "failed",
      error: "No meeting record exists to approve. Conclude the call first.",
    };
  }

  const currentLedger = room.veraLedger as unknown as VeraLedger;
  if (currentLedger.reviewStatus === "approved") {
    return {
      success: true,
      status: "already_approved",
      veraLedger: currentLedger,
    };
  }

  const now = new Date();
  const approvedLedger: VeraLedger = {
    ...currentLedger,
    reviewStatus: "approved",
    approvedAt: now.toISOString(),
    approvedBy: hostUserId,
  };

  const [updated] = await dbClient
    .update(rooms)
    .set({
      veraLedger: approvedLedger,
      updatedAt: now,
    })
    .where(eq(rooms.accessToken, token.trim()))
    .returning();

  return {
    success: true,
    status: "approved",
    veraLedger: (updated?.veraLedger as unknown as VeraLedger) || approvedLedger,
  };
}
