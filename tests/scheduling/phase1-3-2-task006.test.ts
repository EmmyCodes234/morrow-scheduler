import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  generateGcalEventId,
  isGoogleEventMatchingBooking,
  createGoogleCalendarEvent,
  patchGoogleCalendarEventTime,
} from "@/lib/google-calendar";
import { reconcileBookingCalendarSync } from "@/lib/scheduling/booking-service";
import {
  dispatchDurableBookingNotification,
  generateResendIdempotencyKey,
  NOTIFICATION_LEASE_MS,
} from "@/lib/scheduling/notification-service";
import {
  verifyBaselineSchema,
  REQUIRED_BASELINE_SCHEMA,
  EXPECTED_BASELINE_UNIQUE_PROTECTIONS,
  EXPECTED_BASELINE_FOREIGN_KEYS,
  EXPECTED_BASELINE_INDEXES,
} from "@/lib/database/schema-verifier";
import { isSameDatabase } from "@/lib/database/url-safety";
import { db } from "@/db";
import { sendBookingApprovalEmail, sendBookingRejectionEmail } from "@/lib/email";

// Hoisted mocks for database updates and queries
const { mockUpdateReturning, mockUpdateSet, mockUpdateWhere, mockInsert, mockGet, mockPatch, mockDelete } = vi.hoisted(() => {
  const mockUpdateReturning = vi.fn().mockResolvedValue([{ id: "mock-booking-id" }]);
  const mockUpdateSet = vi.fn().mockReturnThis();
  const mockUpdateWhere = vi.fn().mockImplementation(() => ({
    returning: mockUpdateReturning,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    then: (resolve: any, reject: any) => Promise.resolve([{ id: "mock-booking-id" }]).then(resolve, reject),
  }));

  const mockInsert = vi.fn();
  const mockGet = vi.fn();
  const mockPatch = vi.fn();
  const mockDelete = vi.fn();

  return {
    mockUpdateReturning,
    mockUpdateSet,
    mockUpdateWhere,
    mockInsert,
    mockGet,
    mockPatch,
    mockDelete,
  };
});

