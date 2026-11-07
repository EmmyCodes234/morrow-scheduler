"use client";

import { useState, useEffect } from "react";
import { Avatar } from "@/components/base/avatar/avatar";
import { Button } from "@/components/base/buttons/button";
import { Chip } from "@/components/base/badges/chip";
import { Input } from "@/components/base/input/input";
import { MorrowLogo } from "@/components/brand/morrow-logo";
import { DirectionProvider } from "@/components/foundations/direction/direction";
import { GoogleMeetIcon } from "@/components/icons/google-meet";
import { ZoomIcon } from "@/components/icons/zoom";
import { MicrosoftTeamsIcon } from "@/components/icons/microsoft-teams";
import {
  HugeCalendar,
  HugeClock,
  HugeGlobe,
  HugeCheck,
  HugeArrowRight,
  HugeLink,
} from "@/components/icons/hugeicons";
import {
  RiShareLine,
  RiDownloadLine,
  RiCalendarLine,
  RiFileList3Line,
  RiCheckboxCircleLine,
  RiAlertLine,
} from "@remixicon/react";
import { MarkdownViewer } from "@/components/shared/markdown-viewer";
import {
  createGoogleCalendarUrl,
  generateIcsContent,
  downloadIcsFile,
} from "@/lib/scheduling/calendar-export";
import { cx } from "@/utils/cx";

export interface InvitationViewProps {
  meeting: {
    id: string;
    title: string;
    description?: string | null;
    startTime: string;
    endTime: string;
    timezone: string;
    invitationToken: string;
    preparationMaterial?: string | null;
    status: string;
    openedEarlyAt?: string | null;
    locationType?: string;
    locationUrl?: string | null;
    host: {
      id: string;
      name: string;
      slug: string;
      avatarUrl?: string | null;
      timezone: string;
    };
  };
  initialAttendee?: {
    id: string;
    name: string;
    email: string;
    status: string;
  } | null;
  roomAccessToken: string;
}

