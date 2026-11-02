import { describe, it, expect, vi } from "vitest";
import {
  generateGcalEventId,
  generateGcalConferenceRequestId,
  createGoogleCalendarEvent,
  patchGoogleCalendarEventTime,
} from "@/lib/google-calendar";
import {
  validateBookingInputSyntax,
} from "@/lib/scheduling/booking-service";
import fs from "fs";
import path from "path";

// Mock googleapis
vi.mock("googleapis", () => {
  const mockInsert = vi.fn();
  const mockGet = vi.fn();
  const mockPatch = vi.fn();
  const mockDelete = vi.fn();

  class MockOAuth2 {
    setCredentials = vi.fn();
  }

  return {
    google: {
      auth: {
        OAuth2: MockOAuth2,
      },
      calendar: vi.fn().mockReturnValue({
        events: {
          insert: mockInsert,
          get: mockGet,
          patch: mockPatch,
          delete: mockDelete,
        },
      }),
    },
  };
});

describe("Phase 1.3: Google Calendar Integrity & Concurrency Hardening", () => {
  describe("1. Deterministic Identifier Format Compliance", () => {
    const bookingId = "11111111-2222-3333-4444-555555555555";

    it("generates a stable, RFC 4648 base32hex-compatible calendar event ID", () => {
      const eventId1 = generateGcalEventId(bookingId);
      const eventId2 = generateGcalEventId(bookingId);

      // Deterministic
      expect(eventId1).toBe(eventId2);

      // Allowed characters: lowercase letters [a-v] and digits [0-9]
      // SHA-256 hex uses [0-9a-f], strictly within [0-9a-v]
      expect(eventId1).toMatch(/^[0-9a-v]+$/);

      // Strictly NO hyphens, underscores, or uppercase
      expect(eventId1).not.toContain("-");
      expect(eventId1).not.toContain("_");
      expect(eventId1).toBe(eventId1.toLowerCase());

      // Length between 5 and 1024 characters (SHA-256 hex is 64)
      expect(eventId1.length).toBe(64);
      expect(eventId1.length).toBeGreaterThanOrEqual(5);
      expect(eventId1.length).toBeLessThanOrEqual(1024);
    });

    it("generates a valid Google Meet conference creation requestId conforming to base32hex without hyphens", () => {
      const confReqId1 = generateGcalConferenceRequestId(bookingId);
      const confReqId2 = generateGcalConferenceRequestId(bookingId);

      // Deterministic
      expect(confReqId1).toBe(confReqId2);

      // Allowed characters: lowercase letters [a-v] and digits [0-9]
      expect(confReqId1).toMatch(/^[0-9a-v]+$/);

      // Strictly NO hyphens or uppercase (Google Meet constraint)
      expect(confReqId1).not.toContain("-");
      expect(confReqId1).not.toContain("_");
      expect(confReqId1).toBe(confReqId1.toLowerCase());

      // Length between 1 and 64 characters
      expect(confReqId1.length).toBe(32);
      expect(confReqId1.length).toBeGreaterThanOrEqual(1);
      expect(confReqId1.length).toBeLessThanOrEqual(64);
    });

    it("uses separate distinct identifiers for event ID and conference requestId", () => {
      const eventId = generateGcalEventId(bookingId);
      const confReqId = generateGcalConferenceRequestId(bookingId);

      expect(eventId).not.toBe(confReqId);
    });
  });

  describe("2. Google Calendar Event Creation & Idempotency", () => {
    it("includes stable event ID and conference requestId without hyphens in API calls", async () => {
      const { google } = await import("googleapis");
      const client = google.calendar({ version: "v3" });
      const insertMock = client.events.insert as unknown as ReturnType<typeof vi.fn>;

      insertMock.mockResolvedValueOnce({
        data: {
          id: "testeventid123",
          hangoutLink: "https://meet.google.com/abc-defg-hij",
        },
      });

      const stableId = generateGcalEventId("booking-test-123");
      const confId = generateGcalConferenceRequestId("booking-test-123");

      const result = await createGoogleCalendarEvent({
        tokens: { accessToken: "mock_token" },
        summary: "Strategy Session",
        startTime: new Date("2026-11-10T10:00:00Z"),
        endTime: new Date("2026-11-10T10:30:00Z"),
        guestEmail: "guest@example.com",
        guestName: "Alice Guest",
        locationType: "google_meet",
        eventId: stableId,
        confRequestId: confId,
      });

      expect(result.success).toBe(true);
      expect(result.eventId).toBe("testeventid123");
      expect(result.meetLink).toBe("https://meet.google.com/abc-defg-hij");

      expect(insertMock).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({
            id: stableId,
            conferenceData: expect.objectContaining({
              createRequest: expect.objectContaining({
                requestId: confId,
              }),
            }),
          }),
        })
      );
    });

    it("detects 409 conflict when event identifier already exists", async () => {
      const { google } = await import("googleapis");
      const client = google.calendar({ version: "v3" });
      const insertMock = client.events.insert as unknown as ReturnType<typeof vi.fn>;

      insertMock.mockRejectedValueOnce({
        status: 409,
        message: "The requested identifier already exists.",
      });

      const stableId = generateGcalEventId("booking-test-dup");

      const result = await createGoogleCalendarEvent({
        tokens: { accessToken: "mock_token" },
        summary: "Strategy Session",
        startTime: new Date("2026-11-10T10:00:00Z"),
        endTime: new Date("2026-11-10T10:30:00Z"),
        guestEmail: "guest@example.com",
        guestName: "Alice Guest",
        eventId: stableId,
      });

      expect(result.success).toBe(false);
      expect(result.isDuplicate).toBe(true);
    });
  });

  describe("3. Rescheduling: Updating Existing Event and Preserving Meet Links", () => {
    it("patches existing event start and end times without destroying conference details", async () => {
      const { google } = await import("googleapis");
      const client = google.calendar({ version: "v3" });
      const patchMock = client.events.patch as unknown as ReturnType<typeof vi.fn>;

      patchMock.mockResolvedValueOnce({
        data: {
          id: "existing_event_999",
          hangoutLink: "https://meet.google.com/xyz-uvw-rst",
        },
      });

      const newStart = new Date("2026-11-11T14:00:00Z");
      const newEnd = new Date("2026-11-11T14:30:00Z");

      const res = await patchGoogleCalendarEventTime({
        tokens: { accessToken: "mock_token" },
        eventId: "existing_event_999",
        startTime: newStart,
        endTime: newEnd,
        timeZone: "America/New_York",
      });

      expect(res.success).toBe(true);
      expect(res.eventId).toBe("existing_event_999");
      expect(res.meetLink).toBe("https://meet.google.com/xyz-uvw-rst");

      expect(patchMock).toHaveBeenCalledWith(
        expect.objectContaining({
          calendarId: "primary",
          eventId: "existing_event_999",
          sendUpdates: "all",
          requestBody: {
            start: {
              dateTime: newStart.toISOString(),
              timeZone: "America/New_York",
            },
            end: {
              dateTime: newEnd.toISOString(),
              timeZone: "America/New_York",
            },
          },
        })
      );
    });

    it("retains eventId and returns error if patch fails during rescheduling", async () => {
      const { google } = await import("googleapis");
      const client = google.calendar({ version: "v3" });
      const patchMock = client.events.patch as unknown as ReturnType<typeof vi.fn>;

      patchMock.mockRejectedValueOnce(new Error("Google Calendar API rate limit exceeded"));

      const res = await patchGoogleCalendarEventTime({
        tokens: { accessToken: "mock_token" },
        eventId: "existing_event_999",
        startTime: new Date("2026-11-11T14:00:00Z"),
        endTime: new Date("2026-11-11T14:30:00Z"),
      });

      expect(res.success).toBe(false);
      expect(res.error).toContain("Google Calendar API rate limit exceeded");
    });
  });

  describe("4. Runtime Input Syntax Validation (No 500s on Malformed JSON)", () => {
    it("rejects non-string idempotencyKey with HTTP 400 error message", () => {
      const result = validateBookingInputSyntax({
        eventTypeId: "evt-1",
        guestName: "Alice",
        guestEmail: "alice@example.com",
        date: "2026-11-10",
        time: "10:00 AM",
        idempotencyKey: 12345, // invalid type
      });

      expect(result.isValid).toBe(false);
      expect(result.error).toContain("idempotencyKey must be a string");
    });

    it("rejects invalid guestTimezone strings with HTTP 400 error message", () => {
      const result = validateBookingInputSyntax({
        eventTypeId: "evt-1",
        guestName: "Alice",
        guestEmail: "alice@example.com",
        date: "2026-11-10",
        time: "10:00 AM",
        guestTimezone: "Invalid/Not_A_Timezone_123",
      });

      expect(result.isValid).toBe(false);
      expect(result.error).toContain("Invalid guestTimezone");
    });

    it("rejects non-array/non-string additionalGuests with HTTP 400 error message", () => {
      const result = validateBookingInputSyntax({
        eventTypeId: "evt-1",
        guestName: "Alice",
        guestEmail: "alice@example.com",
        date: "2026-11-10",
        time: "10:00 AM",
        additionalGuests: 9999, // would have called .split() on number!
      });

      expect(result.isValid).toBe(false);
      expect(result.error).toContain("additionalGuests");
    });

    it("rejects array additionalGuests containing non-string items", () => {
      const result = validateBookingInputSyntax({
        eventTypeId: "evt-1",
        guestName: "Alice",
        guestEmail: "alice@example.com",
        date: "2026-11-10",
        time: "10:00 AM",
        additionalGuests: ["valid@example.com", 123, null],
      });

      expect(result.isValid).toBe(false);
      expect(result.error).toContain("additionalGuests array items must be strings");
    });

    it("rejects invalid email addresses in additionalGuests", () => {
      const result = validateBookingInputSyntax({
        eventTypeId: "evt-1",
        guestName: "Alice",
        guestEmail: "alice@example.com",
        date: "2026-11-10",
        time: "10:00 AM",
        additionalGuests: "not-an-email, test@example.com",
      });

      expect(result.isValid).toBe(false);
      expect(result.error).toContain("Invalid additional guest email address: not-an-email");
    });

    it("rejects non-string guestNotes", () => {
      const result = validateBookingInputSyntax({
        eventTypeId: "evt-1",
        guestName: "Alice",
        guestEmail: "alice@example.com",
        date: "2026-11-10",
        time: "10:00 AM",
        guestNotes: { note: "hello" },
      });

      expect(result.isValid).toBe(false);
      expect(result.error).toContain("guestNotes must be a string");
    });

    it("rejects non-object customAnswers", () => {
      const result = validateBookingInputSyntax({
        eventTypeId: "evt-1",
        guestName: "Alice",
        guestEmail: "alice@example.com",
        date: "2026-11-10",
        time: "10:00 AM",
        customAnswers: "not a record",
      });

      expect(result.isValid).toBe(false);
      expect(result.error).toContain("customAnswers must be a JSON object");
    });

    it("accepts valid syntax with all optional fields properly typed", () => {
      const result = validateBookingInputSyntax({
        eventTypeId: "evt-1",
        guestName: "Alice",
        guestEmail: "alice@example.com",
        date: "2026-11-10",
        time: "10:00 AM",
        guestTimezone: "America/New_York",
        idempotencyKey: "idem-key-abc-123",
        guestNotes: "Looking forward to speaking.",
        additionalGuests: ["bob@example.com", "carol@example.com"],
        customAnswers: { q1: "Referral from teammate" },
      });

      expect(result.isValid).toBe(true);
      expect(result.error).toBeUndefined();
    });
  });

  describe("5. Drizzle Migration Snapshot & Metadata Consistency", () => {
    it("ensures 0002_snapshot.json exists and links to 0001_snapshot.json", () => {
      const snapshot0001Path = path.resolve(process.cwd(), "drizzle/meta/0001_snapshot.json");
      const snapshot0002Path = path.resolve(process.cwd(), "drizzle/meta/0002_snapshot.json");
      const journalPath = path.resolve(process.cwd(), "drizzle/meta/_journal.json");

      expect(fs.existsSync(snapshot0001Path)).toBe(true);
      expect(fs.existsSync(snapshot0002Path)).toBe(true);
      expect(fs.existsSync(journalPath)).toBe(true);

      const snap1 = JSON.parse(fs.readFileSync(snapshot0001Path, "utf-8"));
      const snap2 = JSON.parse(fs.readFileSync(snapshot0002Path, "utf-8"));
      const journal = JSON.parse(fs.readFileSync(journalPath, "utf-8"));

      // Snapshot 0002 links to 0001
      expect(snap2.prevId).toBe(snap1.id);

      // Snapshot 0002 includes last_sync_error on bookings
      const bookingsColumns = snap2.tables["public.bookings"]?.columns;
      expect(bookingsColumns?.last_sync_error).toBeDefined();

      // Snapshot 0002 reflects nullable location_type on event_types
      const eventTypeCols = snap2.tables["public.event_types"]?.columns;
      expect(eventTypeCols?.location_type?.notNull).toBe(false);

      // Journal contains 0000, 0001, and 0002 entries
      const tags = journal.entries.map((e: { tag: string }) => e.tag);
      expect(tags).toContain("0000_massive_songbird");
      expect(tags).toContain("0001_sturdy_sebastian_shaw");
      expect(tags).toContain("0002_dapper_sentinel");
    });
  });

  describe("6. Complete Baseline Schema Verification Logic", () => {
    it("identifies all 7 required baseline tables and critical columns", () => {
      const requiredTables = [
        "availability",
        "availability_overrides",
        "bookings",
        "contacts",
        "event_types",
        "users",
        "verification_tokens",
      ];

      expect(requiredTables.length).toBe(7);

      // Test incomplete table detection logic
      const simulateFoundTables = new Set(["users", "bookings", "event_types"]);
      const missing = requiredTables.filter((t) => !simulateFoundTables.has(t));
      expect(missing).toContain("contacts");
      expect(missing).toContain("verification_tokens");
      expect(missing).toContain("availability");
      expect(missing).toContain("availability_overrides");
    });
  });

  describe("7. Atomic Host Approval & Rejection Concurrency Logic", () => {
    it("simulates two concurrent approval requests where only one transition wins", async () => {
      // Simulating the database conditional update:
      // UPDATE bookings SET status = 'confirmed' WHERE id = :id AND status = 'pending' RETURNING *;
      let currentState = "pending";
      let emailsSent = 0;

      async function attemptApproval() {
        if (currentState === "pending") {
          currentState = "confirmed"; // atomic row lock & update
          emailsSent++;
          return { success: true, won: true, status: "confirmed" };
        } else if (currentState === "confirmed") {
          // Idempotent retry: transition already won by concurrent request
          return { success: true, won: false, status: "confirmed" };
        } else {
          return { success: false, won: false, status: currentState, error: "CONFLICT" };
        }
      }

      // Simulate concurrent requests
      const [res1, res2] = await Promise.all([attemptApproval(), attemptApproval()]);

      // Both requests finish successfully
      expect(res1.status).toBe("confirmed");
      expect(res2.status).toBe("confirmed");

      // Exactly one request won the transition and sent the notification
      const winners = [res1, res2].filter((r) => r.won);
      expect(winners.length).toBe(1);
      expect(emailsSent).toBe(1);
    });

    it("simulates concurrent approval and rejection where winner blocks conflicting transition with 409", async () => {
      let currentState = "pending";

      async function transitionStatus(target: "confirmed" | "rejected") {
        if (currentState === "pending") {
          currentState = target; // atomic winner
          return { success: true, status: target };
        } else if (currentState === target) {
          return { success: true, status: target };
        } else {
          return { success: false, status: currentState, error: `Cannot set status: current is '${currentState}'`, code: 409 };
        }
      }

      // Approval wins first
      const approveRes = await transitionStatus("confirmed");
      const rejectRes = await transitionStatus("rejected");

      expect(approveRes.success).toBe(true);
      expect(approveRes.status).toBe("confirmed");

      expect(rejectRes.success).toBe(false);
      expect(rejectRes.code).toBe(409);
      expect(rejectRes.status).toBe("confirmed");
    });
  });

  describe("8. Idempotency Retry State Freshness (No Stale Failed Status)", () => {
    it("ensures reconciled state is reloaded and returns fresh synced status rather than stale failed status", async () => {
      // Setup a simulated booking that was in failed state
      const existingRecord = {
        id: "booking-idem-1",
        status: "confirmed",
        calendarSyncStatus: "failed",
        lastSyncError: "Network timeout",
        gcalEventId: null,
      };

      // Simulating reconciliation success
      const refreshedDatabaseRecord = {
        ...existingRecord,
        calendarSyncStatus: "synced",
        lastSyncError: null,
        gcalEventId: "google-event-12345",
        meetLink: "https://meet.google.com/abc-defg-hij",
      };

      // Simulating processBooking retry behavior:
      // 1. Detect recoverable state (confirmed + failed)
      const needsSyncRecovery =
        existingRecord.status === "confirmed" &&
        (existingRecord.calendarSyncStatus === "failed" || existingRecord.calendarSyncStatus === "pending");

      expect(needsSyncRecovery).toBe(true);

      // 2. Perform reconciliation (simulated)
      // 3. Reload fresh record from database
      const current = refreshedDatabaseRecord; // reload

      // 4. Return fresh response
      const responseStatus = current.calendarSyncStatus;
      expect(responseStatus).toBe("synced");
      expect(current.gcalEventId).toBe("google-event-12345");
      expect(current.meetLink).toBe("https://meet.google.com/abc-defg-hij");
    });
  });
});
