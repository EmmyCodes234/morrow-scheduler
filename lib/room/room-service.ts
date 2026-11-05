import crypto from "crypto";
import { db as defaultDb } from "@/db";
import { rooms, bookings, eventTypes, users } from "@/db/schema";
import { eq, and, or, inArray, ne, lt } from "drizzle-orm";
import {
  generateVeraPreMeetingBrief,
  generateVeraLedger,
  type VeraAgendaItem,
  type VeraLedger,
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
  synthesisStatus?: "idle" | "synthesizing" | "completed" | "failed";
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
    executiveSummary?: string[];
    actionItems?: Array<{ id: string; task: string; assignee: string; priority: "high" | "medium" | "low"; done: boolean; deadline?: string }>;
    keyDecisions?: string[];
    suggestedFollowUp?: string;
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
    },
  });

  if (!room || !room.booking || !room.booking.host) {
    return null;
  }

  const b = room.booking;
  const h = b.host;
  const et = b.eventType;

  return {
    id: room.id,
    accessToken: room.accessToken,
    status: (room.status as "pre_meeting" | "in_progress" | "concluded") || "pre_meeting",
    synthesisStatus: (room.synthesisStatus as "idle" | "synthesizing" | "completed" | "failed") || "idle",
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
  status: "concluded" | "synthesizing" | "failed" | "not_found" | "stale_worker";
  processing?: boolean;
  alreadyConcluded?: boolean;
  veraLedger?: VeraLedger | null;
  error?: string;
  message?: string;
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
    },
  });

  if (!existing || !existing.booking) {
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
            inArray(rooms.synthesisStatus, ["idle", "failed"]),
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
  try {
    const ledger = await generateVeraLedger({
      eventTitle: b.eventType?.title || "Meeting",
      hostName: b.host?.name || "Host",
      guestName: b.guestName,
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
    // 6. Release claim on failure ONLY if this worker still holds the claimToken
    await dbClient
      .update(rooms)
      .set({
        synthesisStatus: "failed",
        synthesisClaimToken: null,
        synthesisLastError: err instanceof Error ? err.message : String(err),
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
      status: "failed",
      error: err instanceof Error ? err.message : "Vera synthesis failed",
    };
  }
}
