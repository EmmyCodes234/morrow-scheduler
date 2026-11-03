import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import {
  cancelBooking,
  getBookingForCancellation,
  retryCancelledBookingCalendarCleanup,
} from "@/lib/scheduling/cancellation-service";
import {
  cancelGoogleCalendarEventWithDetails,
} from "@/lib/google-calendar";
import {
  generateResendIdempotencyKey,
} from "@/lib/scheduling/notification-service";
import {
  buildGuestConfirmationEmail,
  buildGuestApprovalEmail,
  buildGuestCancellationEmail,
  buildHostCancellationEmail,
  escapeHtml,
  sanitizeEmailUrl,
} from "@/lib/email-templates";
import {
  sendGuestCancellationEmail,
  sendHostCancellationEmail,
} from "@/lib/email";
import { POST as cancelPostRoute } from "@/app/api/cancel/[token]/route";
import { NextRequest } from "next/server";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
import { isSameDatabase } from "@/lib/database/url-safety";
import crypto from "crypto";

// Hoisted mocks for database updates and queries
const { mockUpdateReturning, mockUpdateSet, mockUpdateWhere, mockFindClient, mockDeleteGoogle } = vi.hoisted(() => {
  const mockUpdateReturning = vi.fn();
  const mockUpdateSet = vi.fn().mockReturnThis();
  const mockUpdateWhere = vi.fn().mockImplementation(() => ({
    returning: mockUpdateReturning,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    then: (resolve: any, reject: any) => Promise.resolve([{ id: "mock-booking-id" }]).then(resolve, reject),
  }));

  const mockFindClient = vi.fn();
  const mockDeleteGoogle = vi.fn();

  return {
    mockUpdateReturning,
    mockUpdateSet,
    mockUpdateWhere,
    mockFindClient,
    mockDeleteGoogle,
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
      calendar: vi.fn(() => ({
        events: {
          delete: mockDeleteGoogle,
        },
      })),
    },
  };
});

// Mock database operations for unit tests
vi.mock("@/db", () => {
  return {
    db: {
      update: vi.fn(() => ({
        set: mockUpdateSet,
        where: mockUpdateWhere,
      })),
      query: {
        bookings: {
          findFirst: mockFindClient,
        },
      },
    },
  };
});

