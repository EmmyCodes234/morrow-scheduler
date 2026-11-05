"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Avatar } from "@/components/base/avatar/avatar";
import { Button } from "@/components/base/buttons/button";
import { Chip } from "@/components/base/badges/chip";
import { MorrowLogo } from "@/components/brand/morrow-logo";
import { cx } from "@/utils/cx";
import { MarkdownViewer } from "@/components/shared/markdown-viewer";
import {
  RiCalendarLine,
  RiTimeLine,
  RiUserLine,
  RiBookOpenLine,
  RiCheckboxCircleLine,
  RiArrowRightLine,
  RiCheckLine,
  RiAlertLine,
  RiShareLine,
  RiWhatsappLine,
  RiFileList3Line,
} from "@remixicon/react";

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
  const router = useRouter();

  // State
  const [meeting, setMeeting] = useState(initialMeeting);
  const [attendee, setAttendee] = useState(initialAttendee);
  const [name, setName] = useState(initialAttendee?.name || "");
  const [email, setEmail] = useState(initialAttendee?.email || "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showFullMinutes, setShowFullMinutes] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [now, setNow] = useState(() => new Date());

  // Local ticker every 1 second
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Poll room access status every 5 seconds to catch early room openings without manual refresh
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

  const startDate = new Date(meeting.startTime);
  const defaultEarlyOpensAt = new Date(startDate.getTime() - 15 * 60 * 1000);
  const isEarlyOpened = Boolean(meeting.openedEarlyAt);
  const isCallOpen = isEarlyOpened || now.getTime() >= defaultEarlyOpensAt.getTime();

  // Time remaining until default call opening
  const msRemaining = Math.max(0, defaultEarlyOpensAt.getTime() - now.getTime());
  const totalSeconds = Math.floor(msRemaining / 1000);
  const countdownMinutes = Math.floor(totalSeconds / 60);
  const countdownSeconds = totalSeconds % 60;
  const countdownHours = Math.floor(countdownMinutes / 60);
  const countdownDays = Math.floor(countdownHours / 24);

  const countdownText =
    countdownDays > 0
      ? `${countdownDays}d ${countdownHours % 24}h`
      : countdownHours > 0
      ? `${countdownHours}h ${countdownMinutes % 60}m ${countdownSeconds}s`
      : `${countdownMinutes}m ${countdownSeconds < 10 ? "0" : ""}${countdownSeconds}s`;

  const formattedDate = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: meeting.timezone,
  }).format(startDate);

  const formattedTime = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: meeting.timezone,
    timeZoneName: "short",
  }).format(startDate);

  const earlyOpensTimeFormatted = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: meeting.timezone,
    timeZoneName: "short",
  }).format(defaultEarlyOpensAt);

  const durationMins = Math.max(
    15,
    Math.round((new Date(meeting.endTime).getTime() - startDate.getTime()) / (1000 * 60))
  );

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const trimmedName = name.trim();
    const trimmedEmail = email.trim();

    if (!trimmedName || trimmedName.length < 2) {
      setError("Please enter your full name (at least 2 characters).");
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!trimmedEmail || !emailRegex.test(trimmedEmail)) {
      setError("Please enter a valid email address.");
      return;
    }

    setIsSubmitting(true);

    try {
      const res = await fetch("/api/meetings/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invitationToken: meeting.invitationToken,
          name: trimmedName,
          email: trimmedEmail,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to register.");
      }

      setAttendee(data.attendee);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleJoinRoom() {
    router.push(`/room/${roomAccessToken}`);
  }

  function handleCopyShareLink() {
    if (typeof window !== "undefined") {
      navigator.clipboard.writeText(window.location.href);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2500);
    }
  }

  function handleWhatsAppShare() {
    const inviteUrl =
      typeof window !== "undefined"
        ? window.location.href
        : `https://usemorrow.xyz/j/${meeting.invitationToken}`;
    const msg = `You're invited to ${meeting.title} on Morrow.\nDate & Time: ${formattedDate} at ${formattedTime}\nJoin link & preparation materials: ${inviteUrl}\nNo account needed. Open on your phone to review minutes and enter the room.`;

    if (typeof navigator !== "undefined" && navigator.share) {
      navigator
        .share({
          title: meeting.title,
          text: msg,
          url: inviteUrl,
        })
        .catch(() => {
          window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, "_blank");
        });
    } else if (typeof window !== "undefined") {
      window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, "_blank");
    }
  }

  // =========================================================================
  // VIEW 1: MEETING LOBBY (ATTENDEE IS REGISTERED)
  // =========================================================================
  if (attendee) {
    const isCancelled = meeting.status === "cancelled";
    const isConcluded = meeting.status === "concluded";

    return (
      <div className="min-h-[100dvh] bg-background-full flex flex-col items-center justify-start p-3 sm:p-6 lg:p-8 overflow-x-hidden">
        {/* Navigation / Header */}
        <header className="w-full max-w-2xl flex items-center justify-between py-3 mb-2">
          <div className="flex items-center gap-2">
            <MorrowLogo className="h-6 w-auto" />
            <span className="text-caption-1-semibold text-text-tertiary">Morrow Rooms</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleWhatsAppShare}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border-button-default bg-background-primary-default text-text-secondary hover:text-text-primary text-caption-1-semibold transition-colors cursor-pointer"
              title="Share via WhatsApp"
            >
              <RiWhatsappLine className="size-3.5 text-emerald-600" />
              <span className="hidden sm:inline">WhatsApp</span>
            </button>
            <button
              type="button"
              onClick={handleCopyShareLink}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border-button-default bg-background-primary-default text-text-secondary hover:text-text-primary text-caption-1-semibold transition-colors cursor-pointer"
            >
              {copiedLink ? (
                <>
                  <RiCheckLine className="size-3.5 text-accent-600" />
                  <span className="text-accent-600">Copied!</span>
                </>
              ) : (
                <>
                  <RiShareLine className="size-3.5" />
                  <span>Share Link</span>
                </>
              )}
            </button>
          </div>
        </header>

        {/* Main Lobby Card */}
        <div className="w-full max-w-2xl bg-background-primary-default rounded-3xl border border-border-button-default shadow-sm p-5 sm:p-7 flex flex-col gap-6">
          {/* Header Info */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <Chip color="lime" variant="caption" className="font-semibold uppercase tracking-wider">
                  Registration Confirmed
                </Chip>
                {isEarlyOpened && (
                  <Chip color="blue" variant="caption" className="font-semibold uppercase tracking-wider">
                    Opened Early by Host
                  </Chip>
                )}
              </div>
              <span className="text-caption-1-semibold text-text-tertiary">
                Welcome, {attendee.name}
              </span>
            </div>

            <h1 className="text-title-2-medium sm:text-title-1-medium text-text-primary font-semibold leading-tight">
              {meeting.title}
            </h1>

            {meeting.description && (
              <p className="text-body-regular text-text-secondary leading-relaxed">
                {meeting.description}
              </p>
            )}
          </div>

          {/* Meeting Metadata Banner */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 p-3.5 rounded-2xl bg-background-secondary-default/50 border border-border-button-default">
            <div className="flex items-center gap-3">
              <div className="size-9 rounded-xl bg-background-primary-default border border-border-button-default flex items-center justify-center shrink-0 text-accent-600">
                <RiCalendarLine className="size-4.5" />
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
                <RiTimeLine className="size-4.5" />
              </div>
              <div className="flex flex-col min-w-0">
                <span className="text-caption-2-medium text-text-tertiary uppercase">Scheduled Start</span>
                <span className="text-body-2-medium font-semibold text-text-primary truncate">
                  {formattedTime} ({durationMins} mins)
                </span>
              </div>
            </div>

            <div className="flex items-center gap-3 sm:col-span-2 pt-1 border-t border-border-button-default/50">
              <Avatar
                initials={meeting.host.name.slice(0, 2).toUpperCase()}
                size="sm"
                className="shrink-0"
              />
              <div className="flex flex-col min-w-0 flex-1">
                <span className="text-caption-2-medium text-text-tertiary uppercase">Organised By</span>
                <span className="text-body-2-medium font-medium text-text-primary truncate">
                  {meeting.host.name} (Committee Host)
                </span>
              </div>
            </div>
          </div>

          {/* Lifecycle & Call Access Control */}
          {isCancelled ? (
            <div className="p-4 rounded-2xl bg-background-error-default/10 border border-border-error-default flex items-center gap-3 text-text-error-primary">
              <RiAlertLine className="size-5 shrink-0" />
              <div>
                <p className="text-body-medium font-semibold">This meeting has been cancelled</p>
                <p className="text-body-2-regular">The organiser cancelled this meeting session.</p>
              </div>
            </div>
          ) : isConcluded ? (
            <div className="p-4 rounded-2xl bg-background-secondary-default border border-border-button-default flex items-center gap-3 text-text-secondary">
              <RiCheckboxCircleLine className="size-5 shrink-0 text-status-lime-text" />
              <div>
                <p className="text-body-medium font-semibold text-text-primary">Meeting Concluded</p>
                <p className="text-body-2-regular">This meeting has ended. The permanent meeting ledger is being finalised.</p>
              </div>
            </div>
          ) : !isCallOpen ? (
            /* EARLY ARRIVAL STATE */
            <div className="flex flex-col gap-4">
              <div className="p-4 rounded-2xl bg-accent-50/50 dark:bg-accent-950/20 border border-accent-200 dark:border-accent-900 flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-text-primary font-semibold text-body-medium">
                    <RiTimeLine className="size-4.5 text-accent-600 shrink-0" />
                    <span>Early Arrival Notice</span>
                  </div>
                  <Chip color="blue" variant="bold">
                    Opens in {countdownText}
                  </Chip>
                </div>
                <p className="text-body-2-regular text-text-secondary leading-relaxed">
                  Call access opens automatically at <strong>{earlyOpensTimeFormatted}</strong> (15 minutes prior to start), or immediately if the organiser opens early.
                </p>
                <p className="text-caption-1-medium text-text-tertiary">
                  You are registered and all set. You can review the previous minutes and agenda below while waiting.
                </p>
              </div>

              <div className="flex flex-col gap-2">
                <Button
                  variant="secondary"
                  size="medium"
                  disabled
                  className="w-full justify-center py-3.5 rounded-2xl font-semibold opacity-75 cursor-not-allowed text-body-medium"
                  leadingIcon={RiTimeLine}
                >
                  Call Opens in {countdownText}
                </Button>
                <span className="text-caption-2-medium text-center text-text-tertiary">
                  Entry will automatically activate when the call opens. No page refresh needed.
                </span>
              </div>
            </div>
          ) : (
            /* CALL OPEN STATE */
            <div className="flex flex-col gap-2">
              <Button
                variant="primary"
                size="medium"
                className="w-full justify-center py-3.5 rounded-2xl font-semibold shadow-sm text-body-medium cursor-pointer"
                trailingIcon={RiArrowRightLine}
                onClick={handleJoinRoom}
              >
                Enter Morrow Room
              </Button>
              <span className="text-caption-2-medium text-center text-text-tertiary">
                {isEarlyOpened
                  ? "The organiser has opened the room early. You can join the live call now."
                  : "Call access is open. You can enter to test camera, microphone, and join the room."}
              </span>
            </div>
          )}

          {/* Section: Meeting Preparation & Context */}
          {meeting.preparationMaterial && (
            <div className="flex flex-col gap-3 pt-4 border-t border-border-button-default">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-text-primary font-semibold">
                  <RiBookOpenLine className="size-4.5 text-accent-600" />
                  <span className="text-body-medium">Preparation & Previous Minutes</span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowFullMinutes(!showFullMinutes)}
                  className="text-caption-1-semibold text-accent-600 hover:text-accent-500 cursor-pointer flex items-center gap-1"
                >
                  <RiFileList3Line className="size-3.5" />
                  <span>{showFullMinutes ? "Collapse Record" : "View Full Record"}</span>
                </button>
              </div>

              {/* Concise Highlights Card */}
              <div className="p-3.5 rounded-2xl bg-background-secondary-default/40 border border-border-button-default flex flex-col gap-2.5">
                <span className="text-caption-1-semibold text-text-primary">Key Context & Open Matters:</span>
                <ul className="text-body-2-medium text-text-secondary space-y-1.5 pl-1">
                  <li className="flex items-start gap-2">
                    <span className="size-1.5 rounded-full bg-accent-500 mt-2 shrink-0" />
                    <span>Tournament vision: Distinctive benchmark experience for Nigeria; strict tournament time management.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="size-1.5 rounded-full bg-accent-500 mt-2 shrink-0" />
                    <span>Proposed 22-game structure pending technical finalisation (250–300 players expected; reg deadline 14 Nov).</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="size-1.5 rounded-full bg-accent-500 mt-2 shrink-0" />
                    <span>Scrabble Bee with AI word challenges strictly constrained to <strong>CSW24</strong> official lexicon.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="size-1.5 rounded-full bg-accent-500 mt-2 shrink-0" />
                    <span>Benin site visit logistics, player hospitality, backup internet, and action register review.</span>
                  </li>
                </ul>
              </div>

              {/* Full Cleaned Minutes (Expandable Markdown viewer) */}
              {showFullMinutes && (
                <div className="p-4 sm:p-5 rounded-2xl bg-background-secondary-default/60 border border-border-button-default text-body-2-regular text-text-primary overflow-x-auto whitespace-pre-wrap font-sans leading-relaxed flex flex-col gap-4 animate-in fade-in duration-200">
                  <div className="flex items-center justify-between pb-3 border-b border-border-button-default">
                    <span className="text-caption-1-semibold text-text-secondary">
                      Cleaned Minutes of 2 November 2026
                    </span>
                    <Chip color="neutral" variant="caption">Read-Only Context</Chip>
                  </div>
                  <MarkdownViewer content={meeting.preparationMaterial || ""} />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  // =========================================================================
  // VIEW 2: PUBLIC INVITATION & REGISTRATION FORM (GUEST ENTRY)
  // =========================================================================
  return (
    <div className="min-h-[100dvh] bg-background-full flex flex-col items-center justify-start sm:justify-center p-4 sm:p-6 lg:p-8 overflow-x-hidden">
      {/* Brand Header */}
      <div className="w-full max-w-md flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <MorrowLogo className="h-6 w-auto" />
          <span className="text-caption-1-semibold text-text-tertiary">Morrow Rooms</span>
        </div>
        <Chip color="neutral" variant="caption">
          Shareable Link
        </Chip>
      </div>

      {/* Main Registration Card */}
      <div className="w-full max-w-md bg-background-primary-default rounded-3xl border border-border-button-default shadow-sm p-6 sm:p-8 flex flex-col gap-6">
        {/* Meeting Header */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="size-2 rounded-full bg-accent-500 animate-pulse" />
            <span className="text-caption-1-semibold text-accent-600 font-semibold uppercase tracking-wider">
              Meeting Invitation
            </span>
          </div>
          <h1 className="text-title-2-medium font-semibold text-text-primary leading-tight">
            {meeting.title}
          </h1>
          {meeting.description && (
            <p className="text-body-2-medium text-text-secondary">
              {meeting.description}
            </p>
          )}
        </div>

        {/* Meeting Quick Schedule Bar */}
        <div className="p-3.5 rounded-2xl bg-background-secondary-default/50 border border-border-button-default flex flex-col gap-2">
          <div className="flex items-center gap-2 text-text-primary text-body-2-medium font-medium">
            <RiCalendarLine className="size-4 text-accent-600 shrink-0" />
            <span>{formattedDate}</span>
          </div>
          <div className="flex items-center gap-2 text-text-secondary text-body-2-medium">
            <RiTimeLine className="size-4 text-accent-600 shrink-0" />
            <span>{formattedTime}</span>
          </div>
          <div className="flex items-center gap-2 text-text-tertiary text-caption-1-semibold pt-1 border-t border-border-button-default/50">
            <RiUserLine className="size-3.5 shrink-0" />
            <span>Organised by {meeting.host.name}</span>
          </div>
        </div>

        {/* Error Alert */}
        {error && (
          <div className="p-3 rounded-xl bg-background-error-default/10 border border-border-error-default text-text-error-primary text-body-2-medium flex items-center gap-2">
            <RiAlertLine className="size-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Registration Form */}
        <form onSubmit={handleRegister} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="guest-name" className="text-caption-1-semibold text-text-primary font-medium">
              Your Full Name <span className="text-text-error-primary">*</span>
            </label>
            <input
              id="guest-name"
              type="text"
              required
              placeholder="e.g. Dr. Ngozi Adebayo"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-border-button-default bg-background-primary-default text-text-primary placeholder:text-text-placeholder text-body-medium outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="guest-email" className="text-caption-1-semibold text-text-primary font-medium">
              Your Email Address <span className="text-text-error-primary">*</span>
            </label>
            <input
              id="guest-email"
              type="email"
              required
              placeholder="name@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-border-button-default bg-background-primary-default text-text-primary placeholder:text-text-placeholder text-body-medium outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring"
            />
            <span className="text-caption-2-medium text-text-tertiary">
              Used for attendance and meeting confirmation. No account or password required.
            </span>
          </div>

          <Button
            type="submit"
            variant="primary"
            size="medium"
            disabled={isSubmitting}
            className="w-full justify-center mt-2 py-3 rounded-2xl font-semibold shadow-sm text-body-medium cursor-pointer"
            trailingIcon={RiArrowRightLine}
          >
            {isSubmitting ? "Entering Lobby..." : "Continue to Meeting Lobby"}
          </Button>
        </form>

        {/* Footer Guarantee */}
        <div className="flex items-center justify-center gap-1.5 text-caption-2-medium text-text-tertiary text-center">
          <RiCheckboxCircleLine className="size-3.5 text-accent-600 shrink-0" />
          <span>No app download or account creation required.</span>
        </div>
      </div>
    </div>
  );
}
