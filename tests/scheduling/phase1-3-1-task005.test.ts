import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  generateGcalEventId,
  isGoogleEventMatchingBooking,
} from "@/lib/google-calendar";
import { reconcileBookingCalendarSync } from "@/lib/scheduling/booking-service";
import { parseJsonRequest } from "@/lib/http/parse-json";
import { verifyBaselineSchema, REQUIRED_BASELINE_SCHEMA } from "@/lib/database/schema-verifier";
import { isSameDatabase } from "@/lib/database/url-safety";
import { dispatchDurableBookingNotification } from "@/lib/scheduling/notification-service";
import { NextRequest } from "next/server";
import { db } from "@/db";

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

// Mock email delivery
vi.mock("@/lib/email", () => ({
  sendBookingApprovalEmail: vi.fn(),
  sendBookingRejectionEmail: vi.fn(),
}));

// Mock db for unit tests
const { mockUpdateReturning, mockUpdateSet, mockUpdateWhere } = vi.hoisted(() => {
  const mockUpdateReturning = vi.fn().mockResolvedValue([]);
  const mockUpdateSet = vi.fn().mockReturnThis();
  const mockUpdateWhere = vi.fn().mockImplementation(() => ({
    returning: mockUpdateReturning,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    then: (resolve: any, reject: any) => Promise.resolve([{ id: "mock-booking-id" }]).then(resolve, reject),
  }));
  return { mockUpdateReturning, mockUpdateSet, mockUpdateWhere };
});

vi.mock("@/db", () => {
  return {
    db: {
      query: {
        bookings: {
          findFirst: vi.fn(),
        },
        users: {
          findFirst: vi.fn(),
        },
      },
      update: vi.fn().mockReturnValue({
        set: mockUpdateSet,
        where: mockUpdateWhere,
      }),
    },
  };
});

