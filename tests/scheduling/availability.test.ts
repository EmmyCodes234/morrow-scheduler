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

  it("respects eventType maxPerDay limit", () => {
    const limitedEventType: EventTypeConfig = {
      ...eventType,
      maxPerDay: 2,
    };

    const now = new Date("2026-11-04T06:00:00.000Z");
    const existingBookings = [
      {
        id: "b1",
        startTime: new Date("2026-11-04T09:00:00.000Z"),
        endTime: new Date("2026-11-04T09:30:00.000Z"),
        bufferStartTime: new Date("2026-11-04T09:00:00.000Z"),
        bufferEndTime: new Date("2026-11-04T09:40:00.000Z"),
        status: "confirmed",
      },
      {
        id: "b2",
        startTime: new Date("2026-11-04T10:00:00.000Z"),
        endTime: new Date("2026-11-04T10:30:00.000Z"),
        bufferStartTime: new Date("2026-11-04T10:00:00.000Z"),
        bufferEndTime: new Date("2026-11-04T10:40:00.000Z"),
        status: "confirmed",
      },
    ];

    const result = generateAvailableSlots({
      host,
      eventType: limitedEventType,
      requestedDate: "2026-11-04",
      guestTimezone: "Europe/London",
      weeklyAvailability,
      overrides: [],
      existingBookings,
      calendarBusyBlocks: [],
      now,
    });

    expect(result.slots).toEqual([]);
  });
});
