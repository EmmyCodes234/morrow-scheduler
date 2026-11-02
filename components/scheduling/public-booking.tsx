"use client";

import { useState, useEffect } from "react";
import { today, getLocalTimeZone, CalendarDate } from "@internationalized/date";
import { DateCalendar } from "@/components/base/date-picker/date-calendar";
import { Button } from "@/components/base/buttons/button";
import { Avatar } from "@/components/base/avatar/avatar";
import { Badge } from "@/components/base/badges/badge";
import { Chip } from "@/components/base/badges/chip";
import { Input } from "@/components/base/input/input";
import { Textarea } from "@/components/base/textarea/textarea";
import {
  HugeCalendar,
  HugeClock,
  HugeVideo,
  HugeGlobe,
  HugeSun,
  HugeMoon,
  HugeUser,
  HugeMail,
  HugeAdd,
  HugeCheck,
  HugeArrowLeft,
  HugeCheckIn,
  HugeVerified,
  HugeCopy,
} from "@/components/icons/hugeicons";
import { MorrowLogo } from "@/components/brand/morrow-logo";

export interface PublicHost {
  id: string;
  name: string;
  email: string;
  slug: string;
  timezone?: string | null;
  avatarUrl?: string | null;
  brandColor?: string | null;
  welcomeMessage?: string | null;
}

export interface PublicEventType {
  id: string;
  title: string;
  slug: string;
  duration: number;
  description?: string;
  location?: string;
  active?: boolean;
}

export interface PublicBookingViewProps {
  host?: PublicHost;
  initialEventTypes?: PublicEventType[];
}