export function InvitationView({
  meeting: initialMeeting,
  initialAttendee,
  roomAccessToken,
}: InvitationViewProps) {
  const [meeting, setMeeting] = useState(initialMeeting);
  const [attendee, setAttendee] = useState(initialAttendee);
  const [name, setName] = useState(initialAttendee?.name || "");
  const [email, setEmail] = useState(initialAttendee?.email || "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showFullMinutes, setShowFullMinutes] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [now, setNow] = useState(() => new Date());

  // Second ticker for live countdown and status checks
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Poll meeting status every 5 seconds for early openings or changes
  useEffect(() => {
    let active = true;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/room/${roomAccessToken}`);
        if (!res.ok) return;
        const data = await res.json();
        if (active && data.room?.meeting) {
          if (data.room.meeting.openedEarlyAt && !meeting.openedEarlyAt) {
            setMeeting((prev) => ({
              ...prev,
              openedEarlyAt: data.room.meeting.openedEarlyAt,
            }));
          }
          if (data.room.meeting.status && data.room.meeting.status !== meeting.status) {
            setMeeting((prev) => ({
              ...prev,
              status: data.room.meeting.status,
            }));
          }
        }
      } catch {}
    }, 5000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [roomAccessToken, meeting.openedEarlyAt, meeting.status]);

  // Meeting times and duration
  const start = new Date(meeting.startTime);
  const end = new Date(meeting.endTime);
  const durationMins = Math.max(1, Math.round((end.getTime() - start.getTime()) / (60 * 1000)));

  // Determine call accessibility
  const earlyAccessWindowMs = 10 * 60 * 1000; // 10 minutes prior
  const isEarlyOpened = Boolean(meeting.openedEarlyAt);
  const isWithinEarlyWindow = now.getTime() >= start.getTime() - earlyAccessWindowMs;
  const isCallOpen = isEarlyOpened || isWithinEarlyWindow;

  // Format date and time
  const formattedDate = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(start);

  const formattedTime = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(start);

  // Time remaining until call opens
  const msUntilStart = start.getTime() - now.getTime();
  const minutesUntilStart = Math.ceil(msUntilStart / 60000);
  const countdownText =
    minutesUntilStart > 60
      ? `${Math.floor(minutesUntilStart / 60)}h ${minutesUntilStart % 60}m`
      : `${Math.max(1, minutesUntilStart)} mins`;

  // Resolved video conference destination
  const videoUrl =
    meeting.locationUrl ||
    (meeting.host as any)?.zoomMeetingUrl ||
    (meeting.host as any)?.teamsMeetingUrl ||
    "https://meet.google.com/new";

  const locationType = (meeting.locationType || "google_meet").toLowerCase();
  const isZoom = locationType.includes("zoom");
  const isTeams = locationType.includes("teams");

  const ProviderIcon = isZoom ? ZoomIcon : isTeams ? MicrosoftTeamsIcon : GoogleMeetIcon;
  const providerLabel = isZoom ? "Zoom" : isTeams ? "Microsoft Teams" : "Google Meet";
  const ctaLabel = isZoom ? "Launch Zoom" : isTeams ? "Join Microsoft Teams" : "Join Google Meet";

  // Share handlers
  const handleShare = async () => {
    const inviteUrl = typeof window !== "undefined" ? window.location.href : "";
    const shareText = `You're invited to ${meeting.title} on Morrow. Date & Time: ${formattedDate} at ${formattedTime}`;

    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({
          title: meeting.title,
          text: shareText,
          url: inviteUrl,
        });
        return;
      } catch {}
    }

    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(inviteUrl);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2500);
    }
  };

  const handleAddToGoogleCalendar = () => {
    const gcalUrl = createGoogleCalendarUrl({
      title: meeting.title,
      description: meeting.description,
      location: videoUrl,
      startTime: start,
      endTime: end,
    });
    window.open(gcalUrl, "_blank", "noopener,noreferrer");
  };

  const handleDownloadIcs = () => {
    const icsContent = generateIcsContent({
      id: meeting.id,
      title: meeting.title,
      description: meeting.description,
      location: videoUrl,
      startTime: start,
      endTime: end,
      organizerName: meeting.host.name,
    });
    downloadIcsFile(`${meeting.title.toLowerCase().replace(/[^a-z0-9]/g, "-")}.ics`, icsContent);
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim()) return;

    setIsSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/meetings/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invitationToken: meeting.invitationToken,
          name: name.trim(),
          email: email.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Unable to confirm attendance. Please try again.");
        return;
      }

      setAttendee(data.attendee);
    } catch {
      setError("Network error. Please check your connection and try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const isCancelled = meeting.status === "cancelled";
  const isConcluded = meeting.status === "concluded";

  return (
    <DirectionProvider locale="en-US">
      <main className="min-h-screen bg-background-full flex flex-col items-center justify-start p-4 sm:p-6 lg:p-8">
        {/* Uncluttered Header Bar */}
        <header className="w-full max-w-2xl flex items-center justify-between py-3 mb-4">
          <div className="flex items-center gap-3">
            <MorrowLogo size={24} />
            <Chip color="neutral" variant="bold">
              {isConcluded ? "Concluded" : isCancelled ? "Cancelled" : isCallOpen ? "Live" : "Upcoming"}
            </Chip>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="small"
              leadingIcon={copiedLink ? HugeCheck : RiShareLine}
              onClick={handleShare}
            >
              {copiedLink ? "Link Copied" : "Share"}
            </Button>
          </div>
        </header>

        {/* ========================================================================= */}
        {/* VIEW 1: ATTENDEE IS REGISTERED (MEETING LOBBY) */}
        {/* ========================================================================= */}
        {attendee ? (
          <div className="w-full max-w-2xl bg-background-primary-default rounded-3xl border border-border-button-default shadow-xs p-6 sm:p-8 flex flex-col gap-6">
            {/* Host Organizer Row */}
            <div className="flex items-center justify-between pb-4 border-b border-border-button-default">
              <div className="flex items-center gap-3">
                <Avatar
                  size="lg"
                  initials={meeting.host.name.slice(0, 2).toUpperCase()}
                  color="blue"
                />
                <div className="flex flex-col">
                  <span className="text-body-medium font-semibold text-text-primary">
                    {meeting.host.name}
                  </span>
                  <span className="text-caption-1-medium text-text-tertiary">
                    Meeting Host
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-1.5 text-caption-1-medium text-text-secondary">
                <HugeGlobe className="size-4 text-text-tertiary" />
                <span>{meeting.timezone}</span>
              </div>
            </div>

            {/* Title & Description */}
            <div className="flex flex-col gap-2">
              <h1 className="text-title-2-semibold text-text-primary tracking-tight">
                {meeting.title}
              </h1>
              {meeting.description && (
                <p className="text-body-regular text-text-secondary leading-relaxed">
                  {meeting.description}
                </p>
              )}
            </div>

            {/* Time & Location Details Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-4 rounded-2xl bg-background-secondary-default border border-border-button-default">
              <div className="flex items-center gap-3">
                <div className="size-9 rounded-xl bg-background-primary-default border border-border-button-default flex items-center justify-center shrink-0 text-accent-600">
                  <HugeCalendar className="size-4.5" />
                </div>
                <div className="flex flex-col min-w-0">
                  <span className="text-caption-2-medium text-text-tertiary uppercase">Date</span>
                  <span className="text-body-2-medium font-semibold text-text-primary truncate">
                    {formattedDate}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="size-9 rounded-xl bg-background-primary-default border border-border-button-default flex items-center justify-center shrink-0 text-accent-600">
                  <HugeClock className="size-4.5" />
                </div>
                <div className="flex flex-col min-w-0">
                  <span className="text-caption-2-medium text-text-tertiary uppercase">Time & Duration</span>
                  <span className="text-body-2-medium font-semibold text-text-primary truncate">
                    {formattedTime} ({durationMins}m)
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-3 sm:col-span-2 pt-2 border-t border-border-button-default/50">
                <div className="size-9 rounded-xl bg-background-primary-default border border-border-button-default flex items-center justify-center shrink-0">
                  <ProviderIcon className="size-4.5" />
                </div>
                <div className="flex flex-col min-w-0">
                  <span className="text-caption-2-medium text-text-tertiary uppercase">Video Platform</span>
                  <span className="text-body-2-medium font-semibold text-text-primary truncate">
                    {providerLabel}
                  </span>
                </div>
              </div>
            </div>

            {/* 1-Click Calendar Holds */}
            <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-2xl bg-background-secondary-default/40 border border-border-button-default">
              <span className="text-caption-1-medium text-text-secondary">
                Add to personal calendar:
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="xs"
                  leadingIcon={RiCalendarLine}
                  onClick={handleAddToGoogleCalendar}
                >
                  Google Calendar
                </Button>
                <Button
                  variant="secondary"
                  size="xs"
                  leadingIcon={RiDownloadLine}
                  onClick={handleDownloadIcs}
                >
                  Outlook / .ics
                </Button>
              </div>
            </div>

            {/* Call State & Action Button */}
            {isCancelled ? (
              <div className="p-4 rounded-2xl bg-background-error-default/10 border border-border-error-default flex items-center gap-3 text-text-error-primary">
                <RiAlertLine className="size-5 shrink-0" />
                <div>
                  <p className="text-body-medium font-semibold">This meeting has been cancelled</p>
                  <p className="text-body-2-regular">The host cancelled this scheduled session.</p>
                </div>
              </div>
            ) : isConcluded ? (
              <div className="p-4 rounded-2xl bg-background-secondary-default border border-border-button-default flex items-center gap-3 text-text-secondary">
                <RiCheckboxCircleLine className="size-5 shrink-0 text-status-lime-text" />
                <div>
                  <p className="text-body-medium font-semibold text-text-primary">Meeting Concluded</p>
                  <p className="text-body-2-regular">This meeting session has ended.</p>
                </div>
              </div>
            ) : !isCallOpen ? (
              <div className="p-5 rounded-2xl bg-accent-50/50 dark:bg-accent-950/20 border border-accent-200 dark:border-accent-900 flex flex-col gap-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-text-primary font-semibold text-body-medium">
                    <HugeClock className="size-4.5 text-accent-600 shrink-0" />
                    <span>Lobby Waiting Area</span>
                  </div>
                  <Chip color="blue" variant="bold">
                    Opens in {countdownText}
                  </Chip>
                </div>
                <p className="text-body-2-regular text-text-secondary leading-relaxed">
                  You are confirmed as <span className="font-semibold text-text-primary">{attendee.name}</span> ({attendee.email}).
                  The launch button will automatically activate here when the meeting opens.
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-2.5">
                <a
                  href={videoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full"
                >
                  <Button
                    variant="primary"
                    size="medium"
                    className="w-full justify-center py-3.5 rounded-2xl font-semibold shadow-sm text-body-medium cursor-pointer"
                    leadingIcon={ProviderIcon}
                    trailingIcon={HugeArrowRight}
                  >
                    {ctaLabel}
                  </Button>
                </a>
                <span className="text-caption-2-medium text-center text-text-tertiary">
                  The room is live. Click to connect directly via {providerLabel}.
                </span>
              </div>
            )}

            {/* Preparation Material & Agenda (if provided) */}
            {meeting.preparationMaterial && (
              <div className="flex flex-col gap-3 pt-4 border-t border-border-button-default">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-text-primary font-semibold text-body-medium">
                    <RiFileList3Line className="size-4.5 text-accent-600" />
                    <span>Preparation Notes & Agenda</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowFullMinutes(!showFullMinutes)}
                    className="text-caption-1-semibold text-accent-600 hover:text-accent-500 cursor-pointer"
                  >
                    {showFullMinutes ? "Collapse" : "View"}
                  </button>
                </div>

                {showFullMinutes && (
                  <div className="p-4 rounded-2xl bg-background-secondary-default/50 border border-border-button-default text-body-2-regular text-text-primary">
                    <MarkdownViewer content={meeting.preparationMaterial || ""} />
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          /* ========================================================================= */
          /* VIEW 2: UNREGISTERED GUEST ENTRY FORM (CLEAN & COMPACT) */
          /* ========================================================================= */
          <div className="w-full max-w-md bg-background-primary-default rounded-3xl border border-border-button-default shadow-xs p-6 sm:p-8 flex flex-col gap-6">
            {/* Host Banner */}
            <div className="flex items-center gap-3">
              <Avatar
                size="md"
                initials={meeting.host.name.slice(0, 2).toUpperCase()}
                color="blue"
              />
              <div className="flex flex-col">
                <span className="text-caption-2-medium text-text-tertiary uppercase">Invitation</span>
                <span className="text-body-medium font-semibold text-text-primary">
                  {meeting.host.name} invites you
                </span>
              </div>
            </div>

            {/* Meeting Header */}
            <div className="flex flex-col gap-1.5">
              <h1 className="text-title-2-semibold text-text-primary tracking-tight">
                {meeting.title}
              </h1>
              {meeting.description && (
                <p className="text-body-2-regular text-text-secondary leading-relaxed">
                  {meeting.description}
                </p>
              )}
            </div>

            {/* Clean Date/Time Tile */}
            <div className="p-3.5 rounded-2xl bg-background-secondary-default border border-border-button-default flex flex-col gap-2">
              <div className="flex items-center gap-2 text-body-2-medium font-semibold text-text-primary">
                <HugeCalendar className="size-4 text-accent-600 shrink-0" />
                <span>{formattedDate}</span>
              </div>
              <div className="flex items-center gap-2 text-caption-1-medium text-text-secondary">
                <HugeClock className="size-4 text-text-tertiary shrink-0" />
                <span>
                  {formattedTime} ({durationMins}m) &bull; {providerLabel}
                </span>
              </div>
            </div>

            {/* RSVP Form */}
            <form onSubmit={handleRegister} className="flex flex-col gap-4">
              {error && (
                <div className="p-3 rounded-xl bg-background-error-default/10 border border-border-error-default text-text-error-primary text-body-2-medium">
                  {error}
                </div>
              )}

              <Input
                label="Your Name"
                value={name}
                onChange={setName}
                placeholder="e.g. Alex Morgan"
                isRequired
              />

              <Input
                label="Your Email"
                type="email"
                value={email}
                onChange={setEmail}
                placeholder="e.g. alex@example.com"
                isRequired
              />

              <Button
                variant="primary"
                size="medium"
                type="submit"
                disabled={isSubmitting || !name.trim() || !email.trim()}
                className="w-full justify-center mt-2 font-semibold"
                trailingIcon={HugeArrowRight}
              >
                {isSubmitting ? "Confirming..." : "Confirm Attendance & Enter Lobby"}
              </Button>
            </form>
          </div>
        )}
      </main>
    </DirectionProvider>
  );
}
