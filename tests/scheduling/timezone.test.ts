import { describe, it, expect } from "vitest";
import {
  parseLocalTimeString,
  parseLocalDateString,
  localWallClockToUtcDate,
  utcDateToZonedDateTime,
  getDayOfWeekInTimezone,
  getDateStringInTimezone,
  formatTime12,
  formatTime24,
  resolveTimezone,
} from "@/lib/scheduling/timezone";

describe("Timezone Utilities", () => {
  it("resolves valid and invalid timezones", () => {
    expect(resolveTimezone("Africa/Lagos")).toBe("Africa/Lagos");
    expect(resolveTimezone("Europe/London")).toBe("Europe/London");
    expect(resolveTimezone("America/New_York")).toBe("America/New_York");
    expect(resolveTimezone("Invalid/Zone", "UTC")).toBe("UTC");
    expect(resolveTimezone(null, "Europe/London")).toBe("Europe/London");
  });

  it("parses 12-hour and 24-hour time strings correctly", () => {
    expect(parseLocalDateString("2026-11-04")).toEqual({ year: 2026, month: 11, day: 4 });
    expect(parseLocalTimeString("09:30 AM")).toEqual({ hour: 9, minute: 30 });
    expect(parseLocalTimeString("12:00 PM")).toEqual({ hour: 12, minute: 0 });
    expect(parseLocalTimeString("12:00 AM")).toEqual({ hour: 0, minute: 0 });
    expect(parseLocalTimeString("05:45 PM")).toEqual({ hour: 17, minute: 45 });
    expect(parseLocalTimeString("17:45")).toEqual({ hour: 17, minute: 45 });
    expect(parseLocalTimeString("00:15")).toEqual({ hour: 0, minute: 15 });
  });

  it("rejects invalid time strings", () => {
    expect(() => parseLocalTimeString("25:00")).toThrow();
    expect(() => parseLocalTimeString("13:00 PM")).toThrow();
    expect(() => parseLocalTimeString("invalid")).toThrow();
  });

  it("converts wall-clock times to UTC correctly across timezones", () => {
    // Africa/Lagos is UTC+1 year-round (no DST)
    const lagosDate = localWallClockToUtcDate("2026-11-04", "10:00 AM", "Africa/Lagos");
    // 10:00 AM UTC+1 is 09:00 UTC
    expect(lagosDate.toISOString()).toBe("2026-11-04T09:00:00.000Z");

    // America/New_York in standard time (November 2026 is EST, UTC-5)
    const nyDate = localWallClockToUtcDate("2026-11-04", "10:00 AM", "America/New_York");
    // 10:00 AM UTC-5 is 15:00 UTC
    expect(nyDate.toISOString()).toBe("2026-11-04T15:00:00.000Z");

    // Europe/London in summer (BST, UTC+1 in July)
    const londonSummer = localWallClockToUtcDate("2026-07-15", "10:00 AM", "Europe/London");
    expect(londonSummer.toISOString()).toBe("2026-07-15T09:00:00.000Z");

    // Europe/London in winter (GMT, UTC+0 in January)
    const londonWinter = localWallClockToUtcDate("2026-01-15", "10:00 AM", "Europe/London");
    expect(londonWinter.toISOString()).toBe("2026-01-15T10:00:00.000Z");
  });

  it("calculates correct local weekday rather than UTC weekday", () => {
    // 2026-11-01 23:30 in New York (Sunday evening)
    // In UTC, this is 2026-11-02 04:30 (Monday morning)
    const utcDate = new Date("2026-11-02T04:30:00.000Z");

    // UTC day of week is 1 (Monday)
    expect(utcDate.getUTCDay()).toBe(1);

    // Host in America/New_York: local day is Sunday (0)!
    const nyDay = getDayOfWeekInTimezone(utcDate, "America/New_York");
    expect(nyDay).toBe(0); // Sunday

    // Host in Africa/Lagos (UTC+1, 05:30 Monday): local day is Monday (1)
    const lagosDay = getDayOfWeekInTimezone(utcDate, "Africa/Lagos");
    expect(lagosDay).toBe(1); // Monday
  });

  it("handles daylight saving transition seamlessly", () => {
    // In US, spring forward skips 2:00 AM to 3:00 AM
    // Temporal disambiguation "compatible" moves forward into valid time
    const springForward = localWallClockToUtcDate("2026-03-08", "02:30 AM", "America/New_York");
    expect(springForward).toBeInstanceOf(Date);

    // Fall back repeats 1:00 AM to 2:00 AM
    const fallBack = localWallClockToUtcDate("2026-11-01", "01:30 AM", "America/New_York");
    expect(fallBack).toBeInstanceOf(Date);
  });

  it("formats dates and times correctly in different timezones", () => {
    const utcDate = new Date("2026-11-04T15:00:00.000Z");
    const zdt = utcDateToZonedDateTime(utcDate, "America/New_York");
    expect(zdt.hour).toBe(10);
    expect(zdt.minute).toBe(0);

    // In New York (UTC-5), 15:00 UTC is 10:00 AM
    expect(formatTime12(utcDate, "America/New_York")).toBe("10:00 AM");
    expect(formatTime24(utcDate, "America/New_York")).toBe("10:00");
    expect(getDateStringInTimezone(utcDate, "America/New_York")).toBe("2026-11-04");

    // In Tokyo (UTC+9), 15:00 UTC is 00:00 (midnight) next day: 2026-11-05
    expect(formatTime12(utcDate, "Asia/Tokyo")).toBe("12:00 AM");
    expect(getDateStringInTimezone(utcDate, "Asia/Tokyo")).toBe("2026-11-05");
  });
});
