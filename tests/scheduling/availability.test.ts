import { describe, it, expect } from "vitest";
import { generateAvailableSlots } from "@/lib/scheduling/slot-generator";
import {
  HostScheduleConfig,
  EventTypeConfig,
  AvailabilityWindow,
} from "@/lib/scheduling/types";

describe("Availability and Slot Generation Engine", () => {
  const host: HostScheduleConfig = {
    id: "host-1",
    name: "Alex Host",
    email: "alex@example.com",
    slug: "alex",
    timezone: "Europe/London",
    bufferMins: 10,
    minNoticeHours: 2,
    maxBookingDays: 30,
  };

  const eventType: EventTypeConfig = {
    id: "evt-30",
    userId: "host-1",
    title: "30 Min Strategy",
    slug: "strategy",
    durationMins: 30,
    locationType: "google_meet",
    isActive: true,
    bufferBeforeMins: 0,
    bufferAfterMins: 10,
    minNoticeHours: 2,
    requiresApproval: false,
  };

  const weeklyAvailability: AvailabilityWindow[] = [
    // Monday = 1 through Friday = 5, 09:00 to 17:00
    { dayOfWeek: 1, startTime: "09:00", endTime: "17:00", isEnabled: true },
    { dayOfWeek: 2, startTime: "09:00", endTime: "17:00", isEnabled: true },
    { dayOfWeek: 3, startTime: "09:00", endTime: "17:00", isEnabled: true },
    { dayOfWeek: 4, startTime: "09:00", endTime: "17:00", isEnabled: true },
    { dayOfWeek: 5, startTime: "09:00", endTime: "17:00", isEnabled: true },
    { dayOfWeek: 6, startTime: "09:00", endTime: "17:00", isEnabled: false },
    { dayOfWeek: 0, startTime: "09:00", endTime: "17:00", isEnabled: false },
  ];

  it("generates 15-minute grid slots within host working hours", () => {
    // 2026-11-04 is a Wednesday
    const now = new Date("2026-11-04T06:00:00.000Z"); // 6:00 AM UTC (same as 6:00 AM London in winter)
    const result = generateAvailableSlots({
      host,
      eventType,
      requestedDate: "2026-11-04",
      guestTimezone: "Europe/London",
      weeklyAvailability,
      overrides: [],
      existingBookings: [],
      calendarBusyBlocks: [],
      gridIntervalMins: 15,
      now,
    });

    expect(result.slots.length).toBeGreaterThan(0);
    // First slot should be 09:00 AM
    expect(result.slots[0]).toBe("09:00 AM");
    // Second slot should be 09:15 AM
    expect(result.slots[1]).toBe("09:15 AM");
    // Last slot should be 04:30 PM (ends at 05:00 PM)
    expect(result.slots[result.slots.length - 1]).toBe("04:30 PM");
  });

  it("enforces minimum notice window", () => {
    // Current time is 08:30 AM London on 2026-11-04
    // Min notice is 2 hours -> earliest allowed slot is 10:30 AM
    const now = new Date("2026-11-04T08:30:00.000Z");
    const result = generateAvailableSlots({
      host,
      eventType,
      requestedDate: "2026-11-04",
      guestTimezone: "Europe/London",
      weeklyAvailability,
      overrides: [],
      existingBookings: [],
      calendarBusyBlocks: [],
      now,
    });

    expect(result.slots).not.toContain("09:00 AM");
    expect(result.slots).not.toContain("09:30 AM");
    expect(result.slots).not.toContain("10:00 AM");
    expect(result.slots).not.toContain("10:15 AM");
    expect(result.slots[0]).toBe("10:30 AM");
  });

  it("respects booking buffers between appointments", () => {
    // Existing booking at 11:00 AM to 11:30 AM with 10 min bufferAfter (11:00 to 11:40 occupied)
    const now = new Date("2026-11-04T06:00:00.000Z");
    const existingBookings = [
      {
        id: "b1",
        startTime: new Date("2026-11-04T11:00:00.000Z"),
        endTime: new Date("2026-11-04T11:30:00.000Z"),
        bufferStartTime: new Date("2026-11-04T11:00:00.000Z"),
        bufferEndTime: new Date("2026-11-04T11:40:00.000Z"),
        status: "confirmed",
      },
    ];

    const result = generateAvailableSlots({
      host,
      eventType,
      requestedDate: "2026-11-04",
      guestTimezone: "Europe/London",
      weeklyAvailability,
      overrides: [],
      existingBookings,
      calendarBusyBlocks: [],
      now,
    });

    // A 30 min slot at 10:45 AM would end at 11:15 AM + 10 min buffer = 11:25 AM -> overlaps 11:00 AM
    expect(result.slots).not.toContain("10:45 AM");
    expect(result.slots).not.toContain("11:00 AM");
    expect(result.slots).not.toContain("11:15 AM");
    expect(result.slots).not.toContain("11:30 AM"); // 11:30 is inside the 10 min buffer after ending at 11:40
    // Slot starting at 11:45 AM has buffer start 11:45 AM >= 11:40 AM -> allowed!
    expect(result.slots).toContain("11:45 AM");
  });

  it("treats pending approval bookings as reserving their slot", () => {
    // An unapproved, pending booking at 14:00 - 14:30 must block the slot
    const now = new Date("2026-11-04T06:00:00.000Z");
    const existingBookings = [
      {
        id: "b-pending",
        startTime: new Date("2026-11-04T14:00:00.000Z"),
        endTime: new Date("2026-11-04T14:30:00.000Z"),
        bufferStartTime: new Date("2026-11-04T14:00:00.000Z"),
        bufferEndTime: new Date("2026-11-04T14:40:00.000Z"),
        status: "pending",
      },
    ];

    const result = generateAvailableSlots({
      host,
      eventType,
      requestedDate: "2026-11-04",
      guestTimezone: "Europe/London",
      weeklyAvailability,
      overrides: [],
      existingBookings,
      calendarBusyBlocks: [],
      now,
    });

    expect(result.slots).not.toContain("02:00 PM");
    expect(result.slots).not.toContain("02:15 PM");
    expect(result.slots).not.toContain("02:30 PM");
  });

  it("applies buffer intervals against external Google Calendar busy blocks", () => {
    // External busy block from 13:00 to 14:00 UTC
    // Event type bufferAfterMins is 10 mins, duration is 30 mins
    const now = new Date("2026-11-04T06:00:00.000Z");
    const result = generateAvailableSlots({
      host,
      eventType: {
        ...eventType,
        bufferBeforeMins: 15, // 15 mins before
        bufferAfterMins: 15, // 15 mins after
      },
      requestedDate: "2026-11-04",
      guestTimezone: "Europe/London",
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

    // Slot 12:30 PM would end at 13:00 PM, but bufferAfter (15m) ends at 13:15 PM -> overlaps busy block
    expect(result.slots).not.toContain("12:30 PM");
    expect(result.slots).not.toContain("01:00 PM");
    expect(result.slots).not.toContain("01:30 PM");
    // Slot 02:00 PM starts at 14:00 PM, but bufferBefore (15m) starts at 13:45 PM -> overlaps busy block!
    expect(result.slots).not.toContain("02:00 PM");
    // Slot 02:15 PM: buffer starts at 14:00 PM >= 14:00 PM -> allowed!
    expect(result.slots).toContain("02:15 PM");
  });

  it("deduplicates wall-clock times during Daylight Saving Time (DST) fallback", () => {
    // 2026-11-01 in America/New_York is the DST fallback day (clocks turn back at 2:00 AM)
    const hostNy: HostScheduleConfig = {
      ...host,
      timezone: "America/New_York",
    };
    const now = new Date("2026-11-01T04:00:00.000Z");

    const result = generateAvailableSlots({
      host: hostNy,
      eventType,
      requestedDate: "2026-11-01",
      guestTimezone: "America/New_York",
      weeklyAvailability: [
        { dayOfWeek: 0, startTime: "00:00", endTime: "04:00", isEnabled: true },
      ],
      overrides: [],
      existingBookings: [],
      calendarBusyBlocks: [],
      now,
    });

    // Check for duplicate slot strings
    const uniqueSlots = new Set(result.slots);
    expect(result.slots.length).toBe(uniqueSlots.size);
  });

  it("respects availability overrides (blocking a date)", () => {
    const now = new Date("2026-11-04T06:00:00.000Z");
    const result = generateAvailableSlots({
      host,
      eventType,
      requestedDate: "2026-11-04",
      guestTimezone: "Europe/London",
      weeklyAvailability,
      overrides: [
        {
          date: "2026-11-04",
          isBlocked: true,
          reason: "Out of office",
        },
      ],
      existingBookings: [],
      calendarBusyBlocks: [],
      now,
    });

    expect(result.slots).toEqual([]);
  });

  it("respects availability overrides with custom working hours", () => {
    const now = new Date("2026-11-04T06:00:00.000Z");
    const result = generateAvailableSlots({
      host,
      eventType,
      requestedDate: "2026-11-04",
      guestTimezone: "Europe/London",
      weeklyAvailability,
      overrides: [
        {
          date: "2026-11-04",
          isBlocked: false,
          startTime: "13:00",
          endTime: "15:00",
        },
      ],
      existingBookings: [],
      calendarBusyBlocks: [],
      now,
    });

    expect(result.slots[0]).toBe("01:00 PM");
    expect(result.slots[result.slots.length - 1]).toBe("02:30 PM");
    expect(result.slots).not.toContain("09:00 AM");
  });

  it("fails safely and returns no slots when Google Calendar check fails", () => {
    const now = new Date("2026-11-04T06:00:00.000Z");
    const result = generateAvailableSlots({
      host,
      eventType,
      requestedDate: "2026-11-04",
      guestTimezone: "Europe/London",
      weeklyAvailability,
      overrides: [],
      existingBookings: [],
      calendarBusyBlocks: [],
      calendarCheckFailed: true,
      now,
    });

    expect(result.slots).toEqual([]);
    expect(result.calendarError).toBe(true);
  });

  it("enforces maximum booking horizon", () => {
    const now = new Date("2026-11-04T06:00:00.000Z");
    // Host has maxBookingDays = 30. 45 days later should be blocked
    const result = generateAvailableSlots({
      host,
      eventType,
      requestedDate: "2026-12-25",
      guestTimezone: "Europe/London",
      weeklyAvailability,
      overrides: [],
      existingBookings: [],
      calendarBusyBlocks: [],
      now,
    });

    expect(result.slots).toEqual([]);
  });

  it("respects eventType maxPerDay limit strictly scoped to the event type", () => {
    const limitedEventType: EventTypeConfig = {
      ...eventType,
      id: "evt-target",
      maxPerDay: 2,
    };

    const now = new Date("2026-11-04T06:00:00.000Z");
    // 2 bookings belonging to a DIFFERENT event type should NOT block this event type
    const otherBookings = [
      {
        id: "b-other-1",
        eventTypeId: "evt-different",
        startTime: new Date("2026-11-04T09:00:00.000Z"),
        endTime: new Date("2026-11-04T09:30:00.000Z"),
        bufferStartTime: new Date("2026-11-04T09:00:00.000Z"),
        bufferEndTime: new Date("2026-11-04T09:40:00.000Z"),
        status: "confirmed",
      },
      {
        id: "b-other-2",
        eventTypeId: "evt-different",
        startTime: new Date("2026-11-04T10:00:00.000Z"),
        endTime: new Date("2026-11-04T10:30:00.000Z"),
        bufferStartTime: new Date("2026-11-04T10:00:00.000Z"),
        bufferEndTime: new Date("2026-11-04T10:40:00.000Z"),
        status: "confirmed",
      },
    ];

    const resultAllowed = generateAvailableSlots({
      host,
      eventType: limitedEventType,
      requestedDate: "2026-11-04",
      guestTimezone: "Europe/London",
      weeklyAvailability,
      overrides: [],
      existingBookings: otherBookings,
      calendarBusyBlocks: [],
      now,
    });

    expect(resultAllowed.slots.length).toBeGreaterThan(0);

    // 2 bookings belonging to THIS event type should block the day
    const matchingBookings = [
      {
        id: "b1",
        eventTypeId: "evt-target",
        startTime: new Date("2026-11-04T09:00:00.000Z"),
        endTime: new Date("2026-11-04T09:30:00.000Z"),
        bufferStartTime: new Date("2026-11-04T09:00:00.000Z"),
        bufferEndTime: new Date("2026-11-04T09:40:00.000Z"),
        status: "confirmed",
      },
      {
        id: "b2",
        eventTypeId: "evt-target",
        startTime: new Date("2026-11-04T10:00:00.000Z"),
        endTime: new Date("2026-11-04T10:30:00.000Z"),
        bufferStartTime: new Date("2026-11-04T10:00:00.000Z"),
        bufferEndTime: new Date("2026-11-04T10:40:00.000Z"),
        status: "confirmed",
      },
    ];

    const resultBlocked = generateAvailableSlots({
      host,
      eventType: limitedEventType,
      requestedDate: "2026-11-04",
      guestTimezone: "Europe/London",
      weeklyAvailability,
      overrides: [],
      existingBookings: matchingBookings,
      calendarBusyBlocks: [],
      now,
    });

    expect(resultBlocked.slots).toEqual([]);
  });
});
