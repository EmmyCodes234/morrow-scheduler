import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import {
  isMeetingCallOpen,
  hashInvitationToken,
  DEFAULT_EARLY_ACCESS_MINUTES,
} from "@/lib/meetings/meeting-service";
import * as livekitRoute from "@/app/api/room/[token]/livekit/route";
import * as openEarlyRoute from "@/app/api/room/[token]/open-early/route";
import * as roomService from "@/lib/room/room-service";
import * as meetingService from "@/lib/meetings/meeting-service";
import * as authModule from "@/auth";

// Mock dependencies
vi.mock("@/auth", () => ({
  auth: vi.fn(),
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
});