export function PublicBookingView({ host, initialEventTypes = [] }: PublicBookingViewProps) {
  const activeEvents = initialEventTypes.filter((e) => e.active !== false);
  const defaultEvent = activeEvents[0] || {
    id: "default",
    title: "Strategy Call",
    slug: "call",
    duration: 30,
    description: "Discuss opportunities and align on priorities.",
  };

  const [guestTimezone] = useState<string>(() => {
    try {
      return getLocalTimeZone();
    } catch {
      return "UTC";
    }
  });

  const [selectedEvent, setSelectedEvent] = useState<PublicEventType>(defaultEvent);
  const [selectedDate, setSelectedDate] = useState<CalendarDate>(() => today(getLocalTimeZone()));
  const [minDate] = useState<CalendarDate>(() => today(getLocalTimeZone()));
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [step, setStep] = useState<"slot" | "intake" | "confirmed">("slot");

  const [availableSlots, setAvailableSlots] = useState<{
    morning: string[];
    afternoon: string[];
  }>({
    morning: [],
    afternoon: [],
  });
  const [loadingSlots, setLoadingSlots] = useState<boolean>(false);
  const [slotsError, setSlotsError] = useState<string | null>(null);

  const [form, setForm] = useState({
    name: "",
    email: "",
    guests: "",
    notes: "",
  });

  const [copiedLink, setCopiedLink] = useState(false);
  const [confirmedMeetLink, setConfirmedMeetLink] = useState<string>("");
  const [isBooking, setIsBooking] = useState(false);
  const [bookingError, setBookingError] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState<string>(() => {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return `req-${Date.now()}`;
  });

  const hostInitials = host?.name
    ? host.name
        .split(" ")
        .filter(Boolean)
        .map((n) => n[0])
        .join("")
        .slice(0, 2)
        .toUpperCase()
    : "H";

  // Fetch live conflict-free slots whenever date, event type, or guest timezone changes
  useEffect(() => {
    if (!host?.slug || !selectedDate) return;

    const year = selectedDate.year;
    const month = String(selectedDate.month).padStart(2, "0");
    const day = String(selectedDate.day).padStart(2, "0");
    const dateStr = `${year}-${month}-${day}`;

    let isMounted = true;
    queueMicrotask(() => {
      if (isMounted) {
        setLoadingSlots(true);
        setSlotsError(null);
      }
    });

    const params = new URLSearchParams({
      date: dateStr,
      eventTypeId: selectedEvent.id,
      timezone: guestTimezone,
    });

    fetch(`/api/slots/${host.slug}?${params.toString()}`)
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!isMounted) return;

        if (!res.ok || data.calendarError) {
          setSlotsError(data.error || "Unable to check slot availability. Please try again.");
          setAvailableSlots({ morning: [], afternoon: [] });
          setLoadingSlots(false);
          return;
        }

        if (data && data.slots && Array.isArray(data.slots)) {
          const morning: string[] = [];
          const afternoon: string[] = [];

          data.slots.forEach((slot: string) => {
            if (
              slot.includes("AM") ||
              (slot.startsWith("12:00 PM") === false &&
                slot.includes("12:") === false &&
                (slot.startsWith("09:") || slot.startsWith("10:") || slot.startsWith("11:")))
            ) {
              morning.push(slot);
            } else {
              afternoon.push(slot);
            }
          });

          setAvailableSlots({ morning, afternoon });
        } else {
          setAvailableSlots({ morning: [], afternoon: [] });
        }
        setLoadingSlots(false);
      })
      .catch((err) => {
        if (!isMounted) return;
        console.error("Error fetching live slots:", err);
        setSlotsError("Could not load available times. Please check your connection.");
        setLoadingSlots(false);
      });

    return () => {
      isMounted = false;
    };
  }, [host?.slug, selectedDate, selectedEvent.id, guestTimezone]);

  const handleSlotPick = (slot: string) => {
    setSelectedSlot(slot);
    setBookingError(null);
    setStep("intake");
  };

  const handleSelectEvent = (event: PublicEventType) => {
    setSelectedEvent(event);
    setSelectedSlot(null);
    setBookingError(null);
  };

  const handleConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.email.trim() || !selectedSlot) return;

    setIsBooking(true);
    setBookingError(null);

    try {
      const year = selectedDate.year;
      const month = String(selectedDate.month).padStart(2, "0");
      const day = String(selectedDate.day).padStart(2, "0");
      const dateStr = `${year}-${month}-${day}`;

      const res = await fetch(`/api/book/${host?.slug || "host"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventTypeId: selectedEvent.id,
          date: dateStr,
          time: selectedSlot,
          guestName: form.name.trim(),
          guestEmail: form.email.trim(),
          guestTimezone,
          guestNotes: form.notes.trim() || undefined,
          additionalGuests: form.guests.trim() || undefined,
          idempotencyKey,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (res.ok && data.success) {
        if (data.booking?.meetLink) {
          setConfirmedMeetLink(data.booking.meetLink);
        }
        setBookingError(null);
        setStep("confirmed");
      } else {
        // Honest error handling - never display confirmation on failure
        const errorMsg = data.error || "Unable to complete booking. Please select another time or retry.";
        setBookingError(errorMsg);
      }
    } catch (err) {
      console.error("Booking error:", err);
      setBookingError("Network connection error. Your booking was not confirmed. Please retry.");
    } finally {
      setIsBooking(false);
    }
  };

  const handleCopyMeet = () => {
    if (!confirmedMeetLink) return;
    navigator.clipboard.writeText(confirmedMeetLink);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const formattedDate = selectedDate
    ? new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" }).format(
        selectedDate.toDate(getLocalTimeZone())
      )
    : "";

  return (
    <div className="w-full max-w-5xl mx-auto rounded-3xl border border-border-button-default bg-background-primary-default shadow-sm overflow-hidden">
      {step === "confirmed" ? (
        /* CONFIRMATION SUCCESS VIEW */
        <div className="p-8 sm:p-14 flex flex-col items-center text-center max-w-lg mx-auto">
          <div className="size-16 rounded-full bg-status-lime-background flex items-center justify-center text-status-lime-text mb-6">
            <HugeCheck className="size-8" />
          </div>

          <h2 className="text-title-1-medium text-text-primary mb-2">You are scheduled</h2>
          <p className="text-body-regular text-text-secondary mb-8">
            An invite has been sent to <span className="font-medium text-text-primary">{form.email}</span> and the host.
          </p>

          <div className="w-full rounded-2xl border border-border-button-default bg-background-secondary-default p-5 text-left flex flex-col gap-3.5 mb-8">
            <div className="flex items-center justify-between">
              <span className="text-title-3-semibold text-text-primary">{selectedEvent.title}</span>
              <Chip color="blue" variant="bold">{selectedEvent.duration} mins</Chip>
            </div>

            <div className="flex items-center gap-2.5 text-body-medium text-text-secondary">
              <HugeCalendar className="size-4 shrink-0 text-foreground-icon-secondary" />
              <span>{formattedDate}</span>
            </div>

            <div className="flex items-center gap-2.5 text-body-medium text-text-secondary">
              <HugeClock className="size-4 shrink-0 text-foreground-icon-secondary" />
              <span>{selectedSlot}</span>
            </div>

            <div className="flex items-center gap-2.5 text-body-2-regular text-text-tertiary">
              <HugeGlobe className="size-4 shrink-0 text-foreground-icon-secondary" />
              <span>{guestTimezone}</span>
            </div>

            {confirmedMeetLink && (
              <div className="flex items-center justify-between pt-2 border-t border-border-button-default">
                <a
                  href={confirmedMeetLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2.5 text-body-medium text-accent-500 hover:underline font-medium"
                >
                  <HugeVideo className="size-4 shrink-0 text-accent-500" />
                  <span>Join Google Meet</span>
                </a>
                <Button
                  variant="secondary"
                  size="xs"
                  leadingIcon={copiedLink ? HugeCheck : HugeCopy}
                  onClick={handleCopyMeet}
                >
                  {copiedLink ? "Copied" : "Copy link"}
                </Button>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => {
              setStep("slot");
              setSelectedSlot(null);
              setBookingError(null);
              // Fresh idempotency key for next booking
              if (typeof crypto !== "undefined" && crypto.randomUUID) {
                setIdempotencyKey(crypto.randomUUID());
              }
            }}
            className="mt-2 text-body-medium text-text-tertiary hover:text-text-primary transition-colors cursor-pointer"
          >
            Reschedule or book another slot
          </button>
        </div>
      ) : (
        /* 3-COLUMN BOOKING INTERFACE */
        <div className="flex flex-col md:flex-row min-h-[520px]">
          {/* COLUMN 1: HOST DETAILS & EVENT SELECTOR */}
          <div className="w-full md:w-[290px] shrink-0 p-6 sm:p-7 border-b md:border-b-0 md:border-r border-border-button-default flex flex-col justify-between bg-background-secondary-default/30">
            <div className="flex flex-col gap-5">
              {/* Host Profile */}
              <div className="flex items-start gap-3.5">
                <Avatar size="lg" initials={hostInitials} color="blue" />
                <div className="flex flex-col">
                  <div className="flex items-center gap-1.5">
                    <span className="text-headline-medium text-text-primary">{host?.name || "Host"}</span>
                    <HugeVerified className="size-4 text-accent-500" />
                  </div>
                  <span className="text-body-2-regular text-text-secondary">
                    usemorrow.xyz/{host?.slug || "you"}
                  </span>
                </div>
              </div>

              {/* Event Overview */}
              <div className="flex flex-col gap-1.5">
                <h1 className="text-title-2-medium text-text-primary">{selectedEvent.title}</h1>
                <p className="text-body-regular text-text-secondary">
                  {selectedEvent.description || host?.welcomeMessage || "Pick a time that works for you."}
                </p>
              </div>

              {/* Key Details */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2 text-body-2-regular text-text-secondary">
                  <HugeVideo className="size-4 shrink-0 text-foreground-icon-secondary" />
                  <span>Google Meet</span>
                </div>
                <div className="flex items-center gap-2 text-body-2-regular text-text-secondary">
                  <HugeGlobe className="size-4 shrink-0 text-foreground-icon-secondary" />
                  <span>{guestTimezone}</span>
                </div>
              </div>

              {/* EVENT TYPE SELECTOR */}
              {activeEvents.length > 1 && (
                <div className="flex flex-col gap-2 pt-4 border-t border-border-button-default">
                  <span className="text-caption-1-semibold text-text-tertiary uppercase tracking-wider">
                    Select Event
                  </span>
                  <div className="flex flex-col gap-1.5">
                    {activeEvents.map((evt) => {
                      const active = selectedEvent.id === evt.id;
                      return (
                        <button
                          key={evt.id}
                          type="button"
                          onClick={() => handleSelectEvent(evt)}
                          className={`py-2 px-3 rounded-xl text-body-2-regular transition-all cursor-pointer flex items-center justify-between text-start ${
                            active
                              ? "bg-accent-500 text-white shadow-2xs font-semibold"
                              : "bg-background-primary-default border border-border-button-default text-text-secondary hover:text-text-primary"
                          }`}
                        >
                          <span className="truncate">{evt.title}</span>
                          <span className="text-caption-1-semibold shrink-0 ms-2">{evt.duration}m</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Selected Summary Pill */}
            {selectedSlot && (
              <div className="mt-6 pt-4 border-t border-border-button-default flex items-center justify-between text-body-2-regular">
                <span className="text-text-secondary">{formattedDate}</span>
                <Badge color="primary">{selectedSlot}</Badge>
              </div>
            )}
          </div>

          {step === "slot" ? (
            <>
              {/* COLUMN 2: DATE CALENDAR */}
              <div className="flex-1 p-6 sm:p-7 border-b md:border-b-0 md:border-r border-border-button-default flex flex-col items-center justify-start gap-4">
                <div className="w-full flex items-center justify-between">
                  <h2 className="text-headline-medium text-text-primary">Select a Date</h2>
                  <span className="text-body-2-regular text-text-tertiary">Month view</span>
                </div>

                <div className="w-full flex justify-center pt-1">
                  <DateCalendar
                    bare
                    aria-label="Select date"
                    value={selectedDate}
                    onChange={(newDate: CalendarDate | null) => {
                      if (newDate) {
                        setSelectedDate(newDate);
                        setSelectedSlot(null);
                        setBookingError(null);
                      }
                    }}
                    minValue={minDate}
                  />
                </div>

                <div className="w-full pt-3 border-t border-border-button-default flex items-center justify-between text-caption-1-semibold text-text-tertiary">
                  <span>Available slots in your timezone</span>
                  <span>Conflict-free</span>
                </div>
              </div>

              {/* COLUMN 3: TIME SLOTS */}
              <div className="w-full md:w-[280px] shrink-0 p-6 sm:p-7 flex flex-col gap-4">
                <div className="flex flex-col gap-0.5">
                  <h2 className="text-headline-medium text-text-primary">Available Times</h2>
                  <span className="text-body-2-regular text-text-secondary truncate">
                    {formattedDate}
                  </span>
                </div>

                {loadingSlots ? (
                  <div className="py-12 flex flex-col items-center justify-center gap-2 text-text-secondary">
                    <div className="size-6 rounded-full border-2 border-accent-500 border-t-transparent animate-spin" />
                    <span className="text-body-2-regular">Syncing calendar...</span>
                  </div>
                ) : slotsError ? (
                  <div className="py-8 px-2 flex flex-col items-center justify-center gap-3 text-center">
                    <p className="text-body-2-regular text-text-error-primary">{slotsError}</p>
                    <Button
                      variant="secondary"
                      size="xs"
                      onClick={() => {
                        // Re-trigger slot fetch by resetting selectedDate to itself
                        setSelectedDate(new CalendarDate(selectedDate.year, selectedDate.month, selectedDate.day));
                      }}
                    >
                      Retry
                    </Button>
                  </div>
                ) : availableSlots.morning.length === 0 && availableSlots.afternoon.length === 0 ? (
                  <div className="py-12 text-center text-body-2-regular text-text-tertiary">
                    No open slots on this date. Please pick another day.
                  </div>
                ) : (
                  <div className="flex flex-col gap-4 max-h-[380px] overflow-y-auto pe-1">
                    {/* Morning Slots */}
                    {availableSlots.morning.length > 0 && (
                      <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-1.5 text-caption-1-semibold text-text-tertiary">
                          <HugeSun className="size-3.5" />
                          <span>Morning</span>
                        </div>
                        <div className="grid grid-cols-1 gap-1.5">
                          {availableSlots.morning.map((time) => {
                            const isPicked = selectedSlot === time;
                            return (
                              <button
                                key={time}
                                type="button"
                                onClick={() => handleSlotPick(time)}
                                className={`w-full py-2 px-3.5 rounded-xl border text-body-medium transition-all cursor-pointer flex items-center justify-between group ${
                                  isPicked
                                    ? "border-accent-500 bg-accent-50 text-accent-700 font-semibold"
                                    : "border-border-button-default bg-background-primary-default hover:border-accent-500 hover:text-accent-500 text-text-primary"
                                }`}
                              >
                                <span>{time}</span>
                                <span className="text-caption-1-semibold text-text-tertiary group-hover:text-accent-500">
                                  Book
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Afternoon Slots */}
                    {availableSlots.afternoon.length > 0 && (
                      <div className="flex flex-col gap-2 pt-2 border-t border-border-button-default">
                        <div className="flex items-center gap-1.5 text-caption-1-semibold text-text-tertiary">
                          <HugeMoon className="size-3.5" />
                          <span>Afternoon</span>
                        </div>
                        <div className="grid grid-cols-1 gap-1.5">
                          {availableSlots.afternoon.map((time) => {
                            const isPicked = selectedSlot === time;
                            return (
                              <button
                                key={time}
                                type="button"
                                onClick={() => handleSlotPick(time)}
                                className={`w-full py-2 px-3.5 rounded-xl border text-body-medium transition-all cursor-pointer flex items-center justify-between group ${
                                  isPicked
                                    ? "border-accent-500 bg-accent-50 text-accent-700 font-semibold"
                                    : "border-border-button-default bg-background-primary-default hover:border-accent-500 hover:text-accent-500 text-text-primary"
                                }`}
                              >
                                <span>{time}</span>
                                <span className="text-caption-1-semibold text-text-tertiary group-hover:text-accent-500">
                                  Book
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          ) : (
            /* DETAILS INTAKE PANE (WHEN A SLOT IS CHOSEN) */
            <form onSubmit={handleConfirm} className="flex-1 p-6 sm:p-8 flex flex-col justify-between gap-6">
              <div className="flex flex-col gap-5 max-w-lg">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setStep("slot");
                      setBookingError(null);
                    }}
                    className="p-1.5 rounded-lg border border-border-button-default hover:bg-background-secondary-default text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
                  >
                    <HugeArrowLeft className="size-4" />
                  </button>
                  <div>
                    <h2 className="text-title-2-medium text-text-primary">Enter your details</h2>
                    <p className="text-body-2-regular text-text-secondary">
                      {formattedDate} at {selectedSlot} ({selectedEvent.duration} mins)
                    </p>
                  </div>
                </div>

                {bookingError && (
                  <div className="p-3.5 rounded-xl border border-border-error-default bg-status-danger-background text-text-error-primary text-body-2-regular flex items-start justify-between gap-2.5">
                    <div>
                      <p className="font-semibold">Unable to complete booking</p>
                      <p className="mt-0.5">{bookingError}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setBookingError(null)}
                      className="text-text-error-primary hover:opacity-75 cursor-pointer text-caption-1-semibold shrink-0"
                    >
                      Dismiss
                    </button>
                  </div>
                )}

                <div className="flex flex-col gap-4">
                  <Input
                    label="Your name"
                    placeholder="Jane Doe"
                    value={form.name}
                    onChange={(val) => setForm({ ...form, name: val })}
                    leadingIcon={HugeUser}
                    isRequired
                  />

                  <Input
                    label="Email address"
                    type="email"
                    placeholder="jane@company.com"
                    value={form.email}
                    onChange={(val) => setForm({ ...form, email: val })}
                    leadingIcon={HugeMail}
                    isRequired
                  />

                  <Input
                    label="Additional guests (optional)"
                    placeholder="colleague@company.com"
                    value={form.guests}
                    onChange={(val) => setForm({ ...form, guests: val })}
                    leadingIcon={HugeAdd}
                  />

                  <Textarea
                    label="What should we prepare for?"
                    placeholder="Topics, questions, or context"
                    value={form.notes}
                    onChange={(val) => setForm({ ...form, notes: val })}
                    rows={3}
                  />
                </div>
              </div>

              <div className="flex items-center justify-between pt-4 border-t border-border-button-default max-w-lg">
                <Button
                  variant="secondary"
                  onClick={() => {
                    setStep("slot");
                    setBookingError(null);
                  }}
                  disabled={isBooking}
                >
                  Change slot
                </Button>
                <Button type="submit" leadingIcon={HugeCheckIn} disabled={isBooking}>
                  {isBooking ? "Securing slot..." : "Confirm booking"}
                </Button>
              </div>
            </form>
          )}
        </div>
      )}

      {/* Powered by Morrow Branding Footer */}
      <div className="flex items-center justify-center pt-2 pb-4">
        <a
          href="/"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border-button-default bg-background-primary-default text-text-secondary hover:text-text-primary text-caption-1-semibold transition-colors shadow-2xs"
        >
          <span>Powered by</span>
          <MorrowLogo size={16} variant="full" />
        </a>
      </div>
    </div>
  );
}
