import { describe, it, expect } from "vitest";
import { validateBookingRequest, validateGuestDetails } from "@/lib/scheduling/validation";
import {
  HostScheduleConfig,
  EventTypeConfig,
  AvailabilityWindow,
} from "@/lib/scheduling/types";

describe("Server-Side Booking Validation", () => {
  const host: HostScheduleConfig = {
    id: "host-uuid-1",
    name: "Dr. Sarah",
    email: "sarah@example.com",
    slug: "sarah",
    timezone: "Africa/Lagos", // UTC+1
    bufferMins: 10,
    minNoticeHours: 2,
    maxBookingDays: 30,
  };

  const validEventType: EventTypeConfig = {
    id: "evt-uuid-1",
    userId: "host-uuid-1",
    title: "Medical Consultation",
    slug: "consultation",
    durationMins: 45, // Authoritative duration: 45 minutes
    locationType: "google_meet",
    isActive: true,
    bufferBeforeMins: 5,
    bufferAfterMins: 15,
    minNoticeHours: 3,
    requiresApproval: false,
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

  const now = new Date("2026-11-04T08:00:00.000Z"); // 09:00 AM Lagos time on Wednesday

  it("rejects booking if event type does not belong to the host", () => {
    const wrongHostEventType: EventTypeConfig = {
      ...validEventType,
      userId: "different-host-uuid",
    };

    const res = validateBookingRequest({
      input: {
        eventTypeId: wrongHostEventType.id,
        date: "2026-11-04",
        time: "02:00 PM",
        guestName: "John Doe",
        guestEmail: "john@example.com",
        guestTimezone: "Africa/Lagos",
      },
      host,
      eventType: wrongHostEventType,
      weeklyAvailability,
      overrides: [],
      existingBookings: [],
      now,
    });

    expect(res.isValid).toBe(false);
    expect(res.errorCode).toBe("NOT_FOUND");
    expect(res.error).toMatch(/does not belong to this host/i);
  });

  it("rejects booking if event type is inactive", () => {
    const inactiveEventType: EventTypeConfig = {
      ...validEventType,
      isActive: false,
    };

    const res = validateBookingRequest({
      input: {
        eventTypeId: inactiveEventType.id,
        date: "2026-11-04",
        time: "02:00 PM",
        guestName: "John Doe",
        guestEmail: "john@example.com",
      },
      host,
      eventType: inactiveEventType,
      weeklyAvailability,
      overrides: [],
      existingBookings: [],
      now,
    });

    expect(res.isValid).toBe(false);
    expect(res.errorCode).toBe("INACTIVE");
    expect(res.error).toMatch(/inactive/i);
  });

  it("authoritatively derives duration and buffers from database rather than client", () => {
    const res = validateBookingRequest({
      input: {
        eventTypeId: validEventType.id,
        date: "2026-11-04",
        time: "02:00 PM", // 14:00 Lagos (13:00 UTC)
        guestName: "John Doe",
        guestEmail: "john@example.com",
        guestTimezone: "Africa/Lagos",
      },
      host,
      eventType: validEventType, // duration is 45 mins, bufferBefore is 5 mins, bufferAfter is 15 mins
      weeklyAvailability,
      overrides: [],
      existingBookings: [],
      now,
    });

    expect(res.isValid).toBe(true);
    expect(res.effectiveDurationMins).toBe(45);
    expect(res.effectiveBufferBeforeMins).toBe(5);
    expect(res.effectiveBufferAfterMins).toBe(15);

    // Start time: 14:00 Lagos = 13:00 UTC
    expect(res.startTime?.toISOString()).toBe("2026-11-04T13:00:00.000Z");
    // End time: 14:45 Lagos = 13:45 UTC (45 min duration)
    expect(res.endTime?.toISOString()).toBe("2026-11-04T13:45:00.000Z");
    // Buffer start: 13:55 Lagos = 12:55 UTC (5 min before)
    expect(res.bufferStartTime?.toISOString()).toBe("2026-11-04T12:55:00.000Z");
    // Buffer end: 15:00 Lagos = 14:00 UTC (15 min after)
    expect(res.bufferEndTime?.toISOString()).toBe("2026-11-04T14:00:00.000Z");
  });

  it("rejects appointments in the past", () => {
    const pastNow = new Date("2026-11-05T10:00:00.000Z");
    const res = validateBookingRequest({
      input: {
        eventTypeId: validEventType.id,
        date: "2026-11-04",
        time: "02:00 PM",
        guestName: "John Doe",
        guestEmail: "john@example.com",
        guestTimezone: "Africa/Lagos",
      },
      host,
      eventType: validEventType,
      weeklyAvailability,
      overrides: [],
      existingBookings: [],
      now: pastNow,
    });

    expect(res.isValid).toBe(false);
    expect(res.errorCode).toBe("PAST_APPOINTMENT");
  });

  it("rejects appointments violating minimum notice (3 hours)", () => {
    // now is 08:00 UTC (09:00 Lagos)
    // 3 hours min notice means earliest allowed is 11:00 UTC (12:00 Lagos)
    // A booking at 10:00 AM Lagos is only 1 hour notice -> rejected!
    const res = validateBookingRequest({
      input: {
        eventTypeId: validEventType.id,
        date: "2026-11-04",
        time: "10:00 AM",
        guestName: "John Doe",
        guestEmail: "john@example.com",
        guestTimezone: "Africa/Lagos",
      },
      host,
      eventType: validEventType,
      weeklyAvailability,
      overrides: [],
      existingBookings: [],
      now,
    });

    expect(res.isValid).toBe(false);
    expect(res.errorCode).toBe("MIN_NOTICE");
  });

  it("rejects bookings that overlap with existing appointments and buffers", () => {
    // Existing appointment: 02:00 PM to 02:45 PM Lagos (13:00 to 13:45 UTC)
    // Buffer: 12:55 to 14:00 UTC
    const existingBookings = [
      {
        id: "b-existing",
        startTime: new Date("2026-11-04T13:00:00.000Z"),
        endTime: new Date("2026-11-04T13:45:00.000Z"),
        bufferStartTime: new Date("2026-11-04T12:55:00.000Z"),
        bufferEndTime: new Date("2026-11-04T14:00:00.000Z"),
        status: "confirmed",
      },
    ];

    // Attempting to book at 02:30 PM Lagos (13:30 UTC)
    const res = validateBookingRequest({
      input: {
        eventTypeId: validEventType.id,
        date: "2026-11-04",
        time: "02:30 PM",
        guestName: "Second Guest",
        guestEmail: "guest2@example.com",
        guestTimezone: "Africa/Lagos",
      },
      host,
      eventType: validEventType,
      weeklyAvailability,
      overrides: [],
      existingBookings,
      now,
    });

    expect(res.isValid).toBe(false);
    expect(res.errorCode).toBe("CONFLICT");
  });

  it("validates guest inputs strictly", () => {
    expect(validateGuestDetails({ guestName: "", guestEmail: "valid@email.com" }).isValid).toBe(false);
    expect(validateGuestDetails({ guestName: "A".repeat(101), guestEmail: "valid@email.com" }).isValid).toBe(false);
    expect(validateGuestDetails({ guestName: "John", guestEmail: "not-an-email" }).isValid).toBe(false);
    expect(validateGuestDetails({ guestName: "John", guestEmail: "john@example.com", guestNotes: "A".repeat(1001) }).isValid).toBe(false);
    expect(validateGuestDetails({ guestName: "John", guestEmail: "john@example.com", additionalGuests: "bad-guest-email" }).isValid).toBe(false);
    expect(validateGuestDetails({ guestName: "John", guestEmail: "john@example.com", additionalGuests: "colleague@example.com" }).isValid).toBe(true);
  });
});