// Mock Resend fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("Task 008 & 008.1: Cancellation Security, Reliability & Hardening Suite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.RESEND_API_KEY = "re_test_key_valid_12345";
    process.env.NEXT_PUBLIC_APP_URL = "https://usemorrow.xyz";
    mockUpdateReturning.mockResolvedValue([{ id: "booking-1", status: "cancelled" }]);
  });

  /* -------------------------------------------------------------------------- */
  /*  1. Confirmation Email Link Wording Verification                           */
  /* -------------------------------------------------------------------------- */
  describe("1. Confirmation Email Footer Link Wording", () => {
    it("confirmed booking footer link says 'Cancel booking' instead of 'Reschedule or Cancel'", () => {
      const email = buildGuestConfirmationEmail({
        guestName: "Alice Guest",
        hostName: "Bob Host",
        eventTitle: "30 Min Chat",
        dateStr: "2026-11-05",
        timeStr: "14:00",
        durationMins: 30,
        status: "confirmed",
        cancelUrl: "https://usemorrow.xyz/cancel/token-123",
      });

      expect(email).toContain("Cancel booking");
      expect(email).not.toContain("Reschedule or Cancel");
    });

    it("pending booking footer link says 'Cancel request'", () => {
      const email = buildGuestConfirmationEmail({
        guestName: "Alice Guest",
        hostName: "Bob Host",
        eventTitle: "30 Min Strategy",
        dateStr: "2026-11-05",
        timeStr: "14:00",
        durationMins: 30,
        status: "pending",
        cancelUrl: "https://usemorrow.xyz/cancel/token-pending-456",
      });

      expect(email).toContain("Cancel request");
      expect(email).not.toContain("Reschedule or Cancel");
    });

    it("guest approval email footer link says 'Cancel booking'", () => {
      const email = buildGuestApprovalEmail({
        guestName: "Alice Guest",
        hostName: "Bob Host",
        eventTitle: "30 Min Approved",
        dateStr: "2026-11-05",
        timeStr: "14:00",
        durationMins: 30,
        cancelUrl: "https://usemorrow.xyz/cancel/token-approved-789",
      });

      expect(email).toContain("Cancel booking");
      expect(email).not.toContain("Reschedule or Cancel");
    });
  });

  /* -------------------------------------------------------------------------- */
  /*  2. HTML Escaping & Injection Protection in Emails                        */
  /* -------------------------------------------------------------------------- */
  describe("2. HTML Escaping & Injection Protection", () => {
    it("escapeHtml escapes HTML entities correctly", () => {
      expect(escapeHtml("<script>alert('xss')</script>")).toBe(
        "&lt;script&gt;alert(&#39;xss&#39;)&lt;/script&gt;"
      );
      expect(escapeHtml("Tom & Jerry \"Friends\"")).toBe(
        "Tom &amp; Jerry &quot;Friends&quot;"
      );
      expect(escapeHtml(null)).toBe("");
    });

    it("sanitizeEmailUrl rejects dangerous schemes like javascript:", () => {
      expect(sanitizeEmailUrl("javascript:alert(1)")).toBeUndefined();
      expect(sanitizeEmailUrl("data:text/html,<script>alert(1)</script>")).toBeUndefined();
      expect(sanitizeEmailUrl("https://usemorrow.xyz/dashboard")).toBe("https://usemorrow.xyz/dashboard");
      expect(sanitizeEmailUrl("mailto:support@usemorrow.xyz")).toBe("mailto:support@usemorrow.xyz");
    });

    it("escapes user-controlled inputs in buildGuestCancellationEmail", () => {
      const maliciousPayload = {
        hostName: "Bob <script>alert(1)</script>",
        guestName: "Alice <img src=x onerror=alert(2)>",
        guestEmail: "alice@example.com",
        eventTitle: "Meeting & Hack <tag>",
        dateStr: "2026-11-04",
        timeStr: "10:00",
        reason: "<img src=x onerror=alert('reason')>",
        dashboardUrl: "javascript:alert(3)",
      };

      const email = buildGuestCancellationEmail(maliciousPayload);

      expect(email).toContain("&lt;img src=x onerror=alert(&#39;reason&#39;)&gt;");
      expect(email).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
      expect(email).toContain("&lt;img src=x onerror=alert(2)&gt;");
      expect(email).toContain("Meeting &amp; Hack &lt;tag&gt;");

      // Verify unescaped tags are not present
      expect(email).not.toContain("<img src=x onerror=alert(");
      expect(email).not.toContain("<script>alert(1)</script>");
      // Verify malicious javascript: url is not injected
      expect(email).not.toContain("javascript:alert(3)");
    });

    it("escapes user-controlled inputs in buildHostCancellationEmail", () => {
      const maliciousPayload = {
        guestName: "Alice <b onmouseover=alert(1)>test</b>",
        hostName: "Bob <svg onload=alert(2)>",
        eventTitle: "Consultation <i>danger</i>",
        dateStr: "2026-11-04",
        timeStr: "10:00",
        reason: "<script>alert('cancelled by host')</script>",
        rebookUrl: "https://usemorrow.xyz/bob",
      };

      const email = buildHostCancellationEmail(maliciousPayload);

      expect(email).toContain("&lt;script&gt;alert(&#39;cancelled by host&#39;)&lt;/script&gt;");
      expect(email).toContain("&lt;svg onload=alert(2)&gt;");
      expect(email).toContain("&lt;b onmouseover=alert(1)&gt;test&lt;/b&gt;");
      expect(email).not.toContain("<script>alert(");
      expect(email).not.toContain("<svg onload=");
    });
  });

  /* -------------------------------------------------------------------------- */
  /*  3. Public Booking Summary via Cancel Token (GET)                         */
  /* -------------------------------------------------------------------------- */
  describe("3. Public Cancellation Token Lookup", () => {
    it("retrieves sanitized booking summary for valid token without internal IDs or credentials", async () => {
      const futureDate = new Date(Date.now() + 86400000);
      mockFindClient.mockResolvedValueOnce({
        id: "b-1",
        cancelToken: "valid-tok-1",
        guestName: "John Doe",
        guestEmail: "john@example.com",
        guestTimezone: "America/New_York",
        startTime: futureDate,
        endTime: new Date(futureDate.getTime() + 1800000),
        status: "confirmed",
        cancellationReason: null,
        cancelledAt: null,
        eventType: { title: "Product Discovery" },
        host: {
          name: "Jane Host",
          slug: "jane",
          timezone: "America/New_York",
          googleAccessToken: "secret-token",
          googleRefreshToken: "secret-refresh",
        },
      });

      const summary = await getBookingForCancellation("valid-tok-1");

      expect(summary).not.toBeNull();
      expect(summary?.eventTitle).toBe("Product Discovery");
      expect(summary?.hostName).toBe("Jane Host");
      expect(summary?.hostSlug).toBe("jane");
      expect(summary?.canCancel).toBe(true);
      expect(summary?.isPast).toBe(false);

      // Verify no sensitive fields
      const summaryAny = summary as unknown as Record<string, unknown>;
      expect(summaryAny.googleAccessToken).toBeUndefined();
      expect(summaryAny.googleRefreshToken).toBeUndefined();
      expect(summaryAny.host).toBeUndefined();
      expect(summaryAny.cancelToken).toBeUndefined();
      expect(summaryAny.id).toBeUndefined();
    });

    it("returns null for unknown token", async () => {
      mockFindClient.mockResolvedValueOnce(null);
      const summary = await getBookingForCancellation("unknown-token");
      expect(summary).toBeNull();
    });

    it("returns null for empty or non-string token", async () => {
      expect(await getBookingForCancellation("")).toBeNull();
      expect(await getBookingForCancellation("   ")).toBeNull();
      expect(await getBookingForCancellation(null as unknown as string)).toBeNull();
    });
  });

  /* -------------------------------------------------------------------------- */
  /*  4. Security: Elimination of Public OAuth & Internal Data Leakage           */
  /* -------------------------------------------------------------------------- */
  describe("4. Critical Security: Zero Public Data Exposure on POST /api/cancel/[token]", () => {
    const canarySecrets = {
      googleAccessToken: "ya29.canary_secret_google_oauth_token_12345",
      googleRefreshToken: "1//canary_secret_google_refresh_token_67890",
      hostEmail: "canary_private_host_email@secret.internal",
      claimToken: "canary_secret_notification_claim_token_abc",
      gcalEventId: "canary_google_calendar_event_secret_id_xyz",
      idempotencyKey: "canary_secret_idempotency_key_999",
      requestHash: "canary_secret_request_hash_888",
      internalPayload: "canary_internal_payload_secret",
    };

    const futureDate = new Date(Date.now() + 86400000);

    it("first-time cancellation returns ONLY whitelisted public DTO with zero canary secrets", async () => {
      mockFindClient.mockResolvedValueOnce({
        id: "booking-secret-test-1",
        cancelToken: "tok-canary-secret-1",
        guestName: "Guest User",
        guestEmail: "guest@example.com",
        guestTimezone: "UTC",
        startTime: futureDate,
        endTime: new Date(futureDate.getTime() + 1800000),
        status: "confirmed",
        gcalEventId: canarySecrets.gcalEventId,
        idempotencyKey: canarySecrets.idempotencyKey,
        requestHash: canarySecrets.requestHash,
        notificationClaimToken: canarySecrets.claimToken,
        notificationPayload: { canarySecret: canarySecrets.internalPayload },
        eventType: { title: "Strategy Session" },
        host: {
          id: "host-secret-1",
          name: "Host Bob",
          email: canarySecrets.hostEmail,
          slug: "bobsched",
          timezone: "UTC",
          googleAccessToken: canarySecrets.googleAccessToken,
          googleRefreshToken: canarySecrets.googleRefreshToken,
        },
      });

      mockUpdateReturning.mockResolvedValueOnce([
        { id: "booking-secret-test-1", status: "cancelled", cancellationReason: "Private reason" },
      ]);

      mockDeleteGoogle.mockResolvedValueOnce({ status: 204 });

      // Simulate POST request to the API route
      const req = new NextRequest("https://usemorrow.xyz/api/cancel/tok-canary-secret-1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Conflict" }),
      });

      const response = await cancelPostRoute(req, {
        params: Promise.resolve({ token: "tok-canary-secret-1" }),
      });

      expect(response.status).toBe(200);
      const json = await response.json();
      const serialized = JSON.stringify(json);

      // Release-blocking assertions: None of the canary secrets may appear anywhere in serialized JSON
      expect(serialized).not.toContain(canarySecrets.googleAccessToken);
      expect(serialized).not.toContain(canarySecrets.googleRefreshToken);
      expect(serialized).not.toContain(canarySecrets.hostEmail);
      expect(serialized).not.toContain(canarySecrets.claimToken);
      expect(serialized).not.toContain(canarySecrets.gcalEventId);
      expect(serialized).not.toContain(canarySecrets.idempotencyKey);
      expect(serialized).not.toContain(canarySecrets.requestHash);
      expect(serialized).not.toContain(canarySecrets.internalPayload);

      // Verify strict whitelisted structure
      expect(json.success).toBe(true);
      expect(json.booking).toBeDefined();
      expect(json.booking.eventTitle).toBe("Strategy Session");
      expect(json.booking.hostName).toBe("Host Bob");
      expect(json.booking.hostSlug).toBe("bobsched");
      expect(json.booking.status).toBe("cancelled");
      expect(json.booking.outcome).toBe("cancelled");
      expect(json.booking.calendarSync).toBeDefined();
      expect(json.booking.notification).toBeDefined();

      // Ensure forbidden keys are strictly undefined
      expect(json.booking.host).toBeUndefined();
      expect(json.booking.googleAccessToken).toBeUndefined();
      expect(json.booking.googleRefreshToken).toBeUndefined();
      expect(json.booking.hostEmail).toBeUndefined();
      expect(json.booking.notificationClaimToken).toBeUndefined();
      expect(json.booking.notificationPayload).toBeUndefined();
      expect(json.booking.gcalEventId).toBeUndefined();
      expect(json.booking.cancelToken).toBeUndefined();
      expect(json.booking.id).toBeUndefined();
    });

    it("already-cancelled booking returns the exact same sanitized public DTO without secrets", async () => {
      mockFindClient.mockResolvedValueOnce({
        id: "booking-already-cancelled-test",
        cancelToken: "tok-already-cancelled",
        guestName: "Guest User",
        guestEmail: "guest@example.com",
        guestTimezone: "UTC",
        startTime: futureDate,
        endTime: new Date(futureDate.getTime() + 1800000),
        status: "cancelled",
        cancellationReason: "Previous reason",
        cancelledAt: new Date(),
        gcalEventId: canarySecrets.gcalEventId,
        notificationClaimToken: canarySecrets.claimToken,
        notificationStatus: "sent",
        calendarSyncStatus: "not_applicable",
        eventType: { title: "Strategy Session" },
        host: {
          id: "host-secret-1",
          name: "Host Bob",
          email: canarySecrets.hostEmail,
          slug: "bobsched",
          timezone: "UTC",
          googleAccessToken: canarySecrets.googleAccessToken,
          googleRefreshToken: canarySecrets.googleRefreshToken,
        },
      });

      const req = new NextRequest("https://usemorrow.xyz/api/cancel/tok-already-cancelled", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      const response = await cancelPostRoute(req, {
        params: Promise.resolve({ token: "tok-already-cancelled" }),
      });

      expect(response.status).toBe(200);
      const json = await response.json();
      const serialized = JSON.stringify(json);

      // Verify canary secrets do not leak
      expect(serialized).not.toContain(canarySecrets.googleAccessToken);
      expect(serialized).not.toContain(canarySecrets.googleRefreshToken);
      expect(serialized).not.toContain(canarySecrets.hostEmail);
      expect(serialized).not.toContain(canarySecrets.claimToken);
      expect(serialized).not.toContain(canarySecrets.gcalEventId);

      // Verify consistent public outcome
      expect(json.success).toBe(true);
      expect(json.booking.outcome).toBe("already_cancelled");
      expect(json.booking.status).toBe("cancelled");
      expect(json.booking.hostName).toBe("Host Bob");
      expect(json.booking.host).toBeUndefined();
    });
  });

  /* -------------------------------------------------------------------------- */
  /*  5. Cancellation-Specific Google Calendar Cleanup & Retry                 */
  /* -------------------------------------------------------------------------- */
  describe("5. Dedicated Cancellation Calendar Cleanup & Retry", () => {
    it("reports not_applicable if cancelled booking has no Google Calendar event ID", async () => {
      mockFindClient.mockResolvedValueOnce({
        id: "b-no-gcal",
        hostId: "host-1",
        status: "cancelled",
        gcalEventId: null,
        host: { id: "host-1" },
      });

      const result = await retryCancelledBookingCalendarCleanup("b-no-gcal", "host-1");
      expect(result.success).toBe(true);
      expect(result.status).toBe("not_applicable");
    });

    it("rejects retry if booking is not in cancelled state", async () => {
      mockFindClient.mockResolvedValueOnce({
        id: "b-confirmed",
        hostId: "host-1",
        status: "confirmed",
        host: { id: "host-1" },
      });

      const result = await retryCancelledBookingCalendarCleanup("b-confirmed", "host-1");
      expect(result.success).toBe(false);
      expect(result.error).toContain("not cancelled");
    });

    it("rejects retry if host does not own the booking", async () => {
      mockFindClient.mockResolvedValueOnce(null);

      const result = await retryCancelledBookingCalendarCleanup("b-owned-by-other", "intruder-host");
      expect(result.success).toBe(false);
      expect(result.error).toContain("not owned");
    });

    it("fails honestly when credentials are missing and records failure in DB", async () => {
      mockFindClient.mockResolvedValueOnce({
        id: "b-missing-creds",
        hostId: "host-1",
        status: "cancelled",
        gcalEventId: "gcal-evt-123",
        host: {
          id: "host-1",
          googleAccessToken: null,
          googleRefreshToken: null,
        },
      });

      const result = await retryCancelledBookingCalendarCleanup("b-missing-creds", "host-1");

      expect(result.success).toBe(false);
      expect(result.status).toBe("failed");
      expect(result.error).toContain("credentials not found");
      expect(mockUpdateSet).toHaveBeenCalledWith(
        expect.objectContaining({
          calendarSyncStatus: "failed",
          lastSyncError: expect.stringContaining("credentials not found"),
        })
      );
    });

    it("successfully deletes event and updates status to not_applicable and clears error", async () => {
      mockFindClient.mockResolvedValueOnce({
        id: "b-cleanup-success",
        hostId: "host-1",
        status: "cancelled",
        gcalEventId: "gcal-evt-456",
        host: {
          id: "host-1",
          googleAccessToken: "valid-access",
        },
      });

      mockDeleteGoogle.mockResolvedValueOnce({ status: 204 });
      mockUpdateReturning.mockResolvedValueOnce([{ id: "b-cleanup-success", calendarSyncStatus: "not_applicable" }]);

      const result = await retryCancelledBookingCalendarCleanup("b-cleanup-success", "host-1");

      expect(result.success).toBe(true);
      expect(result.status).toBe("cleaned");
      expect(mockUpdateSet).toHaveBeenCalledWith(
        expect.objectContaining({
          calendarSyncStatus: "not_applicable",
          lastSyncError: null,
        })
      );
    });

    it("handles already-removed event (404/410) as successful cleanup", async () => {
      mockFindClient.mockResolvedValueOnce({
        id: "b-already-removed",
        hostId: "host-1",
        status: "cancelled",
        gcalEventId: "gcal-evt-789",
        host: {
          id: "host-1",
          googleAccessToken: "valid-access",
        },
      });

      const notFoundErr = new Error("Resource has been deleted");
      (notFoundErr as unknown as { code: number }).code = 404;
      mockDeleteGoogle.mockRejectedValueOnce(notFoundErr);
      mockUpdateReturning.mockResolvedValueOnce([{ id: "b-already-removed", calendarSyncStatus: "not_applicable" }]);

      const result = await retryCancelledBookingCalendarCleanup("b-already-removed", "host-1");

      expect(result.success).toBe(true);
      expect(result.status).toBe("cleaned");
      expect(result.alreadyRemoved).toBe(true);
      expect(mockUpdateSet).toHaveBeenCalledWith(
        expect.objectContaining({
          calendarSyncStatus: "not_applicable",
          lastSyncError: null,
        })
      );
    });
  });

  /* -------------------------------------------------------------------------- */
  /*  6. Notifications Outbox, Idempotency & Provider Resilience                */
  /* -------------------------------------------------------------------------- */
  describe("6. Notifications Outbox & Delivery Resilience", () => {
    it("generates distinct idempotency keys per notification type to prevent collisions", () => {
      const approvalKey = generateResendIdempotencyKey("booking-99", "approval");
      const guestCancelKey = generateResendIdempotencyKey("booking-99", "guest_cancellation");
      const hostCancelKey = generateResendIdempotencyKey("booking-99", "host_cancellation");

      expect(approvalKey).not.toEqual(guestCancelKey);
      expect(guestCancelKey).not.toEqual(hostCancelKey);
      expect(guestCancelKey).toContain("guest_cancellation");
      expect(hostCancelKey).toContain("host_cancellation");
    });

    it("sends guest cancellation email to host with Resend Idempotency-Key", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: "resend-msg-1" }),
      });

      const sent = await sendGuestCancellationEmail(
        {
          toEmail: "host@example.com",
          hostName: "Host Bob",
          guestName: "Guest Alice",
          guestEmail: "alice@example.com",
          eventTitle: "Strategy",
          dateStr: "2026-11-04",
          timeStr: "15:00",
          reason: "Emergency",
        },
        "idemp-guest-cancel-key"
      );

      expect(sent).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.resend.com/emails",
        expect.objectContaining({
          headers: expect.objectContaining({
            "Idempotency-Key": "idemp-guest-cancel-key",
          }),
        })
      );
    });

    it("records delivery failure when Resend returns non-200 status", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 422,
        text: async () => "Invalid recipient email domain",
      });

      const sent = await sendHostCancellationEmail({
        toEmail: "bad@invalid-domain.xyz",
        guestName: "Guest",
        hostName: "Host",
        eventTitle: "Meeting",
        dateStr: "2026-11-04",
        timeStr: "10:00",
      });

      expect(sent).toBe(false);
    });
  });

  /* -------------------------------------------------------------------------- */
  /*  7. Real PostgreSQL Integration Tests (When TEST_DATABASE_URL is set)       */
  /* -------------------------------------------------------------------------- */
  const testDbUrl = process.env.TEST_DATABASE_URL;
  const describeIntegration = testDbUrl ? describe : describe.skip;

  if (!testDbUrl) {
    console.log(
      "\n===================================================================================\n" +
      "[NOTICE] Task 008.1 Real PostgreSQL Concurrency Integration Tests Skipped:\n" +
      "TEST_DATABASE_URL is not configured. Real PostgreSQL concurrency tests require an isolated test database.\n" +
      "To provision and run:\n" +
      "  1. Provision an isolated PostgreSQL / Neon test database branch.\n" +
      "  2. Apply migrations: DATABASE_URL=<test-url> pnpm run db:migrate\n" +
      "  3. Run: TEST_DATABASE_URL=<test-url> pnpm test tests/scheduling/phase1-3-3-task008.test.ts\n" +
      "===================================================================================\n"
    );
  }

  describeIntegration("7. Genuine PostgreSQL Concurrency Integration Tests", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let testDb: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let rawSql: any;
    const testHostId = crypto.randomUUID();
    const testEventTypeId = crypto.randomUUID();
    const testBookingId = crypto.randomUUID();
    const testCancelToken = "integration-cancel-token-" + crypto.randomUUID();

    beforeAll(async () => {
      if (process.env.NODE_ENV === "production") {
        throw new Error("Refusing to run destructive integration tests in production environment!");
      }
      if (isSameDatabase(testDbUrl, process.env.DATABASE_URL)) {
        throw new Error("Refusing to run tests: TEST_DATABASE_URL points to the same database as DATABASE_URL!");
      }

      rawSql = neon(testDbUrl!);
      testDb = drizzle(rawSql, { schema });

      // Create isolated test user
      await testDb.insert(schema.users).values({
        id: testHostId,
        email: `test-cancel-host-${Date.now()}@example.com`,
        name: "Integration Test Host",
        slug: `cancel-host-${Date.now()}`,
        timezone: "UTC",
      });

      // Create isolated event type
      await testDb.insert(schema.eventTypes).values({
        id: testEventTypeId,
        userId: testHostId,
        title: "Integration Concurrency Event",
        slug: `concurrency-event-${Date.now()}`,
        durationMins: 30,
      });

      // Create isolated confirmed booking
      const startTime = new Date(Date.now() + 86400000);
      const endTime = new Date(startTime.getTime() + 1800000);

      await testDb.insert(schema.bookings).values({
        id: testBookingId,
        hostId: testHostId,
        eventTypeId: testEventTypeId,
        guestName: "Integration Guest",
        guestEmail: "guest@example.com",
        guestTimezone: "UTC",
        startTime,
        endTime,
        bufferStartTime: startTime,
        bufferEndTime: endTime,
        status: "confirmed",
        cancelToken: testCancelToken,
      });
    });

    afterAll(async () => {
      if (testDb) {
        await testDb.delete(schema.bookings).where(eq(schema.bookings.id, testBookingId));
        await testDb.delete(schema.eventTypes).where(eq(schema.eventTypes.id, testEventTypeId));
        await testDb.delete(schema.users).where(eq(schema.users.id, testHostId));
      }
    });

    it("two concurrent cancellation requests: exactly one wins the transition, final status is cancelled", async () => {
      // Execute two simultaneous atomic updates on the exact same booking row
      const [attempt1, attempt2] = await Promise.all([
        testDb
          .update(schema.bookings)
          .set({
            status: "cancelled",
            cancelledAt: new Date(),
            cancellationReason: "Concurrent Attempt 1",
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(schema.bookings.id, testBookingId),
              inArray(schema.bookings.status, ["confirmed", "pending"])
            )
          )
          .returning(),
        testDb
          .update(schema.bookings)
          .set({
            status: "cancelled",
            cancelledAt: new Date(),
            cancellationReason: "Concurrent Attempt 2",
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(schema.bookings.id, testBookingId),
              inArray(schema.bookings.status, ["confirmed", "pending"])
            )
          )
          .returning(),
      ]);

      const wins = [attempt1.length === 1, attempt2.length === 1].filter(Boolean).length;
      expect(wins).toBe(1);

      // Verify final database state
      const [finalRow] = await testDb
        .select()
        .from(schema.bookings)
        .where(eq(schema.bookings.id, testBookingId));

      expect(finalRow.status).toBe("cancelled");
      expect(finalRow.cancelledAt).not.toBeNull();
      expect(finalRow.cancellationReason).toMatch(/Concurrent Attempt (1|2)/);
    });

    it("repeated cancellation on already-cancelled booking in PostgreSQL returns 0 rows updated", async () => {
      const repeated = await testDb
        .update(schema.bookings)
        .set({
          status: "cancelled",
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.bookings.id, testBookingId),
            inArray(schema.bookings.status, ["confirmed", "pending"])
          )
        )
        .returning();

      expect(repeated.length).toBe(0);
    });
  });
});
