import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import * as livekitRoute from "@/app/api/room/[token]/livekit/route";
import * as roomRoute from "@/app/api/room/[token]/route";
import * as roomService from "@/lib/room/room-service";
import * as authModule from "@/auth";

// Setup mocks
vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

describe("Morrow Rooms — Participant Identity, Authorization & Lifecycle Security", () => {
  const mockHostId = "user-host-111";
  const mockUnrelatedUserId = "user-intruder-999";
  const mockBookingId = "booking-222";
  const mockToken = "token-valid-room-333";

  const createMockRoom = (bookingStatus = "confirmed", roomStatus = "pre_meeting") => ({
    id: "room-uuid-444",
    accessToken: mockToken,
    status: roomStatus as "pre_meeting" | "in_progress" | "concluded",
    booking: {
      id: mockBookingId,
      status: bookingStatus,
      startTime: new Date("2026-11-10T10:00:00Z").toISOString(),
      endTime: new Date("2026-11-10T10:30:00Z").toISOString(),
      eventTitle: "Strategy Call",
      durationMins: 30,
      host: {
        id: mockHostId,
        name: "Enyi Emmanuel",
        slug: "enyi-emmanuel",
        avatarUrl: null,
        timezone: "UTC",
      },
      guest: {
        name: "Lito Enyi",
        timezone: "Africa/Lagos",
        notes: "Discuss Morrow integration",
      },
    },
    agenda: [{ id: "ag-1", text: "Introduction", done: false, addedBy: "vera" as const }],
    sharedNotes: "Initial notes",
    files: [],
    veraBrief: { intent: "Strategy", talkingPoints: ["Point 1"] },
    veraLedger: roomStatus === "concluded" ? { executiveSummary: ["Finished call"], actionItems: [] } : null,
  });

  beforeEach(() => {
    process.env.LIVEKIT_API_KEY = "test-api-key";
    process.env.LIVEKIT_API_SECRET = "test-api-secret-123456789012345678901234567890";
    process.env.LIVEKIT_URL = "wss://test.livekit.cloud";
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // 1. Participant Identity Derivation & LiveKit Token Issuance
  // =========================================================================
  describe("Server-Authoritative Participant Identity", () => {
    it("assigns Host role to the authenticated booking owner", async () => {
      vi.spyOn(authModule, "auth").mockResolvedValue({
        user: { id: mockHostId, name: "Enyi Emmanuel" },
      } as any);

      vi.spyOn(roomService, "getRoomByAccessToken").mockResolvedValue(createMockRoom() as any);

      const req = new NextRequest(`http://localhost:3000/api/room/${mockToken}/livekit`, {
        method: "POST",
      });

      const res = await livekitRoute.POST(req, {
        params: Promise.resolve({ token: mockToken }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.role).toBe("host");
      expect(data.participantName).toBe("Enyi Emmanuel");

      // Verify JWT payload
      const payload = JSON.parse(Buffer.from(data.token.split(".")[1], "base64url").toString("utf8"));
      expect(payload.sub).toContain(`host-${mockHostId}`);
      expect(payload.name).toBe("Enyi Emmanuel");
      expect(payload.video.canPublish).toBe(true);
      expect(payload.video.canPublishData).toBe(true);
      expect(payload.video.roomAdmin).toBeUndefined();
    });

    it("assigns Guest role to an anonymous participant without host session", async () => {
      vi.spyOn(authModule, "auth").mockResolvedValue(null as any);
      vi.spyOn(roomService, "getRoomByAccessToken").mockResolvedValue(createMockRoom() as any);

      const req = new NextRequest(`http://localhost:3000/api/room/${mockToken}/livekit`, {
        method: "POST",
      });

      const res = await livekitRoute.POST(req, {
        params: Promise.resolve({ token: mockToken }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.role).toBe("guest");
      expect(data.participantName).toBe("Lito Enyi");

      const payload = JSON.parse(Buffer.from(data.token.split(".")[1], "base64url").toString("utf8"));
      expect(payload.sub).toContain(`guest-${mockBookingId}`);
      expect(payload.name).toBe("Lito Enyi");
      expect(payload.video.roomAdmin).toBeUndefined();
    });

    it("assigns Guest role to an authenticated user who is NOT the booking owner", async () => {
      vi.spyOn(authModule, "auth").mockResolvedValue({
        user: { id: mockUnrelatedUserId, name: "Intruder User" },
      } as any);
      vi.spyOn(roomService, "getRoomByAccessToken").mockResolvedValue(createMockRoom() as any);

      const req = new NextRequest(`http://localhost:3000/api/room/${mockToken}/livekit`, {
        method: "POST",
      });

      const res = await livekitRoute.POST(req, {
        params: Promise.resolve({ token: mockToken }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.role).toBe("guest");
      expect(data.participantName).toBe("Lito Enyi");
    });

    it("rejects client attempts to spoof role or name via request body", async () => {
      vi.spyOn(authModule, "auth").mockResolvedValue(null as any);
      vi.spyOn(roomService, "getRoomByAccessToken").mockResolvedValue(createMockRoom() as any);

      const req = new NextRequest(`http://localhost:3000/api/room/${mockToken}/livekit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role: "host",
          participantName: "Enyi Emmanuel (Spoofed)",
        }),
      });

      const res = await livekitRoute.POST(req, {
        params: Promise.resolve({ token: mockToken }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      // Server overrides client input completely
      expect(data.role).toBe("guest");
      expect(data.participantName).toBe("Lito Enyi");
    });

    it("disallows insecure legacy GET token-minting requests with 405 Method Not Allowed", async () => {
      const res = await livekitRoute.GET();
      expect(res.status).toBe(405);
      const data = await res.json();
      expect(data.error).toContain("Method not allowed");
    });
  });

  // =========================================================================
  // 2. Booking Eligibility Enforcement Before Token Issuance
  // =========================================================================
  describe("Booking Eligibility Restrictions", () => {
    it("denies LiveKit token for cancelled bookings (HTTP 403)", async () => {
      vi.spyOn(authModule, "auth").mockResolvedValue(null as any);
      vi.spyOn(roomService, "getRoomByAccessToken").mockResolvedValue(createMockRoom("cancelled") as any);

      const req = new NextRequest(`http://localhost:3000/api/room/${mockToken}/livekit`, {
        method: "POST",
      });

      const res = await livekitRoute.POST(req, {
        params: Promise.resolve({ token: mockToken }),
      });

      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toBe("Booking has been cancelled");
    });

    it("denies LiveKit token for rejected bookings (HTTP 403)", async () => {
      vi.spyOn(authModule, "auth").mockResolvedValue(null as any);
      vi.spyOn(roomService, "getRoomByAccessToken").mockResolvedValue(createMockRoom("rejected") as any);

      const req = new NextRequest(`http://localhost:3000/api/room/${mockToken}/livekit`, {
        method: "POST",
      });

      const res = await livekitRoute.POST(req, {
        params: Promise.resolve({ token: mockToken }),
      });

      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toBe("Booking was declined");
    });

    it("denies LiveKit token for pending bookings (HTTP 403)", async () => {
      vi.spyOn(authModule, "auth").mockResolvedValue(null as any);
      vi.spyOn(roomService, "getRoomByAccessToken").mockResolvedValue(createMockRoom("pending") as any);

      const req = new NextRequest(`http://localhost:3000/api/room/${mockToken}/livekit`, {
        method: "POST",
      });

      const res = await livekitRoute.POST(req, {
        params: Promise.resolve({ token: mockToken }),
      });

      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toBe("Booking is pending approval");
    });

    it("denies LiveKit token when room is already concluded (HTTP 403)", async () => {
      vi.spyOn(authModule, "auth").mockResolvedValue(null as any);
      vi.spyOn(roomService, "getRoomByAccessToken").mockResolvedValue(createMockRoom("confirmed", "concluded") as any);

      const req = new NextRequest(`http://localhost:3000/api/room/${mockToken}/livekit`, {
        method: "POST",
      });

      const res = await livekitRoute.POST(req, {
        params: Promise.resolve({ token: mockToken }),
      });

      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toBe("Meeting has concluded");
    });
  });

  // =========================================================================
  // 3. Room Mutation & Conclusion Authorization
  // =========================================================================
  describe("Room Mutation and Host-Only Conclusion", () => {
    it("prohibits anonymous guests from concluding the room (HTTP 403)", async () => {
      vi.spyOn(authModule, "auth").mockResolvedValue(null as any);
      vi.spyOn(roomService, "getRoomByAccessToken").mockResolvedValue(createMockRoom() as any);

      const req = new NextRequest(`http://localhost:3000/api/room/${mockToken}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "conclude" }),
      });

      const res = await roomRoute.PATCH(req, {
        params: Promise.resolve({ token: mockToken }),
      });

      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toContain("Forbidden: Only the authenticated meeting host can conclude");
    });

    it("prohibits unrelated authenticated users from concluding the room (HTTP 403)", async () => {
      vi.spyOn(authModule, "auth").mockResolvedValue({
        user: { id: mockUnrelatedUserId },
      } as any);
      vi.spyOn(roomService, "getRoomByAccessToken").mockResolvedValue(createMockRoom() as any);

      const req = new NextRequest(`http://localhost:3000/api/room/${mockToken}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "conclude" }),
      });

      const res = await roomRoute.PATCH(req, {
        params: Promise.resolve({ token: mockToken }),
      });

      expect(res.status).toBe(403);
    });

    it("permits authenticated host to conclude the room", async () => {
      vi.spyOn(authModule, "auth").mockResolvedValue({
        user: { id: mockHostId },
      } as any);
      vi.spyOn(roomService, "getRoomByAccessToken").mockResolvedValue(createMockRoom() as any);
      vi.spyOn(roomService, "concludeRoomAndSynthesize").mockResolvedValue({
        success: true,
        status: "concluded",
        veraLedger: { executiveSummary: ["Success"], actionItems: [] },
      } as any);

      const req = new NextRequest(`http://localhost:3000/api/room/${mockToken}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "conclude" }),
      });

      const res = await roomRoute.PATCH(req, {
        params: Promise.resolve({ token: mockToken }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.status).toBe("concluded");
    });

    it("makes repeated conclusion requests idempotent without duplicate synthesis", async () => {
      vi.spyOn(authModule, "auth").mockResolvedValue({
        user: { id: mockHostId },
      } as any);
      const concludedRoom = createMockRoom("confirmed", "concluded");
      vi.spyOn(roomService, "getRoomByAccessToken").mockResolvedValue(concludedRoom as any);
      const synthesizeSpy = vi.spyOn(roomService, "concludeRoomAndSynthesize");

      const req = new NextRequest(`http://localhost:3000/api/room/${mockToken}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "conclude" }),
      });

      const res = await roomRoute.PATCH(req, {
        params: Promise.resolve({ token: mockToken }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.status).toBe("concluded");
      expect(synthesizeSpy).not.toHaveBeenCalled();
    });

    it("blocks collaboration mutations on a concluded room (HTTP 409)", async () => {
      vi.spyOn(roomService, "getRoomByAccessToken").mockResolvedValue(createMockRoom("confirmed", "concluded") as any);

      const req = new NextRequest(`http://localhost:3000/api/room/${mockToken}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: "Late edit attempt" }),
      });

      const res = await roomRoute.PATCH(req, {
        params: Promise.resolve({ token: mockToken }),
      });

      expect(res.status).toBe(409);
      const data = await res.json();
      expect(data.error).toContain("This room has been concluded and cannot be edited");
    });

    it("blocks collaboration mutations on a cancelled booking (HTTP 403)", async () => {
      vi.spyOn(roomService, "getRoomByAccessToken").mockResolvedValue(createMockRoom("cancelled") as any);

      const req = new NextRequest(`http://localhost:3000/api/room/${mockToken}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: "Cancelled edit" }),
      });

      const res = await roomRoute.PATCH(req, {
        params: Promise.resolve({ token: mockToken }),
      });

      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toContain("Cannot modify room for a cancelled booking");
    });

    it("allows collaborative note updates for valid access token on active room", async () => {
      vi.spyOn(roomService, "getRoomByAccessToken").mockResolvedValue(createMockRoom() as any);
      const updateNotesSpy = vi.spyOn(roomService, "updateRoomNotes").mockResolvedValue(true);

      const req = new NextRequest(`http://localhost:3000/api/room/${mockToken}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: "New collaborative notes" }),
      });

      const res = await roomRoute.PATCH(req, {
        params: Promise.resolve({ token: mockToken }),
      });

      expect(res.status).toBe(200);
      expect(updateNotesSpy).toHaveBeenCalledWith(mockToken, "New collaborative notes");
    });
    it("returns 202 Accepted when a concurrent host request encounters synthesis already in progress", async () => {
      vi.spyOn(authModule, "auth").mockResolvedValue({
        user: { id: mockHostId },
      } as any);
      vi.spyOn(roomService, "getRoomByAccessToken").mockResolvedValue(createMockRoom() as any);
      vi.spyOn(roomService, "concludeRoomAndSynthesize").mockResolvedValue({
        success: true,
        status: "synthesizing",
        processing: true,
        message: "Vera summary synthesis is currently in progress.",
      });

      const req = new NextRequest(`http://localhost:3000/api/room/${mockToken}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "conclude" }),
      });

      const res = await roomRoute.PATCH(req, {
        params: Promise.resolve({ token: mockToken }),
      });

      expect(res.status).toBe(202);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.status).toBe("synthesizing");
      expect(data.processing).toBe(true);
    });

    it("returns HTTP 500 when synthesis fails, ensuring the room is not marked concluded", async () => {
      vi.spyOn(authModule, "auth").mockResolvedValue({
        user: { id: mockHostId },
      } as any);
      vi.spyOn(roomService, "getRoomByAccessToken").mockResolvedValue(createMockRoom() as any);
      vi.spyOn(roomService, "concludeRoomAndSynthesize").mockResolvedValue({
        success: false,
        status: "failed",
        error: "DeepSeek API rate limit reached",
      });

      const req = new NextRequest(`http://localhost:3000/api/room/${mockToken}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "conclude" }),
      });

      const res = await roomRoute.PATCH(req, {
        params: Promise.resolve({ token: mockToken }),
      });

      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe("DeepSeek API rate limit reached");
    });

    it("returns HTTP 409 Conflict when a stale worker attempt is detected", async () => {
      vi.spyOn(authModule, "auth").mockResolvedValue({
        user: { id: mockHostId },
      } as any);
      vi.spyOn(roomService, "getRoomByAccessToken").mockResolvedValue(createMockRoom() as any);
      vi.spyOn(roomService, "concludeRoomAndSynthesize").mockResolvedValue({
        success: false,
        status: "stale_worker",
        error: "Synthesis completed but lease had expired.",
      });

      const req = new NextRequest(`http://localhost:3000/api/room/${mockToken}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "conclude" }),
      });

      const res = await roomRoute.PATCH(req, {
        params: Promise.resolve({ token: mockToken }),
      });

      expect(res.status).toBe(409);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain("lease had expired");
    });

    it("returns HTTP 422 Unprocessable Entity when synthesis fails due to insufficient evidence", async () => {
      vi.spyOn(authModule, "auth").mockResolvedValue({
        user: { id: mockHostId },
      } as any);
      vi.spyOn(roomService, "getRoomByAccessToken").mockResolvedValue(createMockRoom() as any);
      vi.spyOn(roomService, "concludeRoomAndSynthesize").mockResolvedValue({
        success: false,
        status: "insufficient_evidence",
        error: "Vera needs actual meeting notes or a transcript before it can create a reliable meeting record. Add the missing context and try again.",
        code: "INSUFFICIENT_EVIDENCE",
      });

      const req = new NextRequest(`http://localhost:3000/api/room/${mockToken}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "conclude" }),
      });

      const res = await roomRoute.PATCH(req, {
        params: Promise.resolve({ token: mockToken }),
      });

      expect(res.status).toBe(422);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.status).toBe("insufficient_evidence");
      expect(data.error).toContain("Vera needs actual meeting notes or a transcript");
      expect(data.code).toBe("INSUFFICIENT_EVIDENCE");
    });
  });

  // =========================================================================
  // 4. Public DTO Data Protection Verification
  // =========================================================================
  describe("Public DTO Data Exposure Review", () => {
    it("ensures public room DTO does not leak host or guest private emails, synthesis tokens, or private errors", async () => {
      const room = {
        ...createMockRoom(),
        synthesisStatus: "idle",
      };
      vi.spyOn(roomService, "getRoomByAccessToken").mockResolvedValue(room as any);

      const req = new NextRequest(`http://localhost:3000/api/room/${mockToken}`, {
        method: "GET",
      });

      const res = await roomRoute.GET(req, {
        params: Promise.resolve({ token: mockToken }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.room.booking.host.email).toBeUndefined();
      expect(data.room.booking.guest.email).toBeUndefined();
      expect(data.room.booking.host.id).toBe(mockHostId);
      expect(data.room.booking.status).toBe("confirmed");
      // Check that internal claim token is never leaked
      expect(data.room.synthesisClaimToken).toBeUndefined();
      expect(data.room.synthesisLastError).toBeUndefined();
      expect(data.room.synthesisStatus).toBe("idle");
    });
  });

  // =========================================================================
  // 5. Meeting Record Review & Host Ledger Approval
  // =========================================================================
  describe("Meeting Record Review & Host Ledger Approval", () => {
    it("rejects ledger approval when caller is unauthenticated (HTTP 401)", async () => {
      vi.spyOn(authModule, "auth").mockResolvedValue(null as any);
      vi.spyOn(roomService, "getRoomByAccessToken").mockResolvedValue(createMockRoom("confirmed", "concluded") as any);

      const req = new NextRequest(`http://localhost:3000/api/room/${mockToken}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve_ledger" }),
      });

      const res = await roomRoute.PATCH(req, {
        params: Promise.resolve({ token: mockToken }),
      });

      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain("Unauthorized: You must be signed in");
    });

    it("rejects ledger approval when authenticated user is not the host (HTTP 403)", async () => {
      vi.spyOn(authModule, "auth").mockResolvedValue({
        user: { id: mockUnrelatedUserId },
      } as any);
      vi.spyOn(roomService, "getRoomByAccessToken").mockResolvedValue(createMockRoom("confirmed", "concluded") as any);

      const req = new NextRequest(`http://localhost:3000/api/room/${mockToken}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve_ledger" }),
      });

      const res = await roomRoute.PATCH(req, {
        params: Promise.resolve({ token: mockToken }),
      });

      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain("Forbidden: Only the authenticated meeting host");
    });

    it("allows the booking host to approve the ledger (HTTP 200)", async () => {
      vi.spyOn(authModule, "auth").mockResolvedValue({
        user: { id: mockHostId },
      } as any);
      vi.spyOn(roomService, "getRoomByAccessToken").mockResolvedValue(createMockRoom("confirmed", "concluded") as any);
      vi.spyOn(roomService, "approveRoomLedger").mockResolvedValue({
        success: true,
        status: "approved",
        veraLedger: {
          executiveSummary: [{ claim: "Finished call", evidence: "Finished call" }],
          actionItems: [],
          keyDecisions: [],
          reviewStatus: "approved",
          approvedBy: mockHostId,
          approvedAt: "2026-11-05T09:00:00.000Z",
        },
      });

      const req = new NextRequest(`http://localhost:3000/api/room/${mockToken}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve_ledger" }),
      });

      const res = await roomRoute.PATCH(req, {
        params: Promise.resolve({ token: mockToken }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.status).toBe("approved");
      expect(data.veraLedger.reviewStatus).toBe("approved");
      expect(data.veraLedger.approvedBy).toBe(mockHostId);
    });
  });
});
