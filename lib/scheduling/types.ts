export type BookingStatus =
  | "confirmed"
  | "pending"
  | "cancelled"
  | "rejected"
  | "completed"
  | "no_show";

export type CalendarSyncStatus =
  | "not_applicable"
  | "synced"
  | "failed"
  | "pending";

export interface HostScheduleConfig {
  id: string;
  name: string;
  email: string;
  slug: string;
  timezone: string;
  bufferMins?: number | null;
  minNoticeHours?: number | null;
  maxBookingDays?: number | null;
  defaultLocationType?: string | null;
  zoomMeetingUrl?: string | null;
  googleAccessToken?: string | null;
  googleRefreshToken?: string | null;
}

export interface EventTypeConfig {
  id: string;
  userId: string;
  title: string;
  slug: string;
  durationMins: number;
  description?: string | null;
  locationType?: string | null; // "google_meet" | "zoom" | "in_person" | "phone" | "custom" | null
  locationUrl?: string | null;
  isActive: boolean;
  bufferBeforeMins: number;
  bufferAfterMins: number;
  minNoticeHours: number;
  maxPerDay?: number | null;
  requiresApproval: boolean;
}

export interface AvailabilityWindow {
  dayOfWeek: number;
  startTime: string; // "09:00"
  endTime: string; // "17:00"
  isEnabled: boolean;
}

export interface DateOverride {
  date: string; // "YYYY-MM-DD"
  isBlocked: boolean;
  startTime?: string | null;
  endTime?: string | null;
  reason?: string | null;
}

export interface ExistingBookingInterval {
  id: string;
  eventTypeId?: string;
  startTime: Date;
  endTime: Date;
  bufferStartTime: Date;
  bufferEndTime: Date;
  status: string;
}

export interface CalendarBusyBlock {
  start: Date;
  end: Date;
}

export interface SlotGenerationParams {
  host: HostScheduleConfig;
  eventType: EventTypeConfig;
  requestedDate: string; // YYYY-MM-DD in guest timezone (or host timezone)
  guestTimezone: string;
  weeklyAvailability: AvailabilityWindow[];
  overrides: DateOverride[];
  existingBookings: ExistingBookingInterval[];
  calendarBusyBlocks: CalendarBusyBlock[];
  calendarCheckFailed?: boolean;
  gridIntervalMins?: number; // default 15
  now?: Date;
}

export interface TimeSlot {
  time: string; // "09:00 AM" in guest timezone
  startTime: Date; // UTC Date
  endTime: Date; // UTC Date
}

export interface BookingRequestInput {
  eventTypeId: string;
  date: string; // YYYY-MM-DD
  time: string; // "09:00 AM" or "09:00"
  guestName: string;
  guestEmail: string;
  guestTimezone?: string;
  guestNotes?: string;
  additionalGuests?: string | string[];
  customAnswers?: Record<string, unknown>;
  idempotencyKey?: string;
}

export interface BookingValidationResult {
  isValid: boolean;
  error?: string;
  errorCode?:
    | "NOT_FOUND"
    | "INACTIVE"
    | "INVALID_INPUT"
    | "PAST_APPOINTMENT"
    | "MIN_NOTICE"
    | "MAX_HORIZON"
    | "MAX_PER_DAY"
    | "UNAVAILABLE"
    | "CONFLICT"
    | "CALENDAR_ERROR";
  startTime?: Date;
  endTime?: Date;
  bufferStartTime?: Date;
  bufferEndTime?: Date;
  effectiveDurationMins?: number;
  effectiveBufferBeforeMins?: number;
  effectiveBufferAfterMins?: number;
}
