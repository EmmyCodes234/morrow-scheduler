import { describe, it, expect } from "vitest";
import { validateBookingRequest, validateGuestDetails } from "@/lib/scheduling/validation";
import {
  HostScheduleConfig,
  EventTypeConfig,
  AvailabilityWindow,
} from "@/lib/scheduling/types";
import { buildGuestConfirmationEmail, buildHostBookingNotificationEmail } from "@/lib/email-templates";

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

  it("treats pending approval bookings as reserving their slot against new bookings", () => {
    const existingBookings = [
      {
        id: "b-pending",
        startTime: new Date("2026-11-04T13:00:00.000Z"),
        endTime: new Date("2026-11-04T13:45:00.000Z"),
        bufferStartTime: new Date("2026-11-04T12:55:00.000Z"),
        bufferEndTime: new Date("2026-11-04T14:00:00.000Z"),
        status: "pending",
      },
    ];

    const res = validateBookingRequest({
      input: {
        eventTypeId: validEventType.id,
        date: "2026-11-04",
        time: "02:00 PM",
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

  it("enforces buffer intervals against Google Calendar busy blocks", () => {
    // Google busy block: 13:00 to 14:00 UTC
    // Booking at 14:00 UTC (15:00 Lagos) has bufferBefore (5m) starting at 12:55 UTC... wait:
    // Booking at 14:00 Lagos is 13:00 UTC -> overlaps directly
    // Booking at 15:00 Lagos is 14:00 UTC. BufferBefore is 5 mins -> buffer starts at 13:55 UTC (overlaps 13:00-14:00)
    const res = validateBookingRequest({
      input: {
        eventTypeId: validEventType.id,
        date: "2026-11-04",
        time: "03:00 PM", // 14:00 UTC
        guestName: "Guest",
        guestEmail: "guest@example.com",
        guestTimezone: "Africa/Lagos",
      },
      host,
      eventType: validEventType,
      weeklyAvailability,
      overrides: [],
      existingBookings: [],
      calendarBusyBlocks: [
        {
          start: new Date("2026-11-04T13:00:00.000Z"),
          end: new Date("2026-11-04T14:00:00.000Z"),
        },
      ],
      now,
    });

    expect(res.isValid).toBe(false);
    expect(res.errorCode).toBe("CONFLICT");
  });

  it("scopes maxPerDay strictly to the specific event type", () => {
    const limitedEventType: EventTypeConfig = {
      ...validEventType,
      id: "evt-target",
      maxPerDay: 2,
    };

    // 2 existing bookings of a DIFFERENT event type
    const otherBookings = [
      {
        id: "b-diff-1",
        eventTypeId: "evt-different",
        startTime: new Date("2026-11-04T09:00:00.000Z"),
        endTime: new Date("2026-11-04T09:45:00.000Z"),
        bufferStartTime: new Date("2026-11-04T08:55:00.000Z"),
        bufferEndTime: new Date("2026-11-04T10:00:00.000Z"),
        status: "confirmed",
      },
      {
        id: "b-diff-2",
        eventTypeId: "evt-different",
        startTime: new Date("2026-11-04T10:30:00.000Z"),
        endTime: new Date("2026-11-04T11:15:00.000Z"),
        bufferStartTime: new Date("2026-11-04T10:25:00.000Z"),
        bufferEndTime: new Date("2026-11-04T11:30:00.000Z"),
        status: "confirmed",
      },
    ];

    const res = validateBookingRequest({
      input: {
        eventTypeId: limitedEventType.id,
        date: "2026-11-04",
        time: "02:00 PM",
        guestName: "Guest",
        guestEmail: "guest@example.com",
        guestTimezone: "Africa/Lagos",
      },
      host,
      eventType: limitedEventType,
      weeklyAvailability,
      overrides: [],
      existingBookings: otherBookings,
      now,
    });

    expect(res.isValid).toBe(true);

    // Now add 2 bookings belonging to the target event type
    const matchingBookings = [
      ...otherBookings,
      {
        id: "b-match-1",
        eventTypeId: "evt-target",
        startTime: new Date("2026-11-04T11:30:00.000Z"),
        endTime: new Date("2026-11-04T12:15:00.000Z"),
        bufferStartTime: new Date("2026-11-04T11:25:00.000Z"),
        bufferEndTime: new Date("2026-11-04T12:30:00.000Z"),
        status: "confirmed",
      },
      {
        id: "b-match-2",
        eventTypeId: "evt-target",
        startTime: new Date("2026-11-04T14:30:00.000Z"),
        endTime: new Date("2026-11-04T15:15:00.000Z"),
        bufferStartTime: new Date("2026-11-04T14:25:00.000Z"),
        bufferEndTime: new Date("2026-11-04T15:30:00.000Z"),
        status: "confirmed",
      },
    ];

    const resBlocked = validateBookingRequest({
      input: {
        eventTypeId: limitedEventType.id,
        date: "2026-11-04",
        time: "02:00 PM",
        guestName: "Guest",
        guestEmail: "guest@example.com",
        guestTimezone: "Africa/Lagos",
      },
      host,
      eventType: limitedEventType,
      weeklyAvailability,
      overrides: [],
      existingBookings: matchingBookings,
      now,
    });

    expect(resBlocked.isValid).toBe(false);
    expect(resBlocked.errorCode).toBe("MAX_PER_DAY");
  });

  it("formats pending approval and confirmed emails distinctly and honestly", () => {
    // Pending email
    const pendingHtml = buildGuestConfirmationEmail({
      guestName: "Alice",
      hostName: "Dr. Sarah",
      eventTitle: "Consultation",
      dateStr: "2026-11-10",
      timeStr: "10:00 AM",
      durationMins: 30,
      status: "pending",
      calendarSynced: false,
    });

    expect(pendingHtml).toContain("Pending Approval");
    expect(pendingHtml).toContain("Booking Request Received");
    expect(pendingHtml).toContain("requires host approval");
    expect(pendingHtml).not.toContain("calendar invitation has been added");

    // Confirmed email with synced calendar
    const confirmedHtml = buildGuestConfirmationEmail({
      guestName: "Alice",
      hostName: "Dr. Sarah",
      eventTitle: "Consultation",
      dateStr: "2026-11-10",
      timeStr: "10:00 AM",
      durationMins: 30,
      status: "confirmed",
      calendarSynced: true,
      locationType: "zoom",
      locationUrl: "https://zoom.us/j/123456789",
    });

    expect(confirmedHtml).toContain("Confirmed");
    expect(confirmedHtml).toContain("You're scheduled!");
    expect(confirmedHtml).toContain("calendar invitation has been added");
    expect(confirmedHtml).toContain("Zoom Meeting");
    expect(confirmedHtml).toContain("https://zoom.us/j/123456789");

    // Host notification email
    const hostPendingHtml = buildHostBookingNotificationEmail({
      hostName: "Dr. Sarah",
      guestName: "Alice",
      guestEmail: "alice@example.com",
      eventTitle: "Consultation",
      dateStr: "2026-11-10",
      timeStr: "10:00 AM",
      durationMins: 30,
      status: "pending",
      dashboardUrl: "https://usemorrow.xyz/dashboard",
    });

    expect(hostPendingHtml).toContain("Requires Approval");
    expect(hostPendingHtml).toContain("Review Request in Dashboard");
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
