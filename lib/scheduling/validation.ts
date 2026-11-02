import {
  BookingRequestInput,
  BookingValidationResult,
  HostScheduleConfig,
  EventTypeConfig,
  AvailabilityWindow,
  DateOverride,
  ExistingBookingInterval,
  CalendarBusyBlock,
} from "./types";
import {
  localWallClockToUtcDate,
  getDayOfWeekInTimezone,
  getDateStringInTimezone,
  resolveTimezone,
  intervalsOverlap,
} from "./timezone";

const EMAIL_REGEX =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

export function validateGuestDetails(input: {
  guestName?: string | null;
  guestEmail?: string | null;
  guestNotes?: string | null;
  additionalGuests?: string | string[] | null;
}): { isValid: boolean; error?: string } {
  const name = input.guestName?.trim();
  if (!name || name.length === 0) {
    return { isValid: false, error: "Guest name is required." };
  }
  if (name.length > 100) {
    return { isValid: false, error: "Guest name cannot exceed 100 characters." };
  }

  const email = input.guestEmail?.trim().toLowerCase();
  if (!email || email.length === 0) {
    return { isValid: false, error: "Guest email is required." };
  }
  if (email.length > 255) {
    return { isValid: false, error: "Guest email cannot exceed 255 characters." };
  }
  if (!EMAIL_REGEX.test(email)) {
    return { isValid: false, error: "Please enter a valid email address." };
  }

  if (input.guestNotes && input.guestNotes.length > 1000) {
    return { isValid: false, error: "Guest notes cannot exceed 1,000 characters." };
  }

  if (input.additionalGuests) {
    const guestsList = Array.isArray(input.additionalGuests)
      ? input.additionalGuests
      : input.additionalGuests.split(/[,;]/).map((g) => g.trim()).filter(Boolean);

    if (guestsList.length > 10) {
      return { isValid: false, error: "Cannot invite more than 10 additional guests." };
    }

    for (const g of guestsList) {
      if (!EMAIL_REGEX.test(g.toLowerCase())) {
        return { isValid: false, error: `Invalid additional guest email: ${g}` };
      }
    }
  }

  return { isValid: true };
}