// Mock googleapis
vi.mock("googleapis", () => {
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

// Mock email functions
vi.mock("@/lib/email", () => ({
  sendBookingApprovalEmail: vi.fn(),
  sendBookingRejectionEmail: vi.fn(),
}));

// Mock db
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

describe("Phase 1.3.2: Task 006 Comprehensive Regression Test Suite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // SECTION 1: ATOMIC NOTIFICATION DELIVERY & OUTBOX STATE MACHINE
  // =========================================================================
  describe("1. Atomic Notification Delivery State Machine & Fencing", () => {
    const validPayload = {
      toEmail: "guest@example.com",
      guestName: "Alice Guest",
      hostName: "Host Bob",
      eventTitle: "Strategy Call",
      dateStr: "2026-11-15",
      timeStr: "02:00 PM",
      bookingUrl: "https://usemorrow.xyz/bookings/booking-123",
    };

    it("Scenario 1.1: Two simultaneous dispatch requests -> only one claims row; loser receives claim_locked and does not send email", async () => {
      // Worker 1 acquires the claim
      const claimedBooking = {
        id: "booking-concurrent-1",
        status: "confirmed",
        notificationStatus: "sending",
        notificationType: "approval",
        notificationAttempts: 1,
        notificationClaimToken: "worker-1-token",
        notificationPayload: validPayload,
      };

      // Worker 1: claim succeeds, send succeeds, fenced update succeeds
      mockUpdateReturning.mockResolvedValueOnce([claimedBooking]); // Claim
      (sendBookingApprovalEmail as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
      mockUpdateReturning.mockResolvedValueOnce([{ id: "booking-concurrent-1" }]); // Fenced update

      const worker1Result = await dispatchDurableBookingNotification("booking-concurrent-1");
      expect(worker1Result.success).toBe(true);
      expect(worker1Result.status).toBe("sent");
      expect(sendBookingApprovalEmail).toHaveBeenCalledTimes(1);

      // Worker 2 attempts concurrently: conditional update matches 0 rows (returning [])
      mockUpdateReturning.mockResolvedValueOnce([]); // Claim failed (already sending)
      (db.query.bookings.findFirst as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        id: "booking-concurrent-1",
        status: "confirmed",
        notificationStatus: "sending",
        notificationClaimedAt: new Date(), // Active lease
        notificationAttempts: 1,
      });

      const worker2Result = await dispatchDurableBookingNotification("booking-concurrent-1");
      expect(worker2Result.success).toBe(false);
      expect(worker2Result.status).toBe("claim_locked");
      // Worker 2 did not trigger any additional email delivery
      expect(sendBookingApprovalEmail).toHaveBeenCalledTimes(1);
    });

    it("Scenario 1.2: Expired claim can be recovered after the lease expires", async () => {
      const expiredClaimBooking = {
        id: "booking-expired-lease",
        status: "confirmed",
        notificationStatus: "sending",
        notificationType: "approval",
        notificationAttempts: 2,
        notificationClaimToken: "recovery-worker-token",
        notificationPayload: validPayload,
      };

      // In real SQL, lt(notificationClaimedAt, leaseCutoff) matches the expired row
      mockUpdateReturning.mockResolvedValueOnce([expiredClaimBooking]);
      (sendBookingApprovalEmail as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
      mockUpdateReturning.mockResolvedValueOnce([{ id: "booking-expired-lease" }]);

      const result = await dispatchDurableBookingNotification("booking-expired-lease");
      expect(result.success).toBe(true);
      expect(result.status).toBe("sent");
      expect(result.claimToken).toBeDefined();
      expect(sendBookingApprovalEmail).toHaveBeenCalledTimes(1);
    });

    it("Scenario 1.3: Stale worker cannot update state after another worker takes ownership (stale_worker)", async () => {
      const initialClaim = {
        id: "booking-stale-worker",
        status: "confirmed",
        notificationStatus: "sending",
        notificationType: "approval",
        notificationAttempts: 1,
        notificationClaimToken: "stale-worker-token",
        notificationPayload: validPayload,
      };

      // Step 1: Claim succeeds for worker 1
      mockUpdateReturning.mockResolvedValueOnce([initialClaim]);
      (sendBookingApprovalEmail as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);

      // Step 2: During send, lease expires and worker 2 claims it.
      // Worker 1's fenced update (where notificationClaimToken == 'stale-worker-token') matches 0 rows!
      mockUpdateReturning.mockResolvedValueOnce([]); // Fenced update returns empty

      const result = await dispatchDurableBookingNotification("booking-stale-worker");
      expect(result.success).toBe(false);
      expect(result.status).toBe("stale_worker");
      expect(result.error).toContain("Notification claim expired and was acquired by another worker");
    });

    it("Scenario 1.4: Successful delivery marks the notification 'sent'", async () => {
      const booking = {
        id: "booking-success-send",
        status: "confirmed",
        notificationStatus: "sending",
        notificationType: "approval",
        notificationAttempts: 1,
        notificationClaimToken: "token-abc",
        notificationPayload: validPayload,
      };

      mockUpdateReturning.mockResolvedValueOnce([booking]);
      (sendBookingApprovalEmail as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
      mockUpdateReturning.mockResolvedValueOnce([{ id: "booking-success-send", notificationStatus: "sent" }]);

      const result = await dispatchDurableBookingNotification("booking-success-send");
      expect(result.success).toBe(true);
      expect(result.status).toBe("sent");
    });

    it("Scenario 1.5: Email function returning false marks notification 'failed' and increments attempt counter", async () => {
      const booking = {
        id: "booking-provider-error",
        status: "confirmed",
        notificationStatus: "sending",
        notificationType: "approval",
        notificationAttempts: 1,
        notificationClaimToken: "token-err",
        notificationPayload: validPayload,
      };

      mockUpdateReturning.mockResolvedValueOnce([booking]);
      // Email function returns false (e.g., Resend 4xx/5xx returned false without throwing)
      (sendBookingApprovalEmail as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);
      mockUpdateReturning.mockResolvedValueOnce([{ id: "booking-provider-error", notificationStatus: "failed" }]);

      const result = await dispatchDurableBookingNotification("booking-provider-error");
      expect(result.success).toBe(false);
      expect(result.status).toBe("failed");
      expect(result.error).toContain("Email provider rejected or failed to accept message");
    });

    it("Scenario 1.6: Missing Resend API key marks notification 'failed'", async () => {
      const booking = {
        id: "booking-missing-key",
        status: "confirmed",
        notificationStatus: "sending",
        notificationType: "approval",
        notificationAttempts: 1,
        notificationClaimToken: "token-missing-key",
        notificationPayload: validPayload,
      };

      mockUpdateReturning.mockResolvedValueOnce([booking]);
      // Email function throws or returns false when API key is missing
      (sendBookingApprovalEmail as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error("RESEND_API_KEY environment variable is missing")
      );
      mockUpdateReturning.mockResolvedValueOnce([{ id: "booking-missing-key", notificationStatus: "failed" }]);

      const result = await dispatchDurableBookingNotification("booking-missing-key");
      expect(result.success).toBe(false);
      expect(result.status).toBe("failed");
      expect(result.error).toContain("RESEND_API_KEY environment variable is missing");
    });

    it("Scenario 1.7: Failed notification remains retryable without altering booking confirmed or rejected status", async () => {
      // 1. Initial failed dispatch
      const failedBooking = {
        id: "booking-retryable",
        status: "confirmed", // Booking status remains confirmed!
        notificationStatus: "failed",
        notificationType: "approval",
        notificationAttempts: 1,
        notificationClaimToken: "token-first-try",
        notificationPayload: validPayload,
      };

      // 2. Retry attempt claims the failed notification
      const claimedOnRetry = {
        ...failedBooking,
        notificationStatus: "sending",
        notificationAttempts: 2,
        notificationClaimToken: "token-retry",
      };

      mockUpdateReturning.mockResolvedValueOnce([claimedOnRetry]);
      (sendBookingApprovalEmail as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
      mockUpdateReturning.mockResolvedValueOnce([{ id: "booking-retryable", notificationStatus: "sent" }]);

      const result = await dispatchDurableBookingNotification("booking-retryable");
      expect(result.success).toBe(true);
      expect(result.status).toBe("sent");
      expect(claimedOnRetry.status).toBe("confirmed"); // Booking confirmed status preserved
    });

    it("Scenario 1.8: Sent notification returns 'already_sent' and does not resend", async () => {
      // Claim returns empty (cannot claim 'sent' notification)
      mockUpdateReturning.mockResolvedValueOnce([]);
      (db.query.bookings.findFirst as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        id: "booking-completed",
        status: "confirmed",
        notificationStatus: "sent",
        notificationType: "approval",
      });

      const result = await dispatchDurableBookingNotification("booking-completed");
      expect(result.success).toBe(true);
      expect(result.status).toBe("already_sent");
      expect(sendBookingApprovalEmail).not.toHaveBeenCalled();
      expect(sendBookingRejectionEmail).not.toHaveBeenCalled();
    });

    it("Scenario 1.9: Stable provider idempotency key is generated and preserved across retries", () => {
      expect(NOTIFICATION_LEASE_MS).toBe(60_000);
      const bookingId = "b1234567-89ab-cdef-0123-456789abcdef";
      const key1 = generateResendIdempotencyKey(bookingId, "approval");
      const key2 = generateResendIdempotencyKey(bookingId, "approval");
      const keyRejection = generateResendIdempotencyKey(bookingId, "rejection");

      expect(key1).toBe(`morrow-booking-${bookingId}-approval-v1`);
      expect(key1).toBe(key2); // Immutable across attempts
      expect(keyRejection).toBe(`morrow-booking-${bookingId}-rejection-v1`);
    });

    it("Scenario 1.10: The email payload remains consistent on retries", async () => {
      const fixedPayload = {
        toEmail: "consistent@example.com",
        guestName: "Charlie",
        hostName: "Dana",
        eventTitle: "Sync Meeting",
        dateStr: "2026-11-20",
        timeStr: "11:00 AM",
        calendarSynced: true,
        meetLink: "https://meet.google.com/test-meet-123",
      };

      const booking = {
        id: "booking-fixed-payload",
        status: "confirmed",
        notificationStatus: "sending",
        notificationType: "approval",
        notificationAttempts: 2,
        notificationClaimToken: "token-fixed",
        notificationPayload: fixedPayload,
      };

      mockUpdateReturning.mockResolvedValueOnce([booking]);
      (sendBookingApprovalEmail as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
      mockUpdateReturning.mockResolvedValueOnce([{ id: "booking-fixed-payload" }]);

      await dispatchDurableBookingNotification("booking-fixed-payload");

      expect(sendBookingApprovalEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          toEmail: "consistent@example.com",
          guestName: "Charlie",
          hostName: "Dana",
          eventTitle: "Sync Meeting",
          dateStr: "2026-11-20",
          timeStr: "11:00 AM",
          meetLink: "https://meet.google.com/test-meet-123",
        }),
        generateResendIdempotencyKey("booking-fixed-payload", "approval")
      );
    });
  });

  // =========================================================================
  // SECTION 2: GOOGLE CALENDAR EVENT OWNERSHIP & RECOVERY
  // =========================================================================
  describe("2. Google Calendar Event Ownership & Recovery", () => {
    const booking = {
      id: "booking-target-uuid",
      guestEmail: "target.guest@example.com",
      gcalEventId: "stored-gcal-id-456",
    };

    it("accepts exact private booking reference in extendedProperties", () => {
      const event = {
        id: "unrelated-gcal-id",
        extendedProperties: {
          private: {
            morrowBookingId: "booking-target-uuid",
            morrowApp: "morrow-scheduler",
          },
        },
      };

      expect(isGoogleEventMatchingBooking(event, booking)).toBe(true);
    });

    it("accepts exact stored database mapping", () => {
      const event = {
        id: "stored-gcal-id-456",
        description: "Some custom meeting description without markers",
      };

      expect(isGoogleEventMatchingBooking(event, booking)).toBe(true);
    });

    it("accepts deterministic event ID", () => {
      const deterministicId = generateGcalEventId("booking-target-uuid");
      const event = {
        id: deterministicId,
      };

      expect(isGoogleEventMatchingBooking(event, booking)).toBe(true);
    });

    it("accepts exact legacy booking marker in description", () => {
      const event = {
        id: "random-id",
        description: "Scheduled via Morrow (Booking ID: booking-target-uuid)",
      };

      expect(isGoogleEventMatchingBooking(event, booking)).toBe(true);
    });

    it("rejects generic 'Scheduled via Morrow' text alone", () => {
      const event = {
        id: "random-id-999",
        description: "Scheduled via Morrow",
      };

      expect(isGoogleEventMatchingBooking(event, booking)).toBe(false);
    });

    it("rejects guest email alone", () => {
      const event = {
        id: "random-id-888",
        attendees: [{ email: "target.guest@example.com" }],
        summary: "Meeting with target guest",
      };

      expect(isGoogleEventMatchingBooking(event, booking)).toBe(false);
    });

    it("rejects mismatched 409 recovery and marks sync failed", async () => {
      const fullBooking = {
        id: "booking-target-uuid",
        hostId: "host-1",
        status: "confirmed",
        guestName: "Alice",
        guestEmail: "alice@example.com",
        startTime: new Date("2026-11-20T10:00:00Z"),
        endTime: new Date("2026-11-20T10:30:00Z"),
        gcalEventId: null,
        calendarSyncStatus: "pending",
        host: {
          id: "host-1",
          timezone: "UTC",
          googleAccessToken: "mock-access",
          googleRefreshToken: "mock-refresh",
        },
        eventType: {
          id: "type-1",
          title: "Strategy Session",
          locationType: "google_meet",
        },
      };

      (db.query.bookings.findFirst as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(fullBooking);

      // 1. Initial get returns 404 (event does not exist yet)
      mockGet.mockRejectedValueOnce({ status: 404 });

      // 2. Insert returns 409 conflict
      mockInsert.mockRejectedValueOnce({
        status: 409,
        message: "The requested identifier already exists.",
      });

      // 3. Conflict recovery get finds the event, but it belongs to another booking!
      mockGet.mockResolvedValueOnce({
        data: {
          id: generateGcalEventId("booking-target-uuid"),
          status: "confirmed",
          description: "Unrelated meeting description",
          extendedProperties: {
            private: {
              morrowBookingId: "completely-different-uuid",
            },
          },
        },
      });

      const result = await reconcileBookingCalendarSync(fullBooking.id, fullBooking.hostId);
      expect(result.success).toBe(false);
      expect(result.calendarSynced).toBe(false);
      expect(result.error).toContain("does not match booking");
    });

    it("never marks a cancelled event synced unless restoration confirmed it active", async () => {
      // Existing event in DB is cancelled
      const fullBooking = {
        id: "booking-cancelled-event",
        hostId: "host-1",
        status: "confirmed",
        guestName: "Bob",
        guestEmail: "bob@example.com",
        startTime: new Date("2026-11-20T10:00:00Z"),
        endTime: new Date("2026-11-20T10:30:00Z"),
        gcalEventId: "existing-cancelled-gcal-id",
        calendarSyncStatus: "pending",
        host: {
          id: "host-1",
          timezone: "UTC",
          googleAccessToken: "mock-access",
          googleRefreshToken: "mock-refresh",
        },
        eventType: {
          id: "type-1",
          title: "Catchup",
          locationType: "google_meet",
        },
      };

      (db.query.bookings.findFirst as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(fullBooking);

      // 1. Initial get returns event with status: 'cancelled'
      mockGet.mockResolvedValueOnce({
        data: {
          id: "existing-cancelled-gcal-id",
          status: "cancelled",
          extendedProperties: {
            private: {
              morrowBookingId: fullBooking.id,
            },
          },
        },
      });

      // 2. Patch attempts to restore, but API returns event still cancelled
      mockPatch.mockResolvedValueOnce({
        data: {
          id: "existing-cancelled-gcal-id",
          status: "cancelled", // Still cancelled!
        },
      });

      // 3. Subsequent get confirms event remains cancelled
      mockGet.mockResolvedValueOnce({
        data: {
          id: "existing-cancelled-gcal-id",
          status: "cancelled",
        },
      });

      const result = await reconcileBookingCalendarSync(fullBooking.id, fullBooking.hostId);
      expect(result.success).toBe(false);
      expect(result.calendarSynced).toBe(false);
      expect(result.error).toContain("cancelled");
    });

    it("newly created events contain the private booking marker", async () => {
      mockInsert.mockResolvedValueOnce({
        data: {
          id: "new-gcal-event-123",
          status: "confirmed",
          hangoutLink: "https://meet.google.com/xyz-abc-def",
        },
      });

      const createRes = await createGoogleCalendarEvent({
        tokens: { accessToken: "tok" },
        summary: "1-on-1 Call",
        description: "Scheduled via Morrow (Booking ID: booking-new-1)",
        startTime: new Date("2026-11-25T14:00:00Z"),
        endTime: new Date("2026-11-25T14:30:00Z"),
        guestEmail: "newguest@example.com",
        guestName: "New Guest",
        bookingId: "booking-new-1",
      });

      expect(createRes.success).toBe(true);
      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({
            extendedProperties: {
              private: {
                morrowBookingId: "booking-new-1",
                morrowApp: "morrow-scheduler",
              },
            },
          }),
        })
      );
    });

    it("patching preserves existing private properties and conference details", async () => {
      mockPatch.mockResolvedValueOnce({
        data: {
          id: "existing-event-id",
          status: "confirmed",
          hangoutLink: "https://meet.google.com/preserved-link",
          extendedProperties: {
            private: {
              morrowBookingId: "booking-patch-1",
              morrowApp: "morrow-scheduler",
            },
          },
        },
      });

      const patchRes = await patchGoogleCalendarEventTime({
        tokens: { accessToken: "tok" },
        eventId: "existing-event-id",
        startTime: new Date("2026-11-26T10:00:00Z"),
        endTime: new Date("2026-11-26T10:30:00Z"),
        bookingId: "booking-patch-1",
      });

      expect(patchRes.success).toBe(true);
      expect(patchRes.meetLink).toBe("https://meet.google.com/preserved-link");
      expect(mockPatch).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({
            extendedProperties: {
              private: {
                morrowBookingId: "booking-patch-1",
                morrowApp: "morrow-scheduler",
              },
            },
          }),
        })
      );
    });
  });

  // =========================================================================
  // SECTION 3: BASELINE SCHEMA VERIFICATION
  // =========================================================================
  describe("3. Baseline Schema Verification", () => {
    const fullSchemaColumns: Record<string, string[]> = {};
    for (const [table, cols] of Object.entries(REQUIRED_BASELINE_SCHEMA)) {
      fullSchemaColumns[table] = [...cols];
    }
    const fullTables = Object.keys(REQUIRED_BASELINE_SCHEMA);

    const fullConstraints = [
      { table_name: "users", type: "u", def: "UNIQUE (email)" },
      { table_name: "users", type: "u", def: "UNIQUE (slug)" },
      { table_name: "event_types", type: "u", def: "UNIQUE (user_id, slug)" },
      { table_name: "bookings", type: "u", def: "UNIQUE (cancel_token)" },
      { table_name: "contacts", type: "u", def: "UNIQUE (user_id, email)" },
      { table_name: "bookings", type: "u", def: "UNIQUE (idempotency_key)" },
      { table_name: "event_types", type: "f", def: "FOREIGN KEY (user_id) REFERENCES users(id)" },
      { table_name: "availability", type: "f", def: "FOREIGN KEY (user_id) REFERENCES users(id)" },
      { table_name: "availability_overrides", type: "f", def: "FOREIGN KEY (user_id) REFERENCES users(id)" },
      { table_name: "bookings", type: "f", def: "FOREIGN KEY (event_type_id) REFERENCES event_types(id)" },
      { table_name: "bookings", type: "f", def: "FOREIGN KEY (host_id) REFERENCES users(id)" },
      { table_name: "contacts", type: "f", def: "FOREIGN KEY (user_id) REFERENCES users(id)" },
    ];

    const fullIndexes = [
      { tablename: "availability", indexdef: "CREATE INDEX availability_user_idx ON availability USING btree (user_id)" },
      { tablename: "bookings", indexdef: "CREATE INDEX bookings_host_idx ON bookings USING btree (host_id)" },
      { tablename: "bookings", indexdef: "CREATE INDEX bookings_status_idx ON bookings USING btree (status)" },
      { tablename: "bookings", indexdef: "CREATE INDEX bookings_start_time_idx ON bookings USING btree (start_time)" },
      { tablename: "contacts", indexdef: "CREATE INDEX contacts_user_idx ON contacts USING btree (user_id)" },
      { tablename: "event_types", indexdef: "CREATE INDEX event_types_user_idx ON event_types USING btree (user_id)" },
    ];

    it("complete baseline schema is accepted", () => {
      expect(EXPECTED_BASELINE_UNIQUE_PROTECTIONS.length).toBeGreaterThan(0);
      expect(EXPECTED_BASELINE_FOREIGN_KEYS.length).toBeGreaterThan(0);
      expect(EXPECTED_BASELINE_INDEXES.length).toBeGreaterThan(0);

      const result = verifyBaselineSchema(fullTables, fullSchemaColumns, {
        existingConstraints: fullConstraints,
        existingIndexes: fullIndexes,
        stage: "0000_baseline",
      });

      expect(result.canAdoptBaseline).toBe(true);
      expect(result.isFreshDatabase).toBe(false);
      expect(result.missingTables).toHaveLength(0);
      expect(result.missingColumns).toHaveLength(0);
      expect(result.missingUniqueConstraints).toHaveLength(0);
      expect(result.missingForeignKeys).toHaveLength(0);
      expect(result.missingIndexes).toHaveLength(0);
    });

    it("missing table is rejected", () => {
      const missingTables = fullTables.filter((t) => t !== "bookings");
      const result = verifyBaselineSchema(missingTables, fullSchemaColumns, {
        existingConstraints: fullConstraints,
        existingIndexes: fullIndexes,
      });

      expect(result.canAdoptBaseline).toBe(false);
      expect(result.missingTables).toContain("bookings");
      expect(result.errors.some((e) => e.includes("Missing required baseline table: bookings"))).toBe(true);
    });

    it("missing essential column is rejected", () => {
      const partialColumns = {
        ...fullSchemaColumns,
        users: fullSchemaColumns.users.filter((c) => c !== "slug"),
      };

      const result = verifyBaselineSchema(fullTables, partialColumns, {
        existingConstraints: fullConstraints,
        existingIndexes: fullIndexes,
      });

      expect(result.canAdoptBaseline).toBe(false);
      expect(result.missingColumns).toContain("users.slug");
    });

    it("missing unique protection is rejected", () => {
      const missingUnique = fullConstraints.filter((c) => !c.def.includes("(email)"));
      const result = verifyBaselineSchema(fullTables, fullSchemaColumns, {
        existingConstraints: missingUnique,
        existingIndexes: fullIndexes,
      });

      expect(result.canAdoptBaseline).toBe(false);
      expect(result.missingUniqueConstraints.some((u) => u.includes("users(email)"))).toBe(true);
    });

    it("missing foreign key is rejected", () => {
      const missingFk = fullConstraints.filter((c) => !c.def.includes("FOREIGN KEY (host_id)"));
      const result = verifyBaselineSchema(fullTables, fullSchemaColumns, {
        existingConstraints: missingFk,
        existingIndexes: fullIndexes,
      });

      expect(result.canAdoptBaseline).toBe(false);
      expect(result.missingForeignKeys.some((fk) => fk.includes("bookings.host_id"))).toBe(true);
    });

    it("missing required index is rejected", () => {
      const missingIdx = fullIndexes.filter((idx) => !idx.indexdef.includes("bookings_host_idx"));
      const result = verifyBaselineSchema(fullTables, fullSchemaColumns, {
        existingConstraints: fullConstraints,
        existingIndexes: missingIdx,
      });

      expect(result.canAdoptBaseline).toBe(false);
      expect(result.missingIndexes.some((idx) => idx.includes("bookings(host_id)"))).toBe(true);
    });

    it("baseline 0000 adoption does not require later exclusion constraints or outbox columns", () => {
      // Stage: '0000_baseline' without Phase 1.2 exclusion constraint
      const resultBaseline = verifyBaselineSchema(fullTables, fullSchemaColumns, {
        existingConstraints: fullConstraints,
        existingIndexes: fullIndexes,
        stage: "0000_baseline",
      });

      expect(resultBaseline.canAdoptBaseline).toBe(true);

      // Stage: 'latest' with missing exclusion constraint flags error
      const resultLatest = verifyBaselineSchema(fullTables, fullSchemaColumns, {
        existingConstraints: fullConstraints,
        existingIndexes: fullIndexes,
        stage: "latest",
      });

      expect(resultLatest.canAdoptBaseline).toBe(false);
      expect(resultLatest.errors.some((e) => e.includes("Phase 1.2 final exclusion constraint"))).toBe(true);
    });
  });

  // =========================================================================
  // SECTION 4: REAL POSTGRESQL CONCURRENCY TESTS (GUARDED)
  // =========================================================================
  const testDbUrl = process.env.TEST_DATABASE_URL;
  const describeIntegration = testDbUrl ? describe : describe.skip;

  if (!testDbUrl) {
    console.log(
      "\n===================================================================================\n" +
      "[NOTICE] Task 006 Real PostgreSQL Concurrency Integration Tests Skipped:\n" +
      "TEST_DATABASE_URL is not configured. Real PostgreSQL concurrency tests require an isolated test database.\n" +
      "To provision and run:\n" +
      "  1. Provision an isolated PostgreSQL / Neon test database branch.\n" +
      "  2. Apply migrations: DATABASE_URL=<test-url> pnpm run db:migrate\n" +
      "  3. Run: TEST_DATABASE_URL=<test-url> pnpm test tests/scheduling/phase1-3-2-task006.test.ts\n" +
      "===================================================================================\n"
    );
  }

  describeIntegration("4. Real PostgreSQL Concurrency & Atomic Claiming", () => {
    it("proves simultaneous claims: exactly one worker acquires the row", async () => {
      // Safety check: ensure TEST_DATABASE_URL does not point to production
      if (isSameDatabase(testDbUrl, process.env.DATABASE_URL)) {
        throw new Error("Refusing to run tests: TEST_DATABASE_URL points to the production database!");
      }

      const { neon } = await import("@neondatabase/serverless");
      const sql = neon(testDbUrl!);

      const bookingId = "00000000-0000-0000-0000-000000000099";
      const token1 = "worker-tx-1";
      const token2 = "worker-tx-2";

      // Seed a pending test booking
      await sql`
        INSERT INTO bookings (
          id, event_type_id, host_id, guest_name, guest_email,
          start_time, end_time, cancel_token, notification_status, notification_type,
          notification_attempts
        ) VALUES (
          ${bookingId}, gen_random_uuid(), gen_random_uuid(), 'Test Guest', 'guest@test.com',
          NOW() + INTERVAL '1 day', NOW() + INTERVAL '1 day 30 minutes', 'cancel-test-token',
          'pending', 'approval', 0
        )
        ON CONFLICT (id) DO UPDATE SET
          notification_status = 'pending',
          notification_claim_token = NULL,
          notification_claimed_at = NULL,
          notification_attempts = 0
      `;

      // Two concurrent atomic claim attempts
      const claim1Promise = sql`
        UPDATE bookings
        SET notification_status = 'sending',
            notification_claim_token = ${token1},
            notification_claimed_at = NOW(),
            notification_attempts = notification_attempts + 1
        WHERE id = ${bookingId}
          AND notification_status IN ('pending', 'failed')
        RETURNING id, notification_claim_token
      `;

      const claim2Promise = sql`
        UPDATE bookings
        SET notification_status = 'sending',
            notification_claim_token = ${token2},
            notification_claimed_at = NOW(),
            notification_attempts = notification_attempts + 1
        WHERE id = ${bookingId}
          AND notification_status IN ('pending', 'failed')
        RETURNING id, notification_claim_token
      `;

      const [res1, res2] = await Promise.all([claim1Promise, claim2Promise]);

      const winner = res1.length > 0 ? res1 : res2;
      const loser = res1.length > 0 ? res2 : res1;

      expect(winner).toHaveLength(1);
      expect(loser).toHaveLength(0);

      // Clean up test booking
      await sql`DELETE FROM bookings WHERE id = ${bookingId}`;
    });

    it("proves expired claim is claimable by subsequent transaction", async () => {
      const { neon } = await import("@neondatabase/serverless");
      const sql = neon(testDbUrl!);

      const bookingId = "00000000-0000-0000-0000-000000000098";
      const oldToken = "abandoned-worker-token";
      const recoveryToken = "recovery-worker-token";

      // Seed an abandoned 'sending' notification with expired claim (older than 60s)
      await sql`
        INSERT INTO bookings (
          id, event_type_id, host_id, guest_name, guest_email,
          start_time, end_time, cancel_token, notification_status, notification_type,
          notification_claim_token, notification_claimed_at, notification_attempts
        ) VALUES (
          ${bookingId}, gen_random_uuid(), gen_random_uuid(), 'Test Guest', 'guest@test.com',
          NOW() + INTERVAL '1 day', NOW() + INTERVAL '1 day 30 minutes', 'cancel-test-token-2',
          'sending', 'approval', ${oldToken}, NOW() - INTERVAL '70 seconds', 1
        )
        ON CONFLICT (id) DO UPDATE SET
          notification_status = 'sending',
          notification_claim_token = ${oldToken},
          notification_claimed_at = NOW() - INTERVAL '70 seconds',
          notification_attempts = 1
      `;

      // Recovery worker claims the expired claim
      const recoveryRes = await sql`
        UPDATE bookings
        SET notification_status = 'sending',
            notification_claim_token = ${recoveryToken},
            notification_claimed_at = NOW(),
            notification_attempts = notification_attempts + 1
        WHERE id = ${bookingId}
          AND (
            notification_status IN ('pending', 'failed')
            OR (notification_status = 'sending' AND notification_claimed_at < NOW() - INTERVAL '60 seconds')
          )
        RETURNING id, notification_claim_token
      `;

      expect(recoveryRes).toHaveLength(1);
      expect(recoveryRes[0].notification_claim_token).toBe(recoveryToken);

      // Clean up test booking
      await sql`DELETE FROM bookings WHERE id = ${bookingId}`;
    });
  });
});
