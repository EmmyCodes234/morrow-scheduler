import { Temporal } from "@js-temporal/polyfill";

export interface ParsedTime {
  hour: number;
  minute: number;
}

export interface ParsedDate {
  year: number;
  month: number;
  day: number;
}

/**
 * Validates whether an IANA timezone string is recognized.
 */
export function isValidTimezone(timeZone?: string | null): boolean {
  if (!timeZone || typeof timeZone !== "string") return false;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timeZone.trim() });
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolves a valid IANA timezone string or returns a safe fallback.
 */
export function resolveTimezone(timeZone?: string | null, fallback = "UTC"): string {
  if (timeZone && isValidTimezone(timeZone)) {
    return timeZone.trim();
  }
  if (isValidTimezone(fallback)) {
    return fallback;
  }
  return "UTC";
}

/**
 * Parses time strings in "09:30 AM", "9:30am", "14:30", or "9:30" format into 24-hour hour & minute.
 */
export function parseLocalTimeString(timeStr: string): ParsedTime {
  if (!timeStr || typeof timeStr !== "string") {
    throw new Error(`Invalid time string: ${timeStr}`);
  }

  const match = timeStr.trim().match(/^(\d{1,2}):(\d{2})(?:\s*(AM|PM))?$/i);
  if (!match) {
    throw new Error(`Invalid time format: "${timeStr}". Expected HH:MM or HH:MM AM/PM.`);
  }

  let hour = parseInt(match[1], 10);
  const minute = parseInt(match[2], 10);
  const ampm = match[3]?.toUpperCase();

  if (minute < 0 || minute > 59) {
    throw new Error(`Minute out of range (0-59): ${minute}`);
  }

  if (ampm) {
    if (hour < 1 || hour > 12) {
      throw new Error(`12-hour format hour out of range (1-12): ${hour}`);
    }
    if (ampm === "PM" && hour < 12) hour += 12;
    if (ampm === "AM" && hour === 12) hour = 0;
  } else {
    if (hour < 0 || hour > 23) {
      throw new Error(`24-hour format hour out of range (0-23): ${hour}`);
    }
  }

  return { hour, minute };
}

/**
 * Parses "YYYY-MM-DD" date string.
 */
export function parseLocalDateString(dateStr: string): ParsedDate {
  if (!dateStr || typeof dateStr !== "string") {
    throw new Error(`Invalid date string: ${dateStr}`);
  }

  const match = dateStr.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    throw new Error(`Invalid date format: "${dateStr}". Expected YYYY-MM-DD.`);
  }

  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);

  if (month < 1 || month > 12) {
    throw new Error(`Month out of range (1-12): ${month}`);
  }
  if (day < 1 || day > 31) {
    throw new Error(`Day out of range (1-31): ${day}`);
  }

  return { year, month, day };
}

/**
 * Converts a wall-clock local date ("YYYY-MM-DD") and local time ("09:30 AM" or "14:30")
 * in a specified IANA timezone to an authoritative UTC JavaScript Date object.
 * Handles daylight saving transitions (gap times resolve forward, overlap times resolve compatible).
 */
export function localWallClockToUtcDate(
  dateStr: string,
  timeStr: string,
  timeZone: string
): Date {
  const tz = resolveTimezone(timeZone);
  const { year, month, day } = parseLocalDateString(dateStr);
  const { hour, minute } = parseLocalTimeString(timeStr);

  const zdt = Temporal.ZonedDateTime.from(
    {
      year,
      month,
      day,
      hour,
      minute,
      second: 0,
      millisecond: 0,
      timeZone: tz,
    },
    { disambiguation: "compatible" }
  );

  return new Date(zdt.toInstant().epochMilliseconds);
}

/**
 * Converts a UTC Date into a Temporal.ZonedDateTime in the requested timezone.
 */
export function utcDateToZonedDateTime(
  date: Date,
  timeZone: string
): Temporal.ZonedDateTime {
  const tz = resolveTimezone(timeZone);
  const instant = Temporal.Instant.fromEpochMilliseconds(date.getTime());
  return instant.toZonedDateTimeISO(tz);
}

/**
 * Returns the day of week for a given UTC Date in the specified timezone.
 * Returns: 0 = Sunday, 1 = Monday, ..., 6 = Saturday (matching database schema).
 */
export function getDayOfWeekInTimezone(date: Date, timeZone: string): number {
  const zdt = utcDateToZonedDateTime(date, timeZone);
  // Temporal.dayOfWeek: 1 = Monday, ..., 7 = Sunday
  return zdt.dayOfWeek % 7;
}

/**
 * Returns the "YYYY-MM-DD" calendar date string for a UTC Date in a specified timezone.
 */
export function getDateStringInTimezone(date: Date, timeZone: string): string {
  const zdt = utcDateToZonedDateTime(date, timeZone);
  const y = zdt.year;
  const m = String(zdt.month).padStart(2, "0");
  const d = String(zdt.day).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Formats a UTC Date to 12-hour format "09:30 AM" in the specified timezone.
 */
export function formatTime12(date: Date, timeZone: string): string {
  const zdt = utcDateToZonedDateTime(date, timeZone);
  let hour = zdt.hour;
  const minute = zdt.minute;
  const ampm = hour >= 12 ? "PM" : "AM";
  hour = hour % 12;
  if (hour === 0) hour = 12;
  const formattedHour = String(hour).padStart(2, "0");
  const formattedMinute = String(minute).padStart(2, "0");
  return `${formattedHour}:${formattedMinute} ${ampm}`;
}

/**
 * Formats a UTC Date to 24-hour format "09:30" in the specified timezone.
 */
export function formatTime24(date: Date, timeZone: string): string {
  const zdt = utcDateToZonedDateTime(date, timeZone);
  return `${String(zdt.hour).padStart(2, "0")}:${String(zdt.minute).padStart(2, "0")}`;
}

/**
 * Returns the exact UTC Date representing the start of a calendar day (00:00:00 local time)
 * in a specified timezone.
 */
export function getStartOfLocalDay(dateStr: string, timeZone: string): Date {
  const tz = resolveTimezone(timeZone);
  const { year, month, day } = parseLocalDateString(dateStr);
  const zdt = Temporal.ZonedDateTime.from(
    {
      year,
      month,
      day,
      hour: 0,
      minute: 0,
      second: 0,
      millisecond: 0,
      timeZone: tz,
    },
    { disambiguation: "compatible" }
  );
  return new Date(zdt.toInstant().epochMilliseconds);
}

/**
 * Returns the exact UTC Date representing the end of a calendar day (23:59:59.999 local time)
 * in a specified timezone.
 */
export function getEndOfLocalDay(dateStr: string, timeZone: string): Date {
  const tz = resolveTimezone(timeZone);
  const { year, month, day } = parseLocalDateString(dateStr);
  const zdt = Temporal.ZonedDateTime.from(
    {
      year,
      month,
      day,
      hour: 23,
      minute: 59,
      second: 59,
      millisecond: 999,
      timeZone: tz,
    },
    { disambiguation: "compatible" }
  );
  return new Date(zdt.toInstant().epochMilliseconds);
}

/**
 * Checks if two intervals [startA, endA) and [startB, endB) overlap.
 */
export function intervalsOverlap(
  startA: Date,
  endA: Date,
  startB: Date,
  endB: Date
): boolean {
  return startA.getTime() < endB.getTime() && endA.getTime() > startB.getTime();
}