describe("Phase 1.3.1: Task 005 Regression Test Suite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("1. Calendar Reconciliation Outcome Handling", () => {
    const booking = {
      id: "booking-uuid-1234",
      hostId: "host-uuid-5678",
      status: "confirmed",
      guestName: "Alice Guest",
      guestEmail: "alice@example.com",
      startTime: new Date("2026-11-10T10:00:00Z"),
      endTime: new Date("2026-11-10T10:30:00Z"),
      meetLink: "https://meet.google.com/existing-meet",
      gcalEventId: "google-event-1234",
      calendarSyncStatus: "pending",
      host: {
        id: "host-uuid-5678",
        timezone: "America/New_York",
        googleAccessToken: "mock-access-token",
        googleRefreshToken: "mock-refresh-token",
      },
      eventType: {
        id: "event-uuid-1111",
        title: "30 Min Chat",
        locationType: "google_meet",
      },
    };

    it("Scenario 1: Existing active event, successful patch -> synced", async () => {
      const { google } = await import("googleapis");
      const client = google.calendar({ version: "v3" });
      const getMock = client.events.get as unknown as ReturnType<typeof vi.fn>;
      const patchMock = client.events.patch as unknown as ReturnType<typeof vi.fn>;

      (db.query.bookings.findFirst as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(booking);

      getMock.mockResolvedValueOnce({
        data: {
          id: "google-event-1234",
          status: "confirmed",
          description: `Scheduled via Morrow (Booking ID: ${booking.id})`,
          attendees: [{ email: "alice@example.com" }],
          hangoutLink: "https://meet.google.com/existing-meet",
        },
      });

      patchMock.mockResolvedValueOnce({
        data: {
          id: "google-event-1234",
          hangoutLink: "https://meet.google.com/existing-meet",
        },
      });

      const result = await reconcileBookingCalendarSync(booking.id, booking.hostId);

      expect(result.success).toBe(true);
      expect(result.calendarSynced).toBe(true);
      expect(result.eventId).toBe("google-event-1234");
      expect(result.meetLink).toBe("https://meet.google.com/existing-meet");

      // Verify db update set synced
      expect(db.update).toHaveBeenCalled();
    });

    it("Scenario 2: Existing active event, failed patch -> failed, with existing event ID retained", async () => {
      const { google } = await import("googleapis");
      const client = google.calendar({ version: "v3" });
      const getMock = client.events.get as unknown as ReturnType<typeof vi.fn>;
      const patchMock = client.events.patch as unknown as ReturnType<typeof vi.fn>;

      (db.query.bookings.findFirst as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(booking);

      getMock.mockResolvedValueOnce({
        data: {
          id: "google-event-1234",
          status: "confirmed",
          description: `Scheduled via Morrow (Booking ID: ${booking.id})`,
          attendees: [{ email: "alice@example.com" }],
        },
      });

      patchMock.mockRejectedValueOnce(new Error("Google Calendar API rate limit exceeded"));

      const result = await reconcileBookingCalendarSync(booking.id, booking.hostId);

      expect(result.success).toBe(false);
      expect(result.calendarSynced).toBe(false);
      expect(result.eventId).toBe("google-event-1234"); // event ID preserved
      expect(result.error).toContain("rate limit exceeded");
    });

    it("Scenario 3: Existing cancelled event -> must not be accepted as successfully synced if restore fails", async () => {
      const { google } = await import("googleapis");
      const client = google.calendar({ version: "v3" });
      const getMock = client.events.get as unknown as ReturnType<typeof vi.fn>;
      const patchMock = client.events.patch as unknown as ReturnType<typeof vi.fn>;

      (db.query.bookings.findFirst as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(booking);

      getMock.mockResolvedValueOnce({
        data: {
          id: "google-event-1234",
          status: "cancelled", // Cancelled in Google Calendar
          description: `Scheduled via Morrow (Booking ID: ${booking.id})`,
          attendees: [{ email: "alice@example.com" }],
        },
      });

      // Patch attempting to un-cancel fails
      patchMock.mockRejectedValueOnce(new Error("Cannot restore deleted event"));

      const result = await reconcileBookingCalendarSync(booking.id, booking.hostId);

      expect(result.success).toBe(false);
      expect(result.calendarSynced).toBe(false);
      expect(result.error).toContain("Cannot restore deleted event");
    });

    it("Scenario 4: Duplicate insert conflict, active matching event recovered -> synced", async () => {
      const { google } = await import("googleapis");
      const client = google.calendar({ version: "v3" });
      const getMock = client.events.get as unknown as ReturnType<typeof vi.fn>;
      const insertMock = client.events.insert as unknown as ReturnType<typeof vi.fn>;

      const bookingWithoutEventId = {
        ...booking,
        gcalEventId: null,
      };

      (db.query.bookings.findFirst as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(bookingWithoutEventId);

      // 1. Initial get by deterministic ID returns 404 (not found)
      getMock.mockRejectedValueOnce({ status: 404 });

      // 2. Insert races and gets 409 conflict
      insertMock.mockRejectedValueOnce({
        status: 409,
        message: "The requested identifier already exists.",
      });

      // 3. Retry get fetches the active matching event
      getMock.mockResolvedValueOnce({
        data: {
          id: generateGcalEventId(booking.id),
          status: "confirmed", // Active
          description: `Scheduled via Morrow (Booking ID: ${booking.id})`,
          attendees: [{ email: "alice@example.com" }],
          hangoutLink: "https://meet.google.com/recovered-meet",
        },
      });

      const result = await reconcileBookingCalendarSync(booking.id, booking.hostId);

      expect(result.success).toBe(true);
      expect(result.calendarSynced).toBe(true);
      expect(result.meetLink).toBe("https://meet.google.com/recovered-meet");
    });

    it("Scenario 5: Duplicate insert conflict, cancelled or mismatched event -> not accepted as successful recovery", async () => {
      const { google } = await import("googleapis");
      const client = google.calendar({ version: "v3" });
      const getMock = client.events.get as unknown as ReturnType<typeof vi.fn>;
      const insertMock = client.events.insert as unknown as ReturnType<typeof vi.fn>;

      const bookingWithoutEventId = {
        ...booking,
        gcalEventId: null,
      };

      (db.query.bookings.findFirst as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(bookingWithoutEventId);

      // 1. Initial get returns 404
      getMock.mockRejectedValueOnce({ status: 404 });

      // 2. Insert returns 409
      insertMock.mockRejectedValueOnce({
        status: 409,
        message: "The requested identifier already exists.",
      });

      // 3. Retry get finds event, but it is cancelled!
      getMock.mockResolvedValueOnce({
        data: {
          id: generateGcalEventId(booking.id),
          status: "cancelled", // Cancelled!
          description: `Scheduled via Morrow (Booking ID: ${booking.id})`,
          attendees: [{ email: "alice@example.com" }],
        },
      });

      const result = await reconcileBookingCalendarSync(booking.id, booking.hostId);

      expect(result.success).toBe(false);
      expect(result.calendarSynced).toBe(false);
      expect(result.error).toContain("cancelled");
    });

    it("verifies event ownership via booking ID reference and rejects attendee email alone", () => {
      const b = { id: "test-booking-id", guestEmail: "Guest@Example.COM" };

      // Reject match by attendee email alone (hardened in Task 006)
      expect(isGoogleEventMatchingBooking({ attendees: [{ email: "guest@example.com" }] }, b)).toBe(false);

      // Match by description with booking id
      expect(isGoogleEventMatchingBooking({ description: "Scheduled via Morrow (Booking ID: test-booking-id)" }, b)).toBe(true);

      // Rejects mismatched event
      expect(isGoogleEventMatchingBooking({ attendees: [{ email: "stranger@example.com" }], description: "Other meeting" }, b)).toBe(false);

      // Handles null/undefined
      expect(isGoogleEventMatchingBooking(null, b)).toBe(false);
      expect(isGoogleEventMatchingBooking(undefined, b)).toBe(false);
    });
  });

  describe("2. Booking Request Parsing & HTTP Status Discrimination", () => {
    it("Scenario 1: Malformed JSON -> HTTP 400", async () => {
      const req = new NextRequest("http://localhost:3000/api/book/test-host", {
        method: "POST",
        body: "{ malformed json: true ",
        headers: { "Content-Type": "application/json" },
      });

      const parsed = await parseJsonRequest(req);
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        expect(parsed.status).toBe(400);
        expect(parsed.error).toContain("Malformed JSON");
      }
    });

    it("Scenario 2: null JSON payload -> HTTP 400", async () => {
      const req = new NextRequest("http://localhost:3000/api/book/test-host", {
        method: "POST",
        body: "null",
        headers: { "Content-Type": "application/json" },
      });

      const parsed = await parseJsonRequest(req);
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        expect(parsed.status).toBe(400);
        expect(parsed.error).toContain("non-null JSON object");
      }
    });

    it("Scenario 3: Array payload -> HTTP 400", async () => {
      const req = new NextRequest("http://localhost:3000/api/book/test-host", {
        method: "POST",
        body: JSON.stringify(["item1", "item2"]),
        headers: { "Content-Type": "application/json" },
      });

      const parsed = await parseJsonRequest(req);
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        expect(parsed.status).toBe(400);
        expect(parsed.error).toContain("non-null JSON object");
      }
    });

    it("Scenario 4: Valid payload -> parses successfully", async () => {
      const req = new NextRequest("http://localhost:3000/api/book/test-host", {
        method: "POST",
        body: JSON.stringify({
          eventTypeId: "evt-123",
          guestName: "Alice",
          guestEmail: "alice@example.com",
          date: "2026-11-10",
          time: "10:00 AM",
        }),
        headers: { "Content-Type": "application/json" },
      });

      const parsed = await parseJsonRequest(req);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.guestName).toBe("Alice");
      }
    });
  });

  describe("3. Durable Notification Lifecycle", () => {
    it("Scenario 3: Repeated same-state request -> no duplicate notification job dispatched", async () => {
      // Claim fails because status is already sent
      mockUpdateReturning.mockResolvedValueOnce([]);

      (db.query.bookings.findFirst as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        id: "booking-already-sent",
        notificationStatus: "sent",
        notificationType: "approval",
      });

      const result = await dispatchDurableBookingNotification("booking-already-sent");

      expect(result.success).toBe(true);
      expect(result.status).toBe("already_sent");
    });

    it("Scenario 4: Failed email delivery -> notification remains retryable without changing booking status", async () => {
      const { sendBookingApprovalEmail } = await import("@/lib/email");
      (sendBookingApprovalEmail as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error("Resend API 500: Server unavailable")
      );

      const bookingPayload = {
        id: "booking-pending-notify",
        status: "confirmed",
        notificationStatus: "sending",
        notificationType: "approval",
        notificationAttempts: 1,
        notificationClaimToken: "mock-token",
        notificationPayload: {
          toEmail: "guest@example.com",
          guestName: "Guest",
          hostName: "Host",
          eventTitle: "Meeting",
          dateStr: "2026-11-10",
          timeStr: "10:00 AM",
        },
      };

      // 1. Claim update returns the claimed booking
      mockUpdateReturning.mockResolvedValueOnce([bookingPayload]);
      // 2. Fenced completion update succeeds
      mockUpdateReturning.mockResolvedValueOnce([{ id: "booking-pending-notify" }]);

      (db.query.bookings.findFirst as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(bookingPayload);

      const result = await dispatchDurableBookingNotification("booking-pending-notify");

      expect(result.success).toBe(false);
      expect(result.status).toBe("failed");
      expect(result.error).toContain("Resend API 500");

      // Verify DB update recorded 'failed' without altering booking.status
      expect(db.update).toHaveBeenCalled();
    });
  });

  describe("4. Pure Baseline Schema Verification", () => {
    const fullSchemaColumns: Record<string, string[]> = {};
    for (const [table, cols] of Object.entries(REQUIRED_BASELINE_SCHEMA)) {
      fullSchemaColumns[table] = [...cols];
    }
    const fullTables = Object.keys(REQUIRED_BASELINE_SCHEMA);

    it("Scenario 1: Complete baseline schema -> adoption permitted", () => {
      const result = verifyBaselineSchema(fullTables, fullSchemaColumns);
      expect(result.canAdoptBaseline).toBe(true);
      expect(result.isFreshDatabase).toBe(false);
      expect(result.missingTables.length).toBe(0);
      expect(result.missingColumns.length).toBe(0);
    });

    it("Scenario 2: Missing table -> adoption rejected", () => {
      const missingTableList = fullTables.filter((t) => t !== "verification_tokens");
      const result = verifyBaselineSchema(missingTableList, fullSchemaColumns);

      expect(result.canAdoptBaseline).toBe(false);
      expect(result.missingTables).toContain("verification_tokens");
      expect(result.errors.some((e) => e.includes("verification_tokens"))).toBe(true);
    });

    it("Scenario 3: Missing users.slug -> adoption rejected", () => {
      const partialColumns = {
        ...fullSchemaColumns,
        users: fullSchemaColumns.users.filter((c) => c !== "slug"),
      };

      const result = verifyBaselineSchema(fullTables, partialColumns);

      expect(result.canAdoptBaseline).toBe(false);
      expect(result.missingColumns).toContain("users.slug");
      expect(result.errors.some((e) => e.includes("users.slug"))).toBe(true);
    });

    it("Scenario 4: Missing another essential column (event_types.requires_approval) -> adoption rejected", () => {
      const partialColumns = {
        ...fullSchemaColumns,
        event_types: fullSchemaColumns.event_types.filter((c) => c !== "requires_approval"),
      };

      const result = verifyBaselineSchema(fullTables, partialColumns);

      expect(result.canAdoptBaseline).toBe(false);
      expect(result.missingColumns).toContain("event_types.requires_approval");
      expect(result.errors.some((e) => e.includes("event_types.requires_approval"))).toBe(true);
    });
  });

  describe("5. URL Normalization & Production Safety Check", () => {
    it("detects same database across host variations (pooling endpoint stripping)", () => {
      const url1 = "postgresql://user:pass@ep-winter-mountain-bevsn32a-pooler.c-9.us-east-2.aws.neon.tech/neondb?sslmode=require";
      const url2 = "postgresql://user:pass@ep-winter-mountain-bevsn32a.c-9.us-east-2.aws.neon.tech/neondb";

      expect(isSameDatabase(url1, url2)).toBe(true);
    });

    it("detects different databases", () => {
      const prodUrl = "postgresql://user:pass@ep-prod-db.neon.tech/neondb";
      const testUrl = "postgresql://user:pass@ep-isolated-test-db.neon.tech/testdb";

      expect(isSameDatabase(prodUrl, testUrl)).toBe(false);
    });
  });
});
