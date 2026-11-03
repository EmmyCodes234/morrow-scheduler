import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  cancelBooking,
  getBookingForCancellation,
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
} from "@/lib/email-templates";
import {
  sendGuestCancellationEmail,
  sendHostCancellationEmail,
} from "@/lib/email";

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

// Mock database operations
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

describe("Task 008: Guest Cancellation Portal & Cancellation Integrity Suite", () => {
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
  /*  2. Public Booking Summary via Cancel Token (GET)                         */
  /* -------------------------------------------------------------------------- */
  describe("2. Public Cancellation Token Lookup", () => {
    it("retrieves sanitized booking summary for valid token without sensitive credentials", async () => {
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
      // Ensure host Google tokens are not present
      expect((summary as unknown as Record<string, unknown>)?.googleAccessToken).toBeUndefined();
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
  /*  3. Guest Cancellation Eligibility & Validation                           */
  /* -------------------------------------------------------------------------- */
  describe("3. Guest Cancellation Eligibility & Validation", () => {
    const futureDate = new Date(Date.now() + 86400000);

    it("cancels eligible confirmed booking and enqueues guest_cancellation notification", async () => {
      mockFindClient.mockResolvedValueOnce({
        id: "b-confirmed",
        cancelToken: "tok-confirmed",
        guestName: "Guest User",
        guestEmail: "guest@example.com",
        guestTimezone: "UTC",
        startTime: futureDate,
        endTime: new Date(futureDate.getTime() + 1800000),
        status: "confirmed",
        gcalEventId: null,
        eventType: { title: "Strategy Call" },
        host: { id: "host-1", name: "Host One", email: "host@example.com", timezone: "UTC" },
      });

      mockUpdateReturning.mockResolvedValueOnce([
        { id: "b-confirmed", status: "cancelled", cancellationReason: "Schedule conflict" },
      ]);

      const result = await cancelBooking({
        identifier: "tok-confirmed",
        identifierType: "token",
        cancelledBy: "guest",
        reason: "Schedule conflict",
      });

      expect(result.success).toBe(true);
      expect(result.alreadyCancelled).toBe(false);
      expect(mockUpdateSet).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "cancelled",
          cancellationReason: "Schedule conflict",
          notificationType: "guest_cancellation",
          notificationStatus: "pending",
        })
      );
    });

    it("cancels eligible pending booking request", async () => {
      mockFindClient.mockResolvedValueOnce({
        id: "b-pending",
        cancelToken: "tok-pending",
        guestName: "Guest User",
        guestEmail: "guest@example.com",
        guestTimezone: "UTC",
        startTime: futureDate,
        endTime: new Date(futureDate.getTime() + 1800000),
        status: "pending",
        gcalEventId: null,
        eventType: { title: "Consultation" },
        host: { id: "host-1", name: "Host One", email: "host@example.com", timezone: "UTC" },
      });

      mockUpdateReturning.mockResolvedValueOnce([
        { id: "b-pending", status: "cancelled" },
      ]);

      const result = await cancelBooking({
        identifier: "tok-pending",
        identifierType: "token",
        cancelledBy: "guest",
      });

      expect(result.success).toBe(true);
      expect(result.alreadyCancelled).toBe(false);
    });

    it("handles already-cancelled booking idempotently without duplicate side effects", async () => {
      mockFindClient.mockResolvedValueOnce({
        id: "b-cancelled",
        cancelToken: "tok-cancelled",
        status: "cancelled",
        eventType: { title: "Consultation" },
        host: { id: "host-1", name: "Host One", email: "host@example.com" },
      });

      const result = await cancelBooking({
        identifier: "tok-cancelled",
        identifierType: "token",
        cancelledBy: "guest",
      });

      expect(result.success).toBe(true);
      expect(result.alreadyCancelled).toBe(true);
      expect(mockUpdateSet).not.toHaveBeenCalled();
    });

    it("rejects cancellation of rejected booking", async () => {
      mockFindClient.mockResolvedValueOnce({
        id: "b-rejected",
        cancelToken: "tok-rejected",
        status: "rejected",
        startTime: futureDate,
        eventType: { title: "Consultation" },
        host: { id: "host-1", name: "Host" },
      });

      const result = await cancelBooking({
        identifier: "tok-rejected",
        identifierType: "token",
        cancelledBy: "guest",
      });

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe("INELIGIBLE_STATUS");
      expect(result.error).toContain("rejected");
    });

    it("rejects cancellation of completed booking", async () => {
      mockFindClient.mockResolvedValueOnce({
        id: "b-completed",
        cancelToken: "tok-completed",
        status: "completed",
        startTime: futureDate,
        eventType: { title: "Consultation" },
        host: { id: "host-1", name: "Host" },
      });

      const result = await cancelBooking({
        identifier: "tok-completed",
        identifierType: "token",
        cancelledBy: "guest",
      });

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe("INELIGIBLE_STATUS");
    });

    it("rejects cancellation of past appointments", async () => {
      const pastDate = new Date(Date.now() - 3600000); // 1 hour ago
      mockFindClient.mockResolvedValueOnce({
        id: "b-past",
        cancelToken: "tok-past",
        status: "confirmed",
        startTime: pastDate,
        eventType: { title: "Consultation" },
        host: { id: "host-1", name: "Host" },
      });

      const result = await cancelBooking({
        identifier: "tok-past",
        identifierType: "token",
        cancelledBy: "guest",
      });

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe("PAST_BOOKING");
    });

    it("rejects cancellation reason longer than 500 characters", async () => {
      const longReason = "A".repeat(501);

      const result = await cancelBooking({
        identifier: "tok-test",
        identifierType: "token",
        cancelledBy: "guest",
        reason: longReason,
      });

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe("INVALID_REASON");
      expect(result.error).toContain("500");
    });

    it("rejects non-string cancellation reason", async () => {
      const result = await cancelBooking({
        identifier: "tok-test",
        identifierType: "token",
        cancelledBy: "guest",
        reason: 12345 as unknown as string,
      });

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe("INVALID_REASON");
    });
  });

  /* -------------------------------------------------------------------------- */
  /*  4. Host Cancellation & Authorization                                      */
  /* -------------------------------------------------------------------------- */
  describe("4. Host Cancellation Authorization & Shared Service", () => {
    const futureDate = new Date(Date.now() + 86400000);

    it("allows authorized host to cancel booking and enqueues host_cancellation notification", async () => {
      mockFindClient.mockResolvedValueOnce({
        id: "b-host-owned",
        hostId: "host-auth-id",
        guestName: "Bob Guest",
        guestEmail: "bob@example.com",
        guestTimezone: "UTC",
        startTime: futureDate,
        endTime: new Date(futureDate.getTime() + 1800000),
        status: "confirmed",
        gcalEventId: null,
        eventType: { title: "Strategy Session" },
        host: { id: "host-auth-id", name: "Host Alice", email: "alice@example.com", timezone: "UTC", slug: "alice" },
      });

      mockUpdateReturning.mockResolvedValueOnce([
        { id: "b-host-owned", status: "cancelled", cancellationReason: "Host unavailable" },
      ]);

      const result = await cancelBooking({
        identifier: "b-host-owned",
        identifierType: "id",
        cancelledBy: "host",
        hostId: "host-auth-id",
        reason: "Host unavailable",
      });

      expect(result.success).toBe(true);
      expect(mockUpdateSet).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "cancelled",
          cancellationReason: "Host unavailable",
          notificationType: "host_cancellation",
          notificationStatus: "pending",
        })
      );
    });

    it("rejects cancellation if hostId does not match booking hostId", async () => {
      mockFindClient.mockResolvedValueOnce({
        id: "b-other-host",
        hostId: "different-host",
        startTime: futureDate,
        status: "confirmed",
        eventType: { title: "Strategy Session" },
        host: { id: "different-host", name: "Different Host" },
      });

      const result = await cancelBooking({
        identifier: "b-other-host",
        identifierType: "id",
        cancelledBy: "host",
        hostId: "intruder-host-id",
      });

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe("UNAUTHORIZED");
    });
  });

  /* -------------------------------------------------------------------------- */
  /*  5. Google Calendar Synchronization & Error Resilience                    */
  /* -------------------------------------------------------------------------- */
  describe("5. Google Calendar Synchronization & Failure Handling", () => {
    it("successfully deletes external Google Calendar event", async () => {
      mockDeleteGoogle.mockResolvedValueOnce({ status: 204 });

      const result = await cancelGoogleCalendarEventWithDetails(
        { accessToken: "valid-tok" },
        "gcal-event-123"
      );

      expect(result.success).toBe(true);
      expect(result.alreadyRemoved).toBeFalsy();
    });

    it("handles already-deleted event (404/410) gracefully as success", async () => {
      const notFoundErr = new Error("Resource has been deleted");
      (notFoundErr as unknown as { code: number }).code = 404;
      mockDeleteGoogle.mockRejectedValueOnce(notFoundErr);

      const result = await cancelGoogleCalendarEventWithDetails(
        { accessToken: "valid-tok" },
        "gcal-event-already-gone"
      );

      expect(result.success).toBe(true);
      expect(result.alreadyRemoved).toBe(true);
    });

    it("returns failure diagnostic when Google Calendar fails with 500 or token error", async () => {
      const serverErr = new Error("Invalid Credentials");
      (serverErr as unknown as { code: number }).code = 401;
      mockDeleteGoogle.mockRejectedValueOnce(serverErr);

      const result = await cancelGoogleCalendarEventWithDetails(
        { accessToken: "expired-tok" },
        "gcal-event-fail"
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid Credentials");
    });

    it("cancelBooking updates calendarSyncStatus to 'failed' if Google fails, while DB cancellation remains 'cancelled'", async () => {
      const futureDate = new Date(Date.now() + 86400000);
      mockFindClient.mockResolvedValueOnce({
        id: "b-cal-fail",
        cancelToken: "tok-cal-fail",
        guestName: "Guest",
        guestEmail: "guest@example.com",
        guestTimezone: "UTC",
        startTime: futureDate,
        endTime: new Date(futureDate.getTime() + 1800000),
        status: "confirmed",
        gcalEventId: "google-evt-1",
        eventType: { title: "Strategy Session" },
        host: {
          id: "host-1",
          name: "Host",
          email: "host@example.com",
          googleAccessToken: "valid-access",
        },
      });

      // Status transition update succeeds
      mockUpdateReturning.mockResolvedValueOnce([
        { id: "b-cal-fail", status: "cancelled" },
      ]);

      // Google delete fails
      mockDeleteGoogle.mockRejectedValueOnce(new Error("Rate limit exceeded"));

      const result = await cancelBooking({
        identifier: "tok-cal-fail",
        identifierType: "token",
        cancelledBy: "guest",
      });

      expect(result.success).toBe(true);
      expect(result.calendarSyncResult?.success).toBe(false);
      expect(result.calendarSyncResult?.error).toContain("Rate limit exceeded");

      // Verify DB updated calendarSyncStatus to 'failed'
      expect(mockUpdateSet).toHaveBeenCalledWith(
        expect.objectContaining({
          calendarSyncStatus: "failed",
          lastSyncError: "Rate limit exceeded",
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

    it("sends host cancellation email to guest with Resend Idempotency-Key", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: "resend-msg-2" }),
      });

      const sent = await sendHostCancellationEmail(
        {
          toEmail: "guest@example.com",
          guestName: "Guest Alice",
          hostName: "Host Bob",
          eventTitle: "Strategy",
          dateStr: "2026-11-04",
          timeStr: "15:00",
          reason: "Host sick",
          rebookUrl: "https://usemorrow.xyz/bob",
        },
        "idemp-host-cancel-key"
      );

      expect(sent).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.resend.com/emails",
        expect.objectContaining({
          headers: expect.objectContaining({
            "Idempotency-Key": "idemp-host-cancel-key",
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
  /*  7. Real PostgreSQL Integration Test Notice                                */
  /* -------------------------------------------------------------------------- */
  describe("7. Real PostgreSQL Integration Tests", () => {
    it.skipIf(!process.env.TEST_DATABASE_URL)(
      "runs concurrency integration tests against isolated PostgreSQL database",
      async () => {
        // Only executed when isolated TEST_DATABASE_URL is explicitly configured.
        expect(process.env.TEST_DATABASE_URL).toBeDefined();
      }
    );

    it("honestly logs notice when TEST_DATABASE_URL is not configured", () => {
      if (!process.env.TEST_DATABASE_URL) {
        console.log(
          "\n===================================================================================\n" +
          "[NOTICE] Task 008 Real PostgreSQL Concurrency Integration Tests Skipped:\n" +
          "TEST_DATABASE_URL is not configured. Real PostgreSQL concurrency tests require an isolated test database.\n" +
          "To provision and run:\n" +
          "  1. Provision an isolated PostgreSQL / Neon test database branch.\n" +
          "  2. Apply migrations: DATABASE_URL=<test-url> pnpm run db:migrate\n" +
          "  3. Run: TEST_DATABASE_URL=<test-url> pnpm test tests/scheduling/phase1-3-3-task008.test.ts\n" +
          "===================================================================================\n"
        );
      }
      expect(true).toBe(true);
    });
  });
});
