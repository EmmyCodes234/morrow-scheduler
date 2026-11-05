import crypto from "crypto";
import { db } from "@/db";
import { rooms, bookings, eventTypes, users } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  generateVeraPreMeetingBrief,
  generateVeraLedger,
  type VeraAgendaItem,
  type VeraLedger,
} from "@/lib/intelligence/vera";

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
  booking: {
    id: string;
    startTime: string;
    endTime: string;
    eventTitle: string;
    durationMins: number;
    host: {
      name: string;
      email: string;
      slug: string;
      avatarUrl?: string | null;
      timezone: string;
    };
    guest: {
      name: string;
      email: string;
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
    actionItems?: Array<{ id: string; task: string; assignee: string; priority: "high" | "medium" | "low"; done: boolean }>;
    keyDecisions?: string[];
    suggestedFollowUp?: string;
  } | null;
}

/**
 * Creates or retrieves the associated Room for a booking.
 */
export async function getOrCreateRoomForBooking(bookingId: string): Promise<typeof rooms.$inferSelect> {
  const existing = await db.query.rooms.findFirst({
    where: eq(rooms.bookingId, bookingId),
  });

  if (existing) {
    return existing;
  }

  // Load booking with host and eventType
  const booking = await db.query.bookings.findFirst({
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

  const [newRoom] = await db
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
    .returning();

  return newRoom;
}

/**
 * Retrieves public room state using the secure room access token.
 */
export async function getRoomByAccessToken(token: string): Promise<RoomDetails | null> {
  if (!token || typeof token !== "string") return null;

  const room = await db.query.rooms.findFirst({
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
    booking: {
      id: b.id,
      startTime: b.startTime.toISOString(),
      endTime: b.endTime.toISOString(),
      eventTitle: et?.title || "Strategy Call",
      durationMins: et?.durationMins || 30,
      host: {
        name: h.name,
        email: h.email,
        slug: h.slug,
        avatarUrl: h.avatarUrl,
        timezone: h.timezone || "UTC",
      },
      guest: {
        name: b.guestName,
        email: b.guestEmail,
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
export async function updateRoomNotes(token: string, notes: string): Promise<boolean> {
  const result = await db
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
export async function updateRoomAgenda(token: string, agenda: VeraAgendaItem[]): Promise<boolean> {
  const result = await db
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
export async function addRoomFile(token: string, file: RoomFileItem): Promise<RoomFileItem[] | null> {
  const room = await db.query.rooms.findFirst({
    where: eq(rooms.accessToken, token),
  });
  if (!room) return null;

  const currentFiles = (room.files as RoomFileItem[]) || [];
  const nextFiles = [file, ...currentFiles.filter((f) => f.id !== file.id)];

  await db
    .update(rooms)
    .set({
      files: nextFiles,
      updatedAt: new Date(),
    })
    .where(eq(rooms.accessToken, token));

  return nextFiles;
}

/**
 * Concludes meeting and requests Vera to synthesize the permanent record.
 */
export async function concludeRoomAndSynthesize(token: string): Promise<typeof rooms.$inferSelect | null> {
  const room = await db.query.rooms.findFirst({
    where: eq(rooms.accessToken, token),
    with: {
      booking: {
        with: {
          host: true,
          eventType: true,
        },
      },
    },
  });

  if (!room || !room.booking) return null;

  const b = room.booking;
  const ledger = await generateVeraLedger({
    eventTitle: b.eventType?.title || "Meeting",
    hostName: b.host?.name || "Host",
    guestName: b.guestName,
    agenda: room.agenda || [],
    sharedNotes: room.sharedNotes || undefined,
    transcript: room.transcript || undefined,
  });

  const [updated] = await db
    .update(rooms)
    .set({
      status: "concluded",
      veraLedger: ledger,
      updatedAt: new Date(),
    })
    .where(eq(rooms.accessToken, token))
    .returning();

  return updated;
}