export function validateBookingRequest({
  input,
  host,
  eventType,
  weeklyAvailability,
  overrides,
  existingBookings,
  calendarBusyBlocks = [],
  calendarCheckFailed = false,
  now = new Date(),
}: {
  input: BookingRequestInput;
  host: HostScheduleConfig;
  eventType: EventTypeConfig | null | undefined;
  weeklyAvailability: AvailabilityWindow[];
  overrides: DateOverride[];
  existingBookings: ExistingBookingInterval[];
  calendarBusyBlocks?: CalendarBusyBlock[];
  calendarCheckFailed?: boolean;
  now?: Date;
}): BookingValidationResult {
  // 1. Verify host and event type
  if (!host) {
    return { isValid: false, error: "Host not found.", errorCode: "NOT_FOUND" };
  }

  if (!eventType) {
    return {
      isValid: false,
      error: "Requested event type does not exist.",
      errorCode: "NOT_FOUND",
    };
  }

  if (eventType.userId !== host.id) {
    return {
      isValid: false,
      error: "Requested event type does not belong to this host.",
      errorCode: "NOT_FOUND",
    };
  }

  if (!eventType.isActive) {
    return {
      isValid: false,
      error: "This event type is currently inactive and cannot be booked.",
      errorCode: "INACTIVE",
    };
  }

  // 2. Validate guest details
  const guestValidation = validateGuestDetails({
    guestName: input.guestName,
    guestEmail: input.guestEmail,
    guestNotes: input.guestNotes,
    additionalGuests: input.additionalGuests,
  });
  if (!guestValidation.isValid) {
    return {
      isValid: false,
      error: guestValidation.error,
      errorCode: "INVALID_INPUT",
    };
  }

  // 3. Authoritatively derive durations & buffers from the database
  const effectiveDurationMins = eventType.durationMins;
  if (!effectiveDurationMins || effectiveDurationMins <= 0) {
    return {
      isValid: false,
      error: "Event type has an invalid appointment duration.",
      errorCode: "INVALID_INPUT",
    };
  }

  const effectiveBufferBeforeMins = eventType.bufferBeforeMins || 0;
  // Event-specific bufferAfter takes precedence, otherwise fallback to host-level bufferMins
  const effectiveBufferAfterMins =
    eventType.bufferAfterMins > 0
      ? eventType.bufferAfterMins
      : (host.bufferMins ?? 0);

  // 4. Timezone and appointment timestamps
  const guestTimezone = resolveTimezone(input.guestTimezone, host.timezone || "UTC");
  const hostTimezone = resolveTimezone(host.timezone, "UTC");

  let startTime: Date;
  try {
    startTime = localWallClockToUtcDate(input.date, input.time, guestTimezone);
  } catch (err: unknown) {
    return {
      isValid: false,
      error: (err as Error).message || "Invalid appointment date or time format.",
      errorCode: "INVALID_INPUT",
    };
  }

  const endTime = new Date(startTime.getTime() + effectiveDurationMins * 60 * 1000);
  const bufferStartTime = new Date(startTime.getTime() - effectiveBufferBeforeMins * 60 * 1000);
  const bufferEndTime = new Date(endTime.getTime() + effectiveBufferAfterMins * 60 * 1000);

  // 5. Reject past appointments
  if (startTime.getTime() <= now.getTime()) {
    return {
      isValid: false,
      error: "Appointments cannot be booked in the past.",
      errorCode: "PAST_APPOINTMENT",
    };
  }

  // 6. Minimum notice check
  const effectiveMinNoticeHours = Math.max(
    eventType.minNoticeHours ?? 0,
    host.minNoticeHours ?? 0
  );
  const minNoticeMs = effectiveMinNoticeHours * 60 * 60 * 1000;
  if (startTime.getTime() < now.getTime() + minNoticeMs) {
    return {
      isValid: false,
      error: `Appointments require at least ${effectiveMinNoticeHours} hour(s) minimum notice.`,
      errorCode: "MIN_NOTICE",
    };
  }

  // 7. Maximum booking horizon check
  const maxBookingDays = host.maxBookingDays ?? 30;
  const maxHorizonMs = maxBookingDays * 24 * 60 * 60 * 1000;
  if (startTime.getTime() > now.getTime() + maxHorizonMs) {
    return {
      isValid: false,
      error: `Appointments cannot be booked more than ${maxBookingDays} days in advance.`,
      errorCode: "MAX_HORIZON",
    };
  }

  // 8. Working hours and date overrides (calculated in host's local timezone)
  const hostDateStr = getDateStringInTimezone(startTime, hostTimezone);
  const hostDayOfWeek = getDayOfWeekInTimezone(startTime, hostTimezone);

  // Check date overrides
  const dateOverride = overrides.find((o) => o.date === hostDateStr);
  if (dateOverride?.isBlocked) {
    return {
      isValid: false,
      error: "Host is not available on this date.",
      errorCode: "UNAVAILABLE",
    };
  }

  let workStartStr = "09:00";
  let workEndStr = "17:00";

  if (dateOverride && dateOverride.startTime && dateOverride.endTime) {
    workStartStr = dateOverride.startTime;
    workEndStr = dateOverride.endTime;
  } else {
    const regularSchedule = weeklyAvailability.find(
      (w) => w.dayOfWeek === hostDayOfWeek
    );
    if (!regularSchedule || !regularSchedule.isEnabled) {
      return {
        isValid: false,
        error: "Host has no working hours scheduled on this day.",
        errorCode: "UNAVAILABLE",
      };
    }
    workStartStr = regularSchedule.startTime || "09:00";
    workEndStr = regularSchedule.endTime || "17:00";
  }

  // Build the host's working window in UTC
  const hostWorkStart = localWallClockToUtcDate(hostDateStr, workStartStr, hostTimezone);
  const hostWorkEnd = localWallClockToUtcDate(hostDateStr, workEndStr, hostTimezone);

  if (startTime.getTime() < hostWorkStart.getTime() || endTime.getTime() > hostWorkEnd.getTime()) {
    return {
      isValid: false,
      error: "The requested time falls outside of the host's working hours.",
      errorCode: "UNAVAILABLE",
    };
  }

  // 9. Check eventType.maxPerDay limits specifically for this event type
  if (eventType.maxPerDay && eventType.maxPerDay > 0) {
    const bookingsOnHostDay = existingBookings.filter((b) => {
      if (b.status === "cancelled" || b.status === "rejected") return false;
      // Filter strictly by eventTypeId if present on the booking interval
      if (b.eventTypeId && b.eventTypeId !== eventType.id) return false;
      const bHostDate = getDateStringInTimezone(b.startTime, hostTimezone);
      return bHostDate === hostDateStr;
    });

    if (bookingsOnHostDay.length >= eventType.maxPerDay) {
      return {
        isValid: false,
        error: "The maximum number of bookings for this event type on this day has been reached.",
        errorCode: "MAX_PER_DAY",
      };
    }
  }

  // 10. Check conflicts with existing bookings (both confirmed and pending reserve the slot)
  for (const b of existingBookings) {
    if (b.status === "cancelled" || b.status === "rejected") continue;

    // Both the existing booking and the new booking have their own buffer zones
    if (
      intervalsOverlap(
        bufferStartTime,
        bufferEndTime,
        b.bufferStartTime || b.startTime,
        b.bufferEndTime || b.endTime
      )
    ) {
      return {
        isValid: false,
        error: "This time slot is no longer available due to a scheduling conflict.",
        errorCode: "CONFLICT",
      };
    }
  }

  // 11. Google Calendar external conflicts & failure handling
  if (calendarCheckFailed) {
    return {
      isValid: false,
      error: "External calendar availability could not be verified. Please try again later.",
      errorCode: "CALENDAR_ERROR",
    };
  }

  // Check buffer interval against external calendar busy blocks consistently
  for (const block of calendarBusyBlocks) {
    if (intervalsOverlap(bufferStartTime, bufferEndTime, block.start, block.end)) {
      return {
        isValid: false,
        error: "This time slot conflicts with an event or buffer on the host's calendar.",
        errorCode: "CONFLICT",
      };
    }
  }

  return {
    isValid: true,
    startTime,
    endTime,
    bufferStartTime,
    bufferEndTime,
    effectiveDurationMins,
    effectiveBufferBeforeMins,
    effectiveBufferAfterMins,
  };
}
