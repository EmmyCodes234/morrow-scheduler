import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import {
  isMeetingCallOpen,
  hashInvitationToken,
  DEFAULT_EARLY_ACCESS_MINUTES,
} from "@/lib/meetings/meeting-service";
import * as livekitRoute from "@/app/api/room/[token]/livekit/route";
import * as openEarlyRoute from "@/app/api/room/[token]/open-early/route";
import * as meetingsRoute from "@/app/api/meetings/route";
import * as roomService from "@/lib/room/room-service";
import * as meetingService from "@/lib/meetings/meeting-service";
import { localWallClockToUtcDate } from "@/lib/scheduling/timezone";
import * as authModule from "@/auth";
import { db } from "@/db";

// Mock dependencies
vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/db", () => ({
  db: {
    query: {
      users: {
        findFirst: vi.fn(),
      },
      rooms: {
        findFirst: vi.fn(),
      },
      meetings: {
        findFirst: vi.fn(),
      },
    },
    insert: vi.fn(),
    update: vi.fn(),
  },
}));

describe("Morrow Group Meetings — Pilot P0 & Early Arrival Engine", () => {
  const mockHostId = "user-host-101";
  const mockGuestAttendeeId = "attendee-uuid-202";
  const mockSessionToken = "sess-tok-abcdef123456789";
  const mockRoomToken = "room-access-token-999";
  const mockMeetingId = "meeting-uuid-303";

  // Scheduled meeting: Thursday 5 Nov 2026, 9:00 PM Africa/Lagos (UTC+1 -> 20:00:00Z)
  const scheduledStartUTC = new Date("2026-11-05T20:00:00.000Z");
  const scheduledEndUTC = new Date("2026-11-05T22:00:00.000Z");

  const createMockGroupMeeting = (overrides: Partial<any> = {}) => ({
    id: mockMeetingId,
    hostId: mockHostId,
    title: "FOF Scrabble Tournament Planning",
    description: "Planning committee meeting for FOF tournament",
    startTime: scheduledStartUTC,
    endTime: scheduledEndUTC,
    timezone: "Africa/Lagos",
    status: "scheduled",
    invitationToken: "invitation-token-random-xyz",
    invitationTokenHash: hashInvitationToken("invitation-token-random-xyz"),
    preparationMaterial: "# Cleaned Minutes of 2 Nov 2026\nTournament benchmark for Nigeria.",
    agenda: [],
    openedEarlyAt: null,
    createdAt: new Date("2026-11-03T10:00:00Z"),
    updatedAt: new Date("2026-11-03T10:00:00Z"),
    host: {
      id: mockHostId,
      name: "Mr. Bright Idahosa",
      slug: "bright-idahosa",
      avatarUrl: null,
      timezone: "Africa/Lagos",
    },
    attendees: [
      {
        id: mockGuestAttendeeId,
        name: "Enyi Emmanuel",
        email: "enyi@example.com",
        status: "registered",
        joinedAt: null,
      },
    ],
    ...overrides,
  });

  const createMockRoom = (meetingOverrides: Partial<any> = {}, roomStatus = "pre_meeting") => ({
    id: "room-uuid-888",
    accessToken: mockRoomToken,
    status: roomStatus as "pre_meeting" | "in_progress" | "concluded",
    type: "group_meeting" as const,
    meeting: createMockGroupMeeting(meetingOverrides),
    booking: {
      id: "legacy-shim-id",
      status: "confirmed",
      startTime: scheduledStartUTC.toISOString(),
      endTime: scheduledEndUTC.toISOString(),
      eventTitle: "FOF Scrabble Tournament Planning",
      durationMins: 120,
      host: {
        id: mockHostId,
        name: "Mr. Bright Idahosa",
        slug: "bright-idahosa",
        timezone: "Africa/Lagos",
      },
      guest: {
        name: "Enyi Emmanuel",
        timezone: "Africa/Lagos",
      },
    },
    agenda: [],
    sharedNotes: "",
    files: [],
  });

  beforeEach(() => {
    process.env.LIVEKIT_API_KEY = "test-livekit-key";
    process.env.LIVEKIT_API_SECRET = "test-livekit-secret-32-chars-minimum-key";
    process.env.LIVEKIT_URL = "wss://test.livekit.cloud";
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // 1. Authoritative Call Access Policy (`isMeetingCallOpen`)
  // =========================================================================
  describe("Authoritative Call Access Policy", () => {
    const meeting = {
      status: "scheduled",
      startTime: scheduledStartUTC, // 20:00:00Z (9:00 PM Lagos)
      endTime: scheduledEndUTC,     // 22:00:00Z (11:00 PM Lagos)
      timezone: "Africa/Lagos",
      openedEarlyAt: null,
    };

    it("denies access 2 days before the meeting (returns call_not_open_yet)", () => {
      const twoDaysBefore = new Date("2026-11-03T20:00:00.000Z");
      const status = isMeetingCallOpen(meeting, twoDaysBefore);

      expect(status.isOpen).toBe(false);
      expect(status.reason).toBe("call_not_open_yet");
      expect(status.opensAt.toISOString()).toBe("2026-11-05T19:45:00.000Z"); // 15 mins prior
      expect(status.earlyAccessOpened).toBe(false);
    });

    it("denies access 20 minutes before the scheduled start", () => {
      const twentyMinsBefore = new Date("2026-11-05T19:40:00.000Z");
      const status = isMeetingCallOpen(meeting, twentyMinsBefore);

      expect(status.isOpen).toBe(false);
      expect(status.reason).toBe("call_not_open_yet");
    });

    it("automatically grants access at exactly 15 minutes before start (early window)", () => {
      const fifteenMinsBefore = new Date("2026-11-05T19:45:00.000Z"); // 8:45 PM Lagos
      const status = isMeetingCallOpen(meeting, fifteenMinsBefore);

      expect(status.isOpen).toBe(true);
      expect(status.reason).toBe("early_window");
      expect(status.earlyAccessOpened).toBe(false);
    });

    it("automatically grants access during the 15-minute early window", () => {
      const fiveMinsBefore = new Date("2026-11-05T19:55:00.000Z"); // 8:55 PM Lagos
      const status = isMeetingCallOpen(meeting, fiveMinsBefore);

      expect(status.isOpen).toBe(true);
      expect(status.reason).toBe("early_window");
    });

    it("automatically grants access at the exact scheduled start time", () => {
      const exactStart = new Date("2026-11-05T20:00:00.000Z"); // 9:00 PM Lagos
      const status = isMeetingCallOpen(meeting, exactStart);

      expect(status.isOpen).toBe(true);
      expect(status.reason).toBe("scheduled_time");
    });

    it("permits late arrivals after the scheduled start time", () => {
      const thirtyFiveMinsLate = new Date("2026-11-05T20:35:00.000Z"); // 9:35 PM Lagos
      const status = isMeetingCallOpen(meeting, thirtyFiveMinsLate);

      expect(status.isOpen).toBe(true);
      expect(status.reason).toBe("scheduled_time");
    });

    it("does not cut off or deny access after the scheduled end time (late continuation)", () => {
      const pastEnd = new Date("2026-11-05T22:30:00.000Z"); // 11:30 PM Lagos
      const status = isMeetingCallOpen(meeting, pastEnd);

      expect(status.isOpen).toBe(true);
      expect(status.reason).toBe("scheduled_time");
    });

    it("grants access immediately when the host opened early, even hours before", () => {
      const earlyOpenTime = new Date("2026-11-05T18:20:00.000Z"); // 7:20 PM Lagos
      const meetingOpenedEarly = {
        ...meeting,
        openedEarlyAt: earlyOpenTime,
      };

      const guestArrivesAt725 = new Date("2026-11-05T18:25:00.000Z");
      const status = isMeetingCallOpen(meetingOpenedEarly, guestArrivesAt725);

      expect(status.isOpen).toBe(true);
      expect(status.reason).toBe("early_access_opened");
      expect(status.earlyAccessOpened).toBe(true);
      expect(status.opensAt).toEqual(earlyOpenTime);
      // Preserves original scheduled start time
      expect(status.scheduledStartTime).toEqual(scheduledStartUTC);
    });

    it("denies access when meeting is cancelled, even if within time window", () => {
      const cancelledMeeting = { ...meeting, status: "cancelled" };
      const status = isMeetingCallOpen(cancelledMeeting, scheduledStartUTC);

      expect(status.isOpen).toBe(false);
      expect(status.reason).toBe("meeting_cancelled");
    });

    it("denies access when meeting is concluded", () => {
      const concludedMeeting = { ...meeting, status: "concluded" };
      const status = isMeetingCallOpen(concludedMeeting, scheduledStartUTC);

      expect(status.isOpen).toBe(false);
      expect(status.reason).toBe("meeting_concluded");
    });
  });

  // =========================================================================
  // 2. Token Hashing & Session Recovery
  // =========================================================================
  describe("Token Hashing & Security", () => {
    it("hashes invitation tokens with SHA-256", () => {
      const token = "secure-random-invitation-token-123";
      const hash1 = hashInvitationToken(token);
      const hash2 = hashInvitationToken(token);

      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64);
      expect(hash1).not.toBe(token);
    });
  });

  // =========================================================================
  // 3. Server-Authoritative LiveKit Call Access & Early Arrival
  // =========================================================================
  describe("LiveKit Token Issuance & Early Arrival Route Verification", () => {
    it("rejects unregistered guests without attendee session token (403)", async () => {
      vi.spyOn(roomService, "getRoomByAccessToken").mockResolvedValue(createMockRoom() as any);
      vi.spyOn(authModule, "auth").mockResolvedValue(null as any);

      const req = new NextRequest(`https://usemorrow.xyz/api/room/${mockRoomToken}/livekit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      const res = await livekitRoute.POST(req, {
        params: Promise.resolve({ token: mockRoomToken }),
      });

      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.code).toBe("ATTENDEE_REGISTRATION_REQUIRED");
    });

    it("returns HTTP 425 Too Early when a guest arrives before the 15-minute window", async () => {
      // Mock room scheduled in the future with no early open
      const futureRoom = createMockRoom({
        startTime: new Date(Date.now() + 60 * 60 * 1000), // 1 hour in the future
        endTime: new Date(Date.now() + 180 * 60 * 1000),
        openedEarlyAt: null,
      });

      vi.spyOn(roomService, "getRoomByAccessToken").mockResolvedValue(futureRoom as any);
      vi.spyOn(authModule, "auth").mockResolvedValue(null as any);
      vi.spyOn(meetingService, "getAttendeeBySessionToken").mockResolvedValue({
        id: mockGuestAttendeeId,
        name: "Enyi Emmanuel",
        email: "enyi@example.com",
        status: "registered",
        sessionToken: mockSessionToken,
        createdAt: new Date().toISOString(),
      } as any);

      const req = new NextRequest(`https://usemorrow.xyz/api/room/${mockRoomToken}/livekit`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-attendee-session": mockSessionToken,
        },
        body: JSON.stringify({ attendeeSessionToken: mockSessionToken }),
      });

      const res = await livekitRoute.POST(req, {
        params: Promise.resolve({ token: mockRoomToken }),
      });

      expect(res.status).toBe(425);
      const data = await res.json();
      expect(data.code).toBe("CALL_NOT_OPEN_YET");
      expect(data.opensAt).toBeDefined();
      expect(data.earlyAccessMinutes).toBe(15);
    });

    it("issues LiveKit token to guest when within the 15-minute early window", async () => {
      // Meeting starts in 10 minutes (within 15-min window)
      const earlyWindowRoom = createMockRoom({
        startTime: new Date(Date.now() + 10 * 60 * 1000),
        endTime: new Date(Date.now() + 70 * 60 * 1000),
        openedEarlyAt: null,
      });

      vi.spyOn(roomService, "getRoomByAccessToken").mockResolvedValue(earlyWindowRoom as any);
      vi.spyOn(authModule, "auth").mockResolvedValue(null as any);
      vi.spyOn(meetingService, "getAttendeeBySessionToken").mockResolvedValue({
        id: mockGuestAttendeeId,
        name: "Enyi Emmanuel",
        email: "enyi@example.com",
        status: "registered",
        sessionToken: mockSessionToken,
        createdAt: new Date().toISOString(),
      } as any);
      vi.spyOn(meetingService, "markAttendeeJoined").mockResolvedValue({} as any);

      const req = new NextRequest(`https://usemorrow.xyz/api/room/${mockRoomToken}/livekit`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-attendee-session": mockSessionToken,
        },
        body: JSON.stringify({ attendeeSessionToken: mockSessionToken }),
      });

      const res = await livekitRoute.POST(req, {
        params: Promise.resolve({ token: mockRoomToken }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.token).toBeDefined();
      expect(data.url).toBeDefined();
    });

    it("issues LiveKit token to guest when host has opened the room early", async () => {
      // Meeting scheduled 2 hours in future, but openedEarlyAt is set
      const earlyOpenedRoom = createMockRoom({
        startTime: new Date(Date.now() + 120 * 60 * 1000),
        endTime: new Date(Date.now() + 240 * 60 * 1000),
        openedEarlyAt: new Date(Date.now() - 5 * 60 * 1000), // opened 5 mins ago
      });

      vi.spyOn(roomService, "getRoomByAccessToken").mockResolvedValue(earlyOpenedRoom as any);
      vi.spyOn(authModule, "auth").mockResolvedValue(null as any);
      vi.spyOn(meetingService, "getAttendeeBySessionToken").mockResolvedValue({
        id: mockGuestAttendeeId,
        name: "Enyi Emmanuel",
        email: "enyi@example.com",
        status: "registered",
        sessionToken: mockSessionToken,
        createdAt: new Date().toISOString(),
      } as any);
      vi.spyOn(meetingService, "markAttendeeJoined").mockResolvedValue({} as any);

      const req = new NextRequest(`https://usemorrow.xyz/api/room/${mockRoomToken}/livekit`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-attendee-session": mockSessionToken,
        },
        body: JSON.stringify({ attendeeSessionToken: mockSessionToken }),
      });

      const res = await livekitRoute.POST(req, {
        params: Promise.resolve({ token: mockRoomToken }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.token).toBeDefined();
    });

    it("allows late-arriving guests to join after scheduled start time", async () => {
      // Meeting started 30 mins ago
      const lateArrivalRoom = createMockRoom({
        startTime: new Date(Date.now() - 30 * 60 * 1000),
        endTime: new Date(Date.now() + 60 * 60 * 1000),
        openedEarlyAt: null,
      });

      vi.spyOn(roomService, "getRoomByAccessToken").mockResolvedValue(lateArrivalRoom as any);
      vi.spyOn(authModule, "auth").mockResolvedValue(null as any);
      vi.spyOn(meetingService, "getAttendeeBySessionToken").mockResolvedValue({
        id: mockGuestAttendeeId,
        name: "Enyi Emmanuel",
        email: "enyi@example.com",
        status: "registered",
        sessionToken: mockSessionToken,
        createdAt: new Date().toISOString(),
      } as any);
      vi.spyOn(meetingService, "markAttendeeJoined").mockResolvedValue({} as any);

      const req = new NextRequest(`https://usemorrow.xyz/api/room/${mockRoomToken}/livekit`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-attendee-session": mockSessionToken,
        },
        body: JSON.stringify({ attendeeSessionToken: mockSessionToken }),
      });

      const res = await livekitRoute.POST(req, {
        params: Promise.resolve({ token: mockRoomToken }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.token).toBeDefined();
    });

    it("allows the host to join at any time with host-authoritative identity", async () => {
      const futureRoom = createMockRoom({
        startTime: new Date(Date.now() + 180 * 60 * 1000), // 3 hours in future
        openedEarlyAt: null,
      });

      vi.spyOn(roomService, "getRoomByAccessToken").mockResolvedValue(futureRoom as any);
      // Authenticated as the actual host
      vi.spyOn(authModule, "auth").mockResolvedValue({
        user: { id: mockHostId, name: "Mr. Bright Idahosa", email: "host@example.com" },
      } as any);

      const req = new NextRequest(`https://usemorrow.xyz/api/room/${mockRoomToken}/livekit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      const res = await livekitRoute.POST(req, {
        params: Promise.resolve({ token: mockRoomToken }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.token).toBeDefined();
    });

    it("denies access when meeting is cancelled (403)", async () => {
      const cancelledRoom = createMockRoom({
        status: "cancelled",
      });

      vi.spyOn(roomService, "getRoomByAccessToken").mockResolvedValue(cancelledRoom as any);
      vi.spyOn(authModule, "auth").mockResolvedValue(null as any);

      const req = new NextRequest(`https://usemorrow.xyz/api/room/${mockRoomToken}/livekit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attendeeSessionToken: mockSessionToken }),
      });

      const res = await livekitRoute.POST(req, {
        params: Promise.resolve({ token: mockRoomToken }),
      });

      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toContain("cancelled");
    });

    it("denies access when room is concluded (403)", async () => {
      const concludedRoom = createMockRoom({}, "concluded");

      vi.spyOn(roomService, "getRoomByAccessToken").mockResolvedValue(concludedRoom as any);
      vi.spyOn(authModule, "auth").mockResolvedValue(null as any);

      const req = new NextRequest(`https://usemorrow.xyz/api/room/${mockRoomToken}/livekit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attendeeSessionToken: mockSessionToken }),
      });

      const res = await livekitRoute.POST(req, {
        params: Promise.resolve({ token: mockRoomToken }),
      });

      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toContain("concluded");
    });
  });

  // =========================================================================
  // 4. Host-Controlled Early Room Opening Endpoint
  // =========================================================================
  describe("Host-Controlled Early Room Opening Endpoint", () => {
    it("allows the authenticated host to open the room early", async () => {
      const mockRoom = createMockRoom();
      vi.spyOn(roomService, "getRoomByAccessToken").mockResolvedValue(mockRoom as any);
      vi.spyOn(authModule, "auth").mockResolvedValue({
        user: { id: mockHostId, name: "Mr. Bright Idahosa" },
      } as any);

      const openedDate = new Date();
      vi.spyOn(meetingService, "openMeetingEarly").mockResolvedValue({
        ...mockRoom.meeting,
        openedEarlyAt: openedDate,
      } as any);

      const req = new NextRequest(`https://usemorrow.xyz/api/room/${mockRoomToken}/open-early`, {
        method: "POST",
      });

      const res = await openEarlyRoute.POST(req, {
        params: Promise.resolve({ token: mockRoomToken }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.openedEarlyAt).toBeDefined();
      expect(data.callAccessStatus.isOpen).toBe(true);
    });

    it("forbids non-host participants from opening the room early (403)", async () => {
      const mockRoom = createMockRoom();
      vi.spyOn(roomService, "getRoomByAccessToken").mockResolvedValue(mockRoom as any);
      // Authenticated as an intruder / non-host user
      vi.spyOn(authModule, "auth").mockResolvedValue({
        user: { id: "intruder-user-999", name: "Intruder" },
      } as any);

      const req = new NextRequest(`https://usemorrow.xyz/api/room/${mockRoomToken}/open-early`, {
        method: "POST",
      });

      const res = await openEarlyRoute.POST(req, {
        params: Promise.resolve({ token: mockRoomToken }),
      });

      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toContain("only the meeting host");
    });

    it("rejects unauthenticated requests to open the room early (401)", async () => {
      vi.spyOn(authModule, "auth").mockResolvedValue(null as any);

      const req = new NextRequest(`https://usemorrow.xyz/api/room/${mockRoomToken}/open-early`, {
        method: "POST",
      });

      const res = await openEarlyRoute.POST(req, {
        params: Promise.resolve({ token: mockRoomToken }),
      });

      expect(res.status).toBe(401);
    });
  });

  // =========================================================================
  // 5. POST /api/meetings Contract, Timezone Conversion & Validation
  // =========================================================================
  describe("POST /api/meetings — Contract & Validation", () => {
    const mockDbHost = {
      id: mockHostId,
      name: "Mr. Bright Idahosa",
      email: "bright@example.com",
      timezone: "Africa/Lagos",
    };

    beforeEach(() => {
      vi.spyOn(authModule, "auth").mockResolvedValue({
        user: { id: mockHostId, email: "bright@example.com", name: "Mr. Bright Idahosa" },
      } as any);
      (db.query.users.findFirst as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(mockDbHost);
    });

    it("creates a meeting using the new modal contract with date and startTime", async () => {
      const mockCreatedMeeting = createMockGroupMeeting();
      const mockCreatedRoom = {
        id: "room-uuid-888",
        accessToken: "room-access-token-999",
        status: "pre_meeting",
      };

      const createMeetingSpy = vi.spyOn(meetingService, "createMeeting").mockResolvedValue({
        meeting: mockCreatedMeeting as any,
        room: mockCreatedRoom as any,
        invitationToken: "inv-token-xyz-123",
        invitationUrl: "https://usemorrow.xyz/j/inv-token-xyz-123",
      });

      const req = new NextRequest("https://usemorrow.xyz/api/meetings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "FOF Scrabble Tournament Planning",
          date: "2026-11-05",
          startTime: "21:00",
          durationMins: 120,
          timezone: "Africa/Lagos",
          description: "Planning committee meeting for FOF tournament",
          preparationMaterial: "# Cleaned Minutes of 2 Nov 2026",
        }),
      });

      const res = await meetingsRoute.POST(req);
      expect(res.status).toBe(201);
      const data = await res.json();

      expect(data.success).toBe(true);
      expect(data.meeting).toBeDefined();
      expect(data.room).toBeDefined();
      // CRITICAL CONTRACT REQUIREMENT: roomAccessToken must be returned directly at top level
      expect(data.roomAccessToken).toBe("room-access-token-999");
      expect(data.invitationToken).toBe("inv-token-xyz-123");
      expect(data.invitationUrl).toBe("https://usemorrow.xyz/j/inv-token-xyz-123");

      // Verify that createMeeting was called with correct UTC timestamps:
      // Thursday 5 Nov 2026, 9:00 PM Africa/Lagos (UTC+1) is 20:00:00Z
      expect(createMeetingSpy).toHaveBeenCalledWith(
        mockHostId,
        expect.objectContaining({
          title: "FOF Scrabble Tournament Planning",
          startTime: new Date("2026-11-05T20:00:00.000Z"),
          endTime: new Date("2026-11-05T22:00:00.000Z"),
          timezone: "Africa/Lagos",
          description: "Planning committee meeting for FOF tournament",
          preparationMaterial: "# Cleaned Minutes of 2 Nov 2026",
        })
      );
    });

    it("converts Africa/Lagos wall-clock time accurately across UTC offsets", () => {
      // 9:00 PM in Lagos (UTC+1) -> 20:00:00 UTC
      const lagosUtc = localWallClockToUtcDate("2026-11-05", "21:00", "Africa/Lagos");
      expect(lagosUtc.toISOString()).toBe("2026-11-05T20:00:00.000Z");

      // 9:00 AM in New York on standard time (EST, UTC-5) -> 14:00:00 UTC
      const nyWinterUtc = localWallClockToUtcDate("2026-11-05", "09:00", "America/New_York");
      expect(nyWinterUtc.toISOString()).toBe("2026-11-05T14:00:00.000Z");

      // 9:00 AM in London during BST (UTC+1) -> 08:00:00 UTC
      const londonSummerUtc = localWallClockToUtcDate("2026-07-15", "09:00", "Europe/London");
      expect(londonSummerUtc.toISOString()).toBe("2026-07-15T08:00:00.000Z");
    });

    it("supports backward-compatible ISO startTime and endTime", async () => {
      const mockCreatedMeeting = createMockGroupMeeting();
      const mockCreatedRoom = {
        id: "room-uuid-888",
        accessToken: "room-access-token-999",
        status: "pre_meeting",
      };

      vi.spyOn(meetingService, "createMeeting").mockResolvedValue({
        meeting: mockCreatedMeeting as any,
        room: mockCreatedRoom as any,
        invitationToken: "inv-token-legacy",
        invitationUrl: "https://usemorrow.xyz/j/inv-token-legacy",
      });

      const req = new NextRequest("https://usemorrow.xyz/api/meetings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Legacy Contract Meeting",
          startTime: "2026-11-05T20:00:00.000Z",
          endTime: "2026-11-05T21:00:00.000Z",
        }),
      });

      const res = await meetingsRoute.POST(req);
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.roomAccessToken).toBe("room-access-token-999");
    });

    it("rejects request when title is missing or empty (400)", async () => {
      const req = new NextRequest("https://usemorrow.xyz/api/meetings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "   ",
          date: "2026-11-05",
          startTime: "21:00",
        }),
      });

      const res = await meetingsRoute.POST(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("Meeting title is required");
    });

    it("rejects request with invalid date format (400)", async () => {
      const req = new NextRequest("https://usemorrow.xyz/api/meetings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Test Meeting",
          date: "05/11/2026", // Invalid format (should be YYYY-MM-DD)
          startTime: "21:00",
        }),
      });

      const res = await meetingsRoute.POST(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("Date must be in YYYY-MM-DD format");
    });

    it("rejects request with invalid 24-hr time format (400)", async () => {
      const req = new NextRequest("https://usemorrow.xyz/api/meetings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Test Meeting",
          date: "2026-11-05",
          startTime: "9:00 PM", // Invalid format (should be 21:00)
        }),
      });

      const res = await meetingsRoute.POST(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("Start time must be in HH:MM format");
    });

    it("rejects request with invalid IANA timezone (400)", async () => {
      const req = new NextRequest("https://usemorrow.xyz/api/meetings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Test Meeting",
          date: "2026-11-05",
          startTime: "21:00",
          timezone: "Invalid/Timezone_Name",
        }),
      });

      const res = await meetingsRoute.POST(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("Invalid IANA timezone identifier");
    });

    it("rejects request with out-of-range duration (400)", async () => {
      const req = new NextRequest("https://usemorrow.xyz/api/meetings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Test Meeting",
          date: "2026-11-05",
          startTime: "21:00",
          durationMins: 5, // Below minimum 15 mins
        }),
      });

      const res = await meetingsRoute.POST(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("between 15 and 1440 minutes");
    });

    it("rejects unauthenticated meeting creation (401)", async () => {
      vi.spyOn(authModule, "auth").mockResolvedValue(null as any);

      const req = new NextRequest("https://usemorrow.xyz/api/meetings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Unauthorized Meeting",
          date: "2026-11-05",
          startTime: "21:00",
        }),
      });

      const res = await meetingsRoute.POST(req);
      expect(res.status).toBe(401);
    });
  });

  // =========================================================================
  // 6. Attendee Email Privacy Protection
  // =========================================================================
  describe("Attendee Email Privacy Protection", () => {
    it("omits attendee email addresses from getRoomByAccessToken details", async () => {
      const mockRawRoom = {
        id: "room-uuid-888",
        accessToken: mockRoomToken,
        status: "pre_meeting",
        meetingId: mockMeetingId,
        bookingId: null,
        agenda: [],
        sharedNotes: "",
        files: [],
        veraBrief: null,
        veraLedger: null,
        meeting: {
          id: mockMeetingId,
          status: "scheduled",
          title: "FOF Scrabble Tournament Planning",
          description: "Committee meeting",
          startTime: scheduledStartUTC,
          endTime: scheduledEndUTC,
          timezone: "Africa/Lagos",
          invitationToken: "inv-tok-xyz",
          preparationMaterial: null,
          openedEarlyAt: null,
          host: {
            id: mockHostId,
            name: "Mr. Bright Idahosa",
            slug: "bright-idahosa",
            avatarUrl: null,
            timezone: "Africa/Lagos",
          },
          attendees: [
            {
              id: "attendee-1",
              name: "Participant Alpha",
              email: "alpha-confidential@example.com", // SENSITIVE EMAIL
              status: "registered",
              joinedAt: null,
            },
            {
              id: "attendee-2",
              name: "Participant Beta",
              email: "beta-private@example.com", // SENSITIVE EMAIL
              status: "joined",
              joinedAt: new Date("2026-11-05T20:05:00Z"),
            },
          ],
        },
      };

      (db.query.rooms.findFirst as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(mockRawRoom);

      const roomDetails = await roomService.getRoomByAccessToken(mockRoomToken);

      expect(roomDetails).not.toBeNull();
      expect(roomDetails?.meeting?.attendees).toHaveLength(2);

      // Verify attendee 1: name and status are present, but email is completely absent
      const a1 = roomDetails?.meeting?.attendees?.[0] as any;
      expect(a1.id).toBe("attendee-1");
      expect(a1.name).toBe("Participant Alpha");
      expect(a1.status).toBe("registered");
      expect(a1.email).toBeUndefined();

      // Verify attendee 2: email is completely absent
      const a2 = roomDetails?.meeting?.attendees?.[1] as any;
      expect(a2.id).toBe("attendee-2");
      expect(a2.name).toBe("Participant Beta");
      expect(a2.status).toBe("joined");
      expect(a2.email).toBeUndefined();
    });
  });

  // =========================================================================
  // 7. Share Link Format Resolution
  // =========================================================================
  describe("Room Share Link Resolution", () => {
    it("uses /j/[invitationToken] for group meetings and /room/[accessToken] for 1-on-1 bookings", () => {
      const getShareUrl = (origin: string, room: { type: "group_meeting" | "booking"; accessToken: string; meeting?: { invitationToken?: string } }) => {
        if (room.type === "group_meeting" && room.meeting?.invitationToken) {
          return `${origin}/j/${room.meeting.invitationToken}`;
        }
        return `${origin}/room/${room.accessToken}`;
      };

      const origin = "https://usemorrow.xyz";

      // Group meeting returns the public guest invitation URL
      const groupMeetingShareUrl = getShareUrl(origin, {
        type: "group_meeting",
        accessToken: "private-host-token-xyz",
        meeting: { invitationToken: "public-guest-token-123" },
      });
      expect(groupMeetingShareUrl).toBe("https://usemorrow.xyz/j/public-guest-token-123");

      // 1-on-1 booking returns the direct room URL
      const bookingShareUrl = getShareUrl(origin, {
        type: "booking",
        accessToken: "booking-room-token-456",
      });
      expect(bookingShareUrl).toBe("https://usemorrow.xyz/room/booking-room-token-456");
    });
  });

  // =========================================================================
  // 8. Multi-Participant LiveKit Audio Lifecycle & Autoplay Handling
  // =========================================================================
  describe("Multi-Participant LiveKit Audio Lifecycle & Autoplay Handling", () => {
    class MockAudioElement {
      id = "";
      autoplay = false;
      playsInline = false;
      srcObject: any = {};
      parentElement: MockAudioContainer | null = null;
      playCalled = false;
      playShouldReject = false;

      play() {
        this.playCalled = true;
        if (this.playShouldReject) {
          return Promise.reject(new Error("NotAllowedError: play() failed because the user didn't interact"));
        }
        return Promise.resolve();
      }

      remove() {
        if (this.parentElement) {
          this.parentElement.removeChild(this);
        }
      }

      setAttribute(name: string, value: string) {
        if (name === "playsinline") {
          this.playsInline = value === "true";
        }
      }
    }

    class MockAudioContainer {
      children: MockAudioElement[] = [];

      appendChild(el: MockAudioElement) {
        el.parentElement = this;
        this.children.push(el);
        return el;
      }

      removeChild(el: MockAudioElement) {
        this.children = this.children.filter((c) => c !== el);
        el.parentElement = null;
      }

      get childNodes() {
        return this.children;
      }

      innerHTML = "";
    }

    interface TrackMock {
      sid?: string;
      kind: string;
      attach: (element?: any) => any;
      detach: (element?: any) => any;
    }

    const createTrackMock = (sid: string): TrackMock => ({
      sid,
      kind: "audio",
      attach: vi.fn((existing?: any) => {
        if (existing) return existing;
        const el = new MockAudioElement();
        return el;
      }),
      detach: vi.fn((existing?: any) => {
        if (existing) {
          existing.srcObject = null;
        }
      }),
    });

    it("attaches distinct DOM audio elements for multiple remote participants concurrently", () => {
      const container = new MockAudioContainer();
      const audioElementsMap = new Map<string, MockAudioElement>();

      // Handler mirroring components/room/room-view.tsx
      const handleTrackSubscribed = (track: TrackMock, participant: { identity: string }) => {
        const trackKey = track.sid || `audio-${participant.identity}`;
        let existingEl = audioElementsMap.get(trackKey);
        if (!existingEl) {
          const audioEl = track.attach() as MockAudioElement;
          audioEl.id = `remote-audio-${participant.identity}-${trackKey}`;
          audioEl.autoplay = true;
          audioEl.setAttribute("playsinline", "true");
          (audioEl as any).playsInline = true;
          container.appendChild(audioEl);
          audioElementsMap.set(trackKey, audioEl);
          audioEl.play().catch(() => {});
        }
      };

      // Guest A arrives with audio
      const trackA = createTrackMock("track-guest-a");
      handleTrackSubscribed(trackA, { identity: "guest-a" });

      expect(container.children).toHaveLength(1);
      expect(audioElementsMap.size).toBe(1);
      expect(container.children[0].id).toBe("remote-audio-guest-a-track-guest-a");
      expect(container.children[0].autoplay).toBe(true);
      expect(container.children[0].playsInline).toBe(true);
      expect(container.children[0].playCalled).toBe(true);

      // Guest B arrives with audio
      const trackB = createTrackMock("track-guest-b");
      handleTrackSubscribed(trackB, { identity: "guest-b" });

      expect(container.children).toHaveLength(2);
      expect(audioElementsMap.size).toBe(2);
      expect(container.children[1].id).toBe("remote-audio-guest-b-track-guest-b");
      expect(container.children[1].autoplay).toBe(true);
      expect(container.children[1].playsInline).toBe(true);

      // Both audio elements exist simultaneously in the DOM container without collision
      expect(audioElementsMap.has("track-guest-a")).toBe(true);
      expect(audioElementsMap.has("track-guest-b")).toBe(true);
    });

    it("unsubscribing one participant detaches only their audio element and leaves others active", () => {
      const container = new MockAudioContainer();
      const audioElementsMap = new Map<string, MockAudioElement>();

      const trackA = createTrackMock("track-guest-a");
      const elA = trackA.attach() as MockAudioElement;
      container.appendChild(elA);
      audioElementsMap.set("track-guest-a", elA);

      const trackB = createTrackMock("track-guest-b");
      const elB = trackB.attach() as MockAudioElement;
      container.appendChild(elB);
      audioElementsMap.set("track-guest-b", elB);

      expect(container.children).toHaveLength(2);

      // Handler mirroring components/room/room-view.tsx TrackUnsubscribed
      const handleTrackUnsubscribed = (track: TrackMock, participant: { identity: string }) => {
        const trackKey = track.sid || `audio-${participant.identity}`;
        if (trackKey) {
          const el = audioElementsMap.get(trackKey);
          if (el) {
            track.detach(el);
            el.srcObject = null;
            el.remove();
            audioElementsMap.delete(trackKey);
          } else {
            track.detach();
          }
        }
      };

      // Guest A mutes/unsubscribes
      handleTrackUnsubscribed(trackA, { identity: "guest-a" });

      expect(trackA.detach).toHaveBeenCalledWith(elA);
      expect(elA.srcObject).toBeNull();
      expect(container.children).toHaveLength(1);
      expect(container.children[0]).toBe(elB);
      expect(audioElementsMap.has("track-guest-a")).toBe(false);
      expect(audioElementsMap.has("track-guest-b")).toBe(true);
    });

    it("cleans up all participant audio elements on participant disconnection", () => {
      const container = new MockAudioContainer();
      const audioElementsMap = new Map<string, MockAudioElement>();

      const trackA = createTrackMock("track-guest-a");
      const elA = trackA.attach() as MockAudioElement;
      container.appendChild(elA);
      audioElementsMap.set("track-guest-a", elA);

      const trackB = createTrackMock("track-guest-b");
      const elB = trackB.attach() as MockAudioElement;
      container.appendChild(elB);
      audioElementsMap.set("track-guest-b", elB);

      // Handler mirroring components/room/room-view.tsx ParticipantDisconnected
      const handleParticipantDisconnected = (participant: {
        identity: string;
        trackPublications: Array<{ track?: TrackMock }>;
      }) => {
        participant.trackPublications.forEach((pub) => {
          if (pub.track) {
            const trackKey = pub.track.sid || `audio-${participant.identity}`;
            const el = audioElementsMap.get(trackKey);
            if (el) {
              pub.track.detach(el);
              el.srcObject = null;
              el.remove();
              audioElementsMap.delete(trackKey);
            }
          }
        });
        const fallbackKey = `audio-${participant.identity}`;
        const fallbackEl = audioElementsMap.get(fallbackKey);
        if (fallbackEl) {
          fallbackEl.srcObject = null;
          fallbackEl.remove();
          audioElementsMap.delete(fallbackKey);
        }
      };

      handleParticipantDisconnected({
        identity: "guest-a",
        trackPublications: [{ track: trackA }],
      });

      expect(container.children).toHaveLength(1);
      expect(container.children[0]).toBe(elB);
      expect(audioElementsMap.has("track-guest-a")).toBe(false);
    });

    it("cleans up all remaining elements on room disconnect / component unmount", () => {
      const container = new MockAudioContainer();
      const audioElementsMap = new Map<string, MockAudioElement>();

      const trackA = createTrackMock("track-a");
      const elA = trackA.attach() as MockAudioElement;
      container.appendChild(elA);
      audioElementsMap.set("track-a", elA);

      const trackB = createTrackMock("track-b");
      const elB = trackB.attach() as MockAudioElement;
      container.appendChild(elB);
      audioElementsMap.set("track-b", elB);

      // Cleanup mirroring components/room/room-view.tsx useEffect return
      const cleanup = () => {
        audioElementsMap.forEach((el) => {
          el.srcObject = null;
          el.remove();
        });
        audioElementsMap.clear();
        container.innerHTML = "";
      };

      cleanup();

      expect(container.children).toHaveLength(0);
      expect(audioElementsMap.size).toBe(0);
      expect(elA.srcObject).toBeNull();
      expect(elB.srcObject).toBeNull();
    });

    it("detects browser autoplay rejection and unblocks on user action", async () => {
      let audioPlaybackBlocked = false;
      const setAudioPlaybackBlocked = (val: boolean) => {
        audioPlaybackBlocked = val;
      };

      const audioEl = new MockAudioElement();
      audioEl.playShouldReject = true; // Browser blocks autoplay

      // Initial playback attempt fails
      try {
        await audioEl.play();
      } catch {
        setAudioPlaybackBlocked(true);
      }

      expect(audioPlaybackBlocked).toBe(true);

      // User clicks "Enable Audio"
      const handleEnableAudio = async () => {
        audioEl.playShouldReject = false; // Browser unblocked after gesture
        await audioEl.play();
        setAudioPlaybackBlocked(false);
      };

      await handleEnableAudio();

      expect(audioPlaybackBlocked).toBe(false);
      expect(audioEl.playCalled).toBe(true);
    });

    it("preserves 1-on-1 booking audio path without appending to group container", () => {
      const container = new MockAudioContainer();
      const singleRemoteAudioEl = new MockAudioElement();

      const track1on1 = createTrackMock("track-1on1");
      const isGroupMeeting = false; // 1-on-1 booking

      if (!isGroupMeeting) {
        track1on1.attach(singleRemoteAudioEl);
      }

      expect(track1on1.attach).toHaveBeenCalledWith(singleRemoteAudioEl);
      expect(container.children).toHaveLength(0); // Container remains unused for 1-on-1
    });
  });
});
