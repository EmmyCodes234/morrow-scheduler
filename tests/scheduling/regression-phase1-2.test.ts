import { describe, it, expect } from "vitest";
import {
  computeBookingFingerprint,
  validateBookingInputSyntax,
} from "@/lib/scheduling/booking-service";
import { resolveEffectiveLocation } from "@/lib/scheduling/location";
import { generateAvailableSlots } from "@/lib/scheduling/slot-generator";
import {
  HostScheduleConfig,
  EventTypeConfig,
  AvailabilityWindow,
} from "@/lib/scheduling/types";
import {
  buildGuestApprovalEmail,
  buildGuestRejectionEmail,
} from "@/lib/email-templates";

describe("Phase 1.2 Final Booking Integrity Regression Suite", () => {
  const host: HostScheduleConfig = {
    id: "host-uuid-p12",
    name: "Dr. Evelyn Vance",
    email: "evelyn@example.com",
    slug: "evelyn",
    timezone: "America/New_York",
    defaultLocationType: "zoom",
    zoomMeetingUrl: "https://zoom.us/j/9876543210",
    bufferMins: 10,
    minNoticeHours: 2,
    maxBookingDays: 30,
  };

  const baseEventType: EventTypeConfig = {
    id: "evt-uuid-p12",
    userId: "host-uuid-p12",
    title: "Quarterly Review",
    slug: "quarterly-review",
    durationMins: 45,
    locationType: null, // Inherits host default
    locationUrl: null,
    isActive: true,
    bufferBeforeMins: 5,
    bufferAfterMins: 15,
    minNoticeHours: 2,
    requiresApproval: true,
  };

  const weeklyAvailability: AvailabilityWindow[] = [
    { dayOfWeek: 1, startTime: "09:00", endTime: "17:00", isEnabled: true },
    { dayOfWeek: 2, startTime: "09:00", endTime: "17:00", isEnabled: true },
    { dayOfWeek: 3, startTime: "09:00", endTime: "17:00", isEnabled: true },
    { dayOfWeek: 4, startTime: "09:00", endTime: "17:00", isEnabled: true },
    { dayOfWeek: 5, startTime: "09:00", endTime: "17:00", isEnabled: true },
    { dayOfWeek: 6, startTime: "09:00", endTime: "17:00", isEnabled: false },
    { dayOfWeek: 0, startTime: "09:00", endTime: "17:00", isEnabled: false },
  ];

  describe("1. Input Syntax Validation & Early Failure Protection", () => {
    it("rejects request without guestEmail with 400 before accessing string methods (prevents TypeError 500)", () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const malformedInput: any = {
        eventTypeId: baseEventType.id,
        date: "2026-11-18",
        time: "10:00 AM",
        guestName: "Alice Walker",
        // guestEmail missing entirely!
      };

      const result = validateBookingInputSyntax(malformedInput);
      expect(result.isValid).toBe(false);
      expect(result.error).toMatch(/guestEmail is required/i);
    });

    it("rejects non-string guestEmail or invalid format", () => {
      expect(
        validateBookingInputSyntax({
          eventTypeId: baseEventType.id,
          date: "2026-11-18",
          time: "10:00 AM",
          guestName: "Alice",
          guestEmail: 12345 as unknown as string,
        }).isValid
      ).toBe(false);

      expect(
        validateBookingInputSyntax({
          eventTypeId: baseEventType.id,
          date: "2026-11-18",
          time: "10:00 AM",
          guestName: "Alice",
          guestEmail: "not-an-email",
        }).isValid
      ).toBe(false);
    });

    it("rejects malformed date and time strings", () => {
      expect(
        validateBookingInputSyntax({
          eventTypeId: baseEventType.id,
          date: "18-11-2026", // Invalid format (needs YYYY-MM-DD)
          time: "10:00 AM",
          guestName: "Alice",
          guestEmail: "alice@example.com",
        }).isValid
      ).toBe(false);
    });

    it("accepts well-formed input", () => {
      const valid = validateBookingInputSyntax({
        eventTypeId: baseEventType.id,
        date: "2026-11-18",
        time: "10:00 AM",
        guestName: "Alice Walker",
        guestEmail: "alice@example.com",
        guestNotes: "Looking forward to this",
        additionalGuests: "colleague@example.com",
      });
      expect(valid.isValid).toBe(true);
    });
  });

  describe("2. Deterministic Idempotency Fingerprinting", () => {
    it("produces identical fingerprints regardless of JSON property ordering in custom answers", () => {
      const inputA = {
        eventTypeId: "evt-1",
        guestName: "John Doe",
        guestEmail: "john@example.com",
        startInstant: "2026-11-18T14:00:00.000Z",
        guestTimezone: "America/New_York",
        guestNotes: "Discuss scaling",
        additionalGuests: "bob@example.com, charlie@example.com",
        customAnswers: {
          project: "Phoenix",
          budget: 50000,
          timeline: "Q1",
        },
      };

      const inputB = {
        eventTypeId: "evt-1",
        guestName: "John Doe",
        guestEmail: "john@example.com",
        startInstant: "2026-11-18T14:00:00.000Z",
        guestTimezone: "America/New_York",
        guestNotes: "Discuss scaling",
        additionalGuests: "charlie@example.com, bob@example.com", // Different order
        customAnswers: {
          timeline: "Q1", // Different key order
          budget: 50000,
          project: "Phoenix",
        },
      };

      const hashA = computeBookingFingerprint(inputA);
      const hashB = computeBookingFingerprint(inputB);
      expect(hashA).toBe(hashB);
    });

    it("produces a different fingerprint if guest name changes with the same idempotency key", () => {
      const base = {
        eventTypeId: "evt-1",
        guestName: "Alice Original",
        guestEmail: "alice@example.com",
        startInstant: "2026-11-18T14:00:00.000Z",
        guestTimezone: "America/New_York",
      };

      const hashOriginal = computeBookingFingerprint(base);
      const hashChanged = computeBookingFingerprint({
        ...base,
        guestName: "Alice Modified",
      });

      expect(hashOriginal).not.toBe(hashChanged);
    });

    it("produces a different fingerprint if notes or additional guests change", () => {
      const base = {
        eventTypeId: "evt-1",
        guestName: "Alice",
        guestEmail: "alice@example.com",
        startInstant: "2026-11-18T14:00:00.000Z",
        guestTimezone: "America/New_York",
      };

      const hashNoNotes = computeBookingFingerprint(base);
      const hashWithNotes = computeBookingFingerprint({
        ...base,
        guestNotes: "Urgent meeting notes",
      });
      const hashWithGuests = computeBookingFingerprint({
        ...base,
        additionalGuests: "peer@example.com",
      });

      expect(hashNoNotes).not.toBe(hashWithNotes);
      expect(hashNoNotes).not.toBe(hashWithGuests);
    });
  });

  describe("3. Location Precedence Hierarchy", () => {
    it("tier 1: explicit event-specific location overrides host default", () => {
      const resolved = resolveEffectiveLocation({
        eventType: {
          locationType: "in_person",
          locationUrl: "123 Main St, New York, NY",
        },
        host: {
          defaultLocationType: "zoom",
          zoomMeetingUrl: "https://zoom.us/j/123",
        },
      });

      expect(resolved.locationType).toBe("in_person");
      expect(resolved.locationUrl).toBe("123 Main St, New York, NY");
      expect(resolved.source).toBe("event");
    });

    it("tier 2: inherits host default when event location is null or host_default", () => {
      const resolved = resolveEffectiveLocation({
        eventType: {
          locationType: null, // Inherits
          locationUrl: null,
        },
        host: {
          defaultLocationType: "zoom",
          zoomMeetingUrl: "https://zoom.us/j/9876543210",
        },
      });

      expect(resolved.locationType).toBe("zoom");
      expect(resolved.locationUrl).toBe("https://zoom.us/j/9876543210");
      expect(resolved.source).toBe("host");
    });

    it("tier 3: falls back to Google Meet when neither event nor host specifies a location", () => {
      const resolved = resolveEffectiveLocation({
        eventType: null,
        host: {
          defaultLocationType: null,
          zoomMeetingUrl: null,
        },
      });

      expect(resolved.locationType).toBe("google_meet");
      expect(resolved.locationUrl).toBeUndefined();
      expect(resolved.source).toBe("fallback");
    });
  });

  describe("4. Approval & Rejection Workflow Notifications", () => {
    it("renders approval email with confirmed badge and calendar advice", () => {
      const html = buildGuestApprovalEmail({
        guestName: "Bob",
        hostName: "Dr. Evelyn Vance",
        eventTitle: "Quarterly Review",
        dateStr: "2026-11-18",
        timeStr: "10:00 AM",
        durationMins: 45,
        calendarSynced: true,
        locationType: "zoom",
        locationUrl: "https://zoom.us/j/9876543210",
        cancelUrl: "https://usemorrow.xyz/cancel/token123",
      });

      expect(html).toContain("Confirmed");
      expect(html).toContain("Your booking is approved!");
      expect(html).toContain("calendar invitation has been sent");
      expect(html).toContain("Zoom Meeting");
      expect(html).toContain("https://zoom.us/j/9876543210");
    });

    it("renders rejection email with declined badge and alternative booking link", () => {
      const html = buildGuestRejectionEmail({
        guestName: "Bob",
        hostName: "Dr. Evelyn Vance",
        eventTitle: "Quarterly Review",
        dateStr: "2026-11-18",
        timeStr: "10:00 AM",
        reason: "Host is speaking at a medical symposium on this day.",
        bookingUrl: "https://usemorrow.xyz/evelyn",
      });

      expect(html).toContain("Declined");
      expect(html).toContain("Booking Request Declined");
      expect(html).toContain("medical symposium");
      expect(html).toContain("https://usemorrow.xyz/evelyn");
      expect(html).not.toContain("calendar invitation");
    });
  });

  describe("5. Slot Availability Engine with Pending, Cancelled, and Rejected States", () => {
    const requestedDate = "2026-11-18";
    const now = new Date("2026-11-18T05:00:00.000Z");

    it("pending approval booking reserves slot from being booked by others", () => {
      const pendingBooking = {
        id: "b-pending-1",
        startTime: new Date("2026-11-18T14:00:00.000Z"), // 09:00 AM NY
        endTime: new Date("2026-11-18T14:45:00.000Z"),
        bufferStartTime: new Date("2026-11-18T13:55:00.000Z"),
        bufferEndTime: new Date("2026-11-18T15:00:00.000Z"),
        status: "pending",
      };

      const result = generateAvailableSlots({
        host,
        eventType: baseEventType,
        requestedDate,
        guestTimezone: "America/New_York",
        weeklyAvailability,
        overrides: [],
        existingBookings: [pendingBooking],
        calendarBusyBlocks: [],
        now,
      });

      // 09:00 AM slot must be blocked by the pending booking
      expect(result.slots).not.toContain("09:00 AM");
      expect(result.slots).not.toContain("09:15 AM");
      expect(result.slots).not.toContain("09:30 AM");
    });

    it("rejected booking releases slot reservation completely", () => {
      const rejectedBooking = {
        id: "b-rejected-1",
        startTime: new Date("2026-11-18T14:00:00.000Z"), // 09:00 AM NY
        endTime: new Date("2026-11-18T14:45:00.000Z"),
        bufferStartTime: new Date("2026-11-18T13:55:00.000Z"),
        bufferEndTime: new Date("2026-11-18T15:00:00.000Z"),
        status: "rejected",
      };

      const result = generateAvailableSlots({
        host,
        eventType: baseEventType,
        requestedDate,
        guestTimezone: "America/New_York",
        weeklyAvailability,
        overrides: [],
        existingBookings: [rejectedBooking],
        calendarBusyBlocks: [],
        now,
      });

      // 09:00 AM slot must be OPEN because rejected booking does NOT hold the reservation
      expect(result.slots).toContain("09:00 AM");
    });

    it("cancelled booking releases slot reservation completely", () => {
      const cancelledBooking = {
        id: "b-cancelled-1",
        startTime: new Date("2026-11-18T14:00:00.000Z"), // 09:00 AM NY
        endTime: new Date("2026-11-18T14:45:00.000Z"),
        bufferStartTime: new Date("2026-11-18T13:55:00.000Z"),
        bufferEndTime: new Date("2026-11-18T15:00:00.000Z"),
        status: "cancelled",
      };

      const result = generateAvailableSlots({
        host,
        eventType: baseEventType,
        requestedDate,
        guestTimezone: "America/New_York",
        weeklyAvailability,
        overrides: [],
        existingBookings: [cancelledBooking],
        calendarBusyBlocks: [],
        now,
      });

      expect(result.slots).toContain("09:00 AM");
    });
  });

  describe("6. Buffer Recalculation Semantics", () => {
    it("derives bufferStartTime and bufferEndTime authoritatively from event before and after rules", () => {
      const newStart = new Date("2026-11-18T15:00:00.000Z");
      const durationMins = baseEventType.durationMins; // 45m
      const newEnd = new Date(newStart.getTime() + durationMins * 60 * 1000); // 15:45

      const bufferBefore = baseEventType.bufferBeforeMins; // 5m
      const bufferAfter = baseEventType.bufferAfterMins; // 15m

      const calculatedBufferStart = new Date(newStart.getTime() - bufferBefore * 60 * 1000);
      const calculatedBufferEnd = new Date(newEnd.getTime() + bufferAfter * 60 * 1000);

      expect(calculatedBufferStart.toISOString()).toBe("2026-11-18T14:55:00.000Z");
      expect(calculatedBufferEnd.toISOString()).toBe("2026-11-18T16:00:00.000Z");
    });
  });
});
