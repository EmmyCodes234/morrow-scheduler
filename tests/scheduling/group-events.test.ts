import { describe, it, expect } from "vitest";
import { generateAvailableSlots } from "@/lib/scheduling/slot-generator";
import { validateBookingRequest } from "@/lib/scheduling/validation";
import {
  HostScheduleConfig,
  EventTypeConfig,
  AvailabilityWindow,
} from "@/lib/scheduling/types";

describe("Group Event Scheduling Engine (Phase 2)", () => {
  const host: HostScheduleConfig = {
    id: "host-group-1",
    name: "Dr. Morrow",
    email: "host@morrow.xyz",
    slug: "drmorrow",
    timezone: "America/New_York",
    bufferMins: 0,
    minNoticeHours: 0,
    maxBookingDays: 30,
  };

  const groupEventType: EventTypeConfig = {
    id: "evt-group-workshop",
    userId: "host-group-1",
    title: "Community Workshop",
    slug: "workshop",
    durationMins: 30,
    isActive: true,
    bufferBeforeMins: 0,
    bufferAfterMins: 0,
    minNoticeHours: 0,
    requiresApproval: false,
    maxAttendees: 5,
    showRemainingSpots: true,
  };

  const weeklySchedule: AvailabilityWindow[] = [
    { dayOfWeek: 1, startTime: "09:00", endTime: "12:00", isEnabled: true }, // Monday
  ];

  const now = new Date("2026-11-09T08:00:00Z"); // Monday
  const requestedDate = "2026-11-09";
  const guestTimezone = "America/New_York";

  it("should generate group slots with remaining spots equal to maxAttendees when no bookings exist", () => {
    const result = generateAvailableSlots({
      host,
      eventType: groupEventType,
      requestedDate,
      guestTimezone,
      weeklyAvailability: weeklySchedule,
      overrides: [],
      existingBookings: [],
      calendarBusyBlocks: [],
      now,
    });

    expect(result.slots.length).toBeGreaterThan(0);
    const firstSlot = result.slotsDetail[0];
    expect(firstSlot.maxAttendees).toBe(5);
    expect(firstSlot.spotsRemaining).toBe(5);
  });

  it("should keep slot open with spotsRemaining = 4 when 1 attendee has already booked", () => {
    // 09:00 AM EST is 14:00 UTC
    const slotStartUtc = new Date("2026-11-09T14:00:00Z");
    const slotEndUtc = new Date("2026-11-09T14:30:00Z");

    const result = generateAvailableSlots({
      host,
      eventType: groupEventType,
      requestedDate,
      guestTimezone,
      weeklyAvailability: weeklySchedule,
      overrides: [],
      existingBookings: [
        {
          id: "booking-attendee-1",
          eventTypeId: groupEventType.id,
          startTime: slotStartUtc,
          endTime: slotEndUtc,
          bufferStartTime: slotStartUtc,
          bufferEndTime: slotEndUtc,
          status: "confirmed",
          attendeeCount: 1,
        },
      ],
      // Google Calendar reports host as busy because Morrow created the calendar event!
      calendarBusyBlocks: [
        {
          start: slotStartUtc,
          end: slotEndUtc,
        },
      ],
      now,
    });

    const targetSlot = result.slotsDetail.find((s) => s.time === "09:00 AM");
    expect(targetSlot).toBeDefined();
    expect(targetSlot?.spotsRemaining).toBe(4);
    expect(targetSlot?.maxAttendees).toBe(5);
  });

  it("should exclude group slot when capacity reaches maxAttendees (5/5)", () => {
    const slotStartUtc = new Date("2026-11-09T14:00:00Z");
    const slotEndUtc = new Date("2026-11-09T14:30:00Z");

    const result = generateAvailableSlots({
      host,
      eventType: groupEventType,
      requestedDate,
      guestTimezone,
      weeklyAvailability: weeklySchedule,
      overrides: [],
      existingBookings: [
        {
          id: "booking-full",
          eventTypeId: groupEventType.id,
          startTime: slotStartUtc,
          endTime: slotEndUtc,
          bufferStartTime: slotStartUtc,
          bufferEndTime: slotEndUtc,
          status: "confirmed",
          attendeeCount: 5,
        },
      ],
      calendarBusyBlocks: [
        {
          start: slotStartUtc,
          end: slotEndUtc,
        },
      ],
      now,
    });

    const targetSlot = result.slotsDetail.find((s) => s.time === "09:00 AM");
    expect(targetSlot).toBeUndefined(); // Fully booked, hidden from public slots
  });

  it("should block group slot when host has an external conflicting calendar event (e.g. dentist)", () => {
    const slotStartUtc = new Date("2026-11-09T14:00:00Z");
    const slotEndUtc = new Date("2026-11-09T14:30:00Z");

    const result = generateAvailableSlots({
      host,
      eventType: groupEventType,
      requestedDate,
      guestTimezone,
      weeklyAvailability: weeklySchedule,
      overrides: [],
      existingBookings: [],
      // Host has external dentist appointment from 08:45 AM to 09:30 AM EST (13:45 to 14:30 UTC)
      calendarBusyBlocks: [
        {
          start: new Date("2026-11-09T13:45:00Z"),
          end: new Date("2026-11-09T14:30:00Z"),
        },
      ],
      now,
    });

    const targetSlot = result.slotsDetail.find((s) => s.time === "09:00 AM");
    expect(targetSlot).toBeUndefined();
  });

  it("validation should allow 2nd guest to join existing group session within capacity", () => {
    const slotStartUtc = new Date("2026-11-09T14:00:00Z");
    const slotEndUtc = new Date("2026-11-09T14:30:00Z");

    const validation = validateBookingRequest({
      input: {
        eventTypeId: groupEventType.id,
        date: "2026-11-09",
        time: "09:00 AM",
        guestName: "Guest Two",
        guestEmail: "guest2@example.com",
        guestTimezone: "America/New_York",
      },
      host,
      eventType: groupEventType,
      weeklyAvailability: weeklySchedule,
      overrides: [],
      existingBookings: [
        {
          id: "booking-master-1",
          eventTypeId: groupEventType.id,
          startTime: slotStartUtc,
          endTime: slotEndUtc,
          bufferStartTime: slotStartUtc,
          bufferEndTime: slotEndUtc,
          status: "confirmed",
          attendeeCount: 1,
        },
      ],
      calendarBusyBlocks: [
        {
          start: slotStartUtc,
          end: slotEndUtc,
        },
      ],
      now,
    });

    expect(validation.isValid).toBe(true);
  });

  it("validation should reject booking when group session is at full capacity", () => {
    const slotStartUtc = new Date("2026-11-09T14:00:00Z");
    const slotEndUtc = new Date("2026-11-09T14:30:00Z");

    const validation = validateBookingRequest({
      input: {
        eventTypeId: groupEventType.id,
        date: "2026-11-09",
        time: "09:00 AM",
        guestName: "Guest Six",
        guestEmail: "guest6@example.com",
        guestTimezone: "America/New_York",
      },
      host,
      eventType: groupEventType,
      weeklyAvailability: weeklySchedule,
      overrides: [],
      existingBookings: [
        {
          id: "booking-master-1",
          eventTypeId: groupEventType.id,
          startTime: slotStartUtc,
          endTime: slotEndUtc,
          bufferStartTime: slotStartUtc,
          bufferEndTime: slotEndUtc,
          status: "confirmed",
          attendeeCount: 5,
        },
      ],
      calendarBusyBlocks: [
        {
          start: slotStartUtc,
          end: slotEndUtc,
        },
      ],
      now,
    });

    expect(validation.isValid).toBe(false);
    expect(validation.errorCode).toBe("CONFLICT");
    expect(validation.error).toContain("full capacity");
  });
});
