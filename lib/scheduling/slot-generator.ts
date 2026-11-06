import {
  SlotGenerationParams,
  TimeSlot,
} from "./types";
import {
  localWallClockToUtcDate,
  getDayOfWeekInTimezone,
  getDateStringInTimezone,
  getStartOfLocalDay,
  getEndOfLocalDay,
  formatTime12,
  resolveTimezone,
  intervalsOverlap,
} from "./timezone";

export interface SlotGenerationResult {
  slots: string[]; // Formatted strings in guest timezone, e.g. ["09:00 AM", "09:15 AM"]
  slotsDetail: TimeSlot[];
  calendarError?: boolean;
  message?: string;
}

export function generateAvailableSlots({
  host,
  eventType,
  requestedDate,
  guestTimezone,
  weeklyAvailability,
  overrides,
  existingBookings,
  calendarBusyBlocks = [],
  calendarCheckFailed = false,
  gridIntervalMins = 15,
  now = new Date(),
}: SlotGenerationParams): SlotGenerationResult {
  // If external calendar check failed, fail safely!
  if (calendarCheckFailed) {
    return {
      slots: [],
      slotsDetail: [],
      calendarError: true,
      message: "External calendar availability could not be verified.",
    };
  }

  if (!eventType.isActive) {
    return {
      slots: [],
      slotsDetail: [],
      message: "Event type is inactive.",
    };
  }

  const durationMins = eventType.durationMins;
  if (!durationMins || durationMins <= 0) {
    return { slots: [], slotsDetail: [], message: "Invalid duration." };
  }

  const bufferBeforeMins = eventType.bufferBeforeMins || 0;
  const bufferAfterMins =
    eventType.bufferAfterMins > 0
      ? eventType.bufferAfterMins
      : (host.bufferMins ?? 0);

  const guestTz = resolveTimezone(guestTimezone, host.timezone || "UTC");
  const hostTz = resolveTimezone(host.timezone, "UTC");

  // Horizon check
  const maxBookingDays = host.maxBookingDays ?? 30;
  const guestDayStartUtc = getStartOfLocalDay(requestedDate, guestTz);
  const guestDayEndUtc = getEndOfLocalDay(requestedDate, guestTz);

  const maxHorizonUtc = new Date(now.getTime() + maxBookingDays * 24 * 60 * 60 * 1000);
  if (guestDayStartUtc.getTime() > maxHorizonUtc.getTime()) {
    return {
      slots: [],
      slotsDetail: [],
      message: `Date is beyond the maximum booking horizon (${maxBookingDays} days).`,
    };
  }

  // Minimum notice requirement
  const minNoticeHours = Math.max(eventType.minNoticeHours ?? 0, host.minNoticeHours ?? 0);
  const minAllowedSlotTime = new Date(now.getTime() + minNoticeHours * 60 * 60 * 1000);

  // Identify all host calendar dates that could overlap the guest's requested calendar day
  const hostDatesSet = new Set<string>();
  hostDatesSet.add(getDateStringInTimezone(guestDayStartUtc, hostTz));
  hostDatesSet.add(getDateStringInTimezone(guestDayEndUtc, hostTz));

  const midpoint = new Date((guestDayStartUtc.getTime() + guestDayEndUtc.getTime()) / 2);
  hostDatesSet.add(getDateStringInTimezone(midpoint, hostTz));

  const candidateSlotsList: TimeSlot[] = [];

  for (const hostDateStr of hostDatesSet) {
    // Check max bookings per day specifically for this event type
    if (eventType.maxPerDay && eventType.maxPerDay > 0) {
      const bookingsOnHostDay = existingBookings.filter((b) => {
        if (b.status === "cancelled" || b.status === "rejected") return false;
        if (b.eventTypeId && b.eventTypeId !== eventType.id) return false;
        const bHostDate = getDateStringInTimezone(b.startTime, hostTz);
        return bHostDate === hostDateStr;
      });

      if (bookingsOnHostDay.length >= eventType.maxPerDay) {
        continue; // Day fully booked for this event type
      }
    }

    // Check date overrides for this host date
    const dateOverride = overrides.find((o) => o.date === hostDateStr);
    if (dateOverride?.isBlocked) {
      continue;
    }

    let workStartStr = "09:00";
    let workEndStr = "17:00";

    if (dateOverride && dateOverride.startTime && dateOverride.endTime) {
      workStartStr = dateOverride.startTime;
      workEndStr = dateOverride.endTime;
    } else {
      const hostDayStartUtc = getStartOfLocalDay(hostDateStr, hostTz);
      const hostDayOfWeek = getDayOfWeekInTimezone(hostDayStartUtc, hostTz);
      const regularSchedule = weeklyAvailability.find(
        (w) => w.dayOfWeek === hostDayOfWeek
      );

      if (!regularSchedule || !regularSchedule.isEnabled) {
        continue; // Day disabled in host weekly schedule
      }

      workStartStr = regularSchedule.startTime || "09:00";
      workEndStr = regularSchedule.endTime || "17:00";
    }

    // Construct host working window in UTC
    const hostWorkStartUtc = localWallClockToUtcDate(hostDateStr, workStartStr, hostTz);
    const hostWorkEndUtc = localWallClockToUtcDate(hostDateStr, workEndStr, hostTz);

    // Generate candidate slots on gridIntervalMins
    let currentSlotUtc = new Date(hostWorkStartUtc);
    const durationMs = durationMins * 60 * 1000;
    const gridStepMs = Math.max(5, gridIntervalMins) * 60 * 1000;

    while (currentSlotUtc.getTime() + durationMs <= hostWorkEndUtc.getTime()) {
      const slotEndUtc = new Date(currentSlotUtc.getTime() + durationMs);

      // Must fall on the guest's requested date
      const slotGuestDate = getDateStringInTimezone(currentSlotUtc, guestTz);
      if (slotGuestDate === requestedDate) {
        // Must satisfy minimum notice and be in the future
        if (
          currentSlotUtc.getTime() >= minAllowedSlotTime.getTime() &&
          currentSlotUtc.getTime() > now.getTime()
        ) {
          const slotBufferStartUtc = new Date(
            currentSlotUtc.getTime() - bufferBeforeMins * 60 * 1000
          );
          const slotBufferEndUtc = new Date(
            slotEndUtc.getTime() + bufferAfterMins * 60 * 1000
          );

          const maxAttendees = eventType.maxAttendees && eventType.maxAttendees > 1 ? eventType.maxAttendees : 1;
          const isGroupEvent = maxAttendees > 1;

          // Identify any existing active booking for THIS exact event type and timeslot
          const existingGroupBooking = isGroupEvent
            ? existingBookings.find(
                (b) =>
                  b.status !== "cancelled" &&
                  b.status !== "rejected" &&
                  b.eventTypeId === eventType.id &&
                  b.startTime.getTime() === currentSlotUtc.getTime()
              )
            : undefined;

          // Check conflict with OTHER bookings (different event type, or different time)
          const hasBookingConflict = existingBookings.some((b) => {
            if (b.status === "cancelled" || b.status === "rejected") return false;
            if (existingGroupBooking && b.id === existingGroupBooking.id) {
              return false;
            }
            const bBufStart = b.bufferStartTime || b.startTime;
            const bBufEnd = b.bufferEndTime || b.endTime;
            return intervalsOverlap(slotBufferStartUtc, slotBufferEndUtc, bBufStart, bBufEnd);
          });

          // Capacity check
          let spotsRemaining = maxAttendees;
          let isFull = false;

          if (existingGroupBooking) {
            const currentAttendees = existingGroupBooking.attendeeCount ?? 1;
            spotsRemaining = Math.max(0, maxAttendees - currentAttendees);
            if (spotsRemaining <= 0) {
              isFull = true;
            }
          }

          // Check conflict with Google Calendar busy blocks:
          // If this slot already has a group booking in Morrow, Google Calendar reports the host as busy
          // for this exact session. We do not block subsequent attendees from joining that session!
          const hasCalendarConflict = calendarBusyBlocks.some((block) => {
            if (!intervalsOverlap(slotBufferStartUtc, slotBufferEndUtc, block.start, block.end)) {
              return false;
            }
            if (existingGroupBooking) {
              const matchesGroupBooking =
                Math.abs(block.start.getTime() - currentSlotUtc.getTime()) <= 60000 &&
                Math.abs(block.end.getTime() - slotEndUtc.getTime()) <= 60000;
              if (matchesGroupBooking) {
                return false;
              }
            }
            return true;
          });

          if (!hasBookingConflict && !isFull && !hasCalendarConflict) {
            candidateSlotsList.push({
              time: formatTime12(currentSlotUtc, guestTz),
              startTime: currentSlotUtc,
              endTime: slotEndUtc,
              spotsRemaining: isGroupEvent ? spotsRemaining : undefined,
              maxAttendees: isGroupEvent ? maxAttendees : undefined,
            });
          }
        }
      }

      currentSlotUtc = new Date(currentSlotUtc.getTime() + gridStepMs);
    }
  }

  // Sort slots chronologically
  candidateSlotsList.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());

  // Daylight-saving ambiguity resolution:
  // If daylight saving fallback creates duplicate wall-clock time strings (e.g. two "01:30 AM" slots),
  // exclude ambiguous duplicates so guests never see two indistinguishable options that resolve
  // to the same wall-clock submission.
  const seenWallClockTimes = new Set<string>();
  const unambiguousSlots: TimeSlot[] = [];

  for (const slot of candidateSlotsList) {
    if (!seenWallClockTimes.has(slot.time)) {
      seenWallClockTimes.add(slot.time);
      unambiguousSlots.push(slot);
    }
  }

  return {
    slots: unambiguousSlots.map((s) => s.time),
    slotsDetail: unambiguousSlots,
  };
}
