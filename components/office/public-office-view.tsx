"use client";

import { useState, useEffect, useRef } from "react";
import { Avatar } from "@/components/base/avatar/avatar";
import { Chip } from "@/components/base/badges/chip";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { Textarea } from "@/components/base/textarea/textarea";
import { Spinner } from "@/components/base/spinner/spinner";
import {
  HugeVerified,
  HugeClock,
  HugeVideo,
  HugeCheck,
  HugeCalendar,
  HugeCopy,
} from "@/components/icons/hugeicons";
import { MorrowLogo } from "@/components/brand/morrow-logo";
import { playDoorKnock, playDoorbellChime } from "@/lib/audio/chime";
import { useMorrowRealtime } from "@/lib/realtime/use-realtime";
import { PublicBookingView, type PublicHost, type PublicEventType } from "@/components/scheduling/public-booking";

export interface PublicOfficeViewProps {
  host: PublicHost & {
    officeStatus?: string;
    officeTopic?: string | null;
    officeSpeedChatMins?: number;
  };
  eventTypes?: PublicEventType[];
}

export function PublicOfficeView({ host, eventTypes = [] }: PublicOfficeViewProps) {
  const [officeState, setOfficeState] = useState<"idle" | "queued" | "ringing" | "admitted" | "fallback">(
    host.officeStatus === "closed" ? "fallback" : "idle"
  );
  const [guestName, setGuestName] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [topic, setTopic] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [activeKnockId, setActiveKnockId] = useState<string | null>(null);
  const [queuePosition, setQueuePosition] = useState<number>(1);
  const [secondsRemaining, setSecondsRemaining] = useState<number>(60);
  const [meetLink, setMeetLink] = useState<string | null>(null);
  const [copiedRoomLink, setCopiedRoomLink] = useState(false);

  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const hostInitials = host.name
    ? host.name
        .split(" ")
        .filter(Boolean)
        .map((n) => n[0])
        .join("")
        .slice(0, 2)
        .toUpperCase()
    : "H";

  const isDoorOpen = host.officeStatus === "open";
  const isDoorBusy = host.officeStatus === "busy";
  const isDoorClosed = host.officeStatus === "closed";

  // Clean up polling interval on unmount
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, []);

  // Realtime by Default: Instant admission, queue promotion, and door state events
  useMorrowRealtime({
    channels: activeKnockId
      ? [`knock:${activeKnockId}`, `public:host:${host.slug}`]
      : [`public:host:${host.slug}`],
    enabled: true,
    onEvent: (event) => {
      if (event.type === "knock.admitted") {
        setMeetLink(event.payload.meetLink);
        setOfficeState("admitted");
        playDoorbellChime();
      } else if (event.type === "knock.promoted") {
        setSecondsRemaining(60);
        setOfficeState("ringing");
        playDoorbellChime();
      } else if (
        event.type === "knock.declined" ||
        event.type === "knock.missed" ||
        event.type === "knock.cancelled"
      ) {
        setOfficeState("fallback");
      } else if (event.type === "office.status_changed") {
        if (event.payload.officeStatus === "closed" && officeState === "idle") {
          setOfficeState("fallback");
        }
      }
    },
  });

  // Status polling for queued and ringing knocks as backup to realtime
  useEffect(() => {
    if ((officeState !== "ringing" && officeState !== "queued") || !activeKnockId) return;

    let timerInterval: NodeJS.Timeout | null = null;

    // Countdown ticker only when ringing
    if (officeState === "ringing") {
      timerInterval = setInterval(() => {
        setSecondsRemaining((prev) => {
          if (prev <= 1) {
            if (timerInterval) clearInterval(timerInterval);
            setOfficeState("fallback");
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }

    // Poll status from server
    const pollStatus = async () => {
      try {
        const res = await fetch(`/api/office/knock/${activeKnockId}`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.knock) {
          if (data.knock.status === "admitted" && data.knock.meetLink) {
            if (timerInterval) clearInterval(timerInterval);
            if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
            setMeetLink(data.knock.meetLink);
            setOfficeState("admitted");
            playDoorbellChime();
          } else if (data.knock.status === "ringing" && officeState === "queued") {
            // Promoted from queue to ringing!
            setSecondsRemaining(60);
            setOfficeState("ringing");
            playDoorbellChime();
          } else if (data.knock.status === "declined" || data.knock.status === "missed") {
            if (timerInterval) clearInterval(timerInterval);
            if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
            setOfficeState("fallback");
          } else if (data.knock.status === "queued" && data.knock.queuePosition) {
            setQueuePosition(data.knock.queuePosition);
          }
        }
      } catch (err) {
        console.error("Error polling knock status:", err);
      }
    };

    pollStatus();
    pollIntervalRef.current = setInterval(pollStatus, 2000);

    return () => {
      if (timerInterval) clearInterval(timerInterval);
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, [officeState, activeKnockId]);

  const handleKnockSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!guestName.trim() || !guestEmail.trim() || !topic.trim()) return;

    setIsSubmitting(true);
    setErrorMsg(null);

    // Audio knock feedback
    playDoorKnock();

    try {
      const res = await fetch(`/api/office/${host.slug}/knock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          guestName: guestName.trim(),
          guestEmail: guestEmail.trim(),
          topic: topic.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        if (data.isClosed) {
          setOfficeState("fallback");
        } else {
          setErrorMsg(data.error || "Unable to send knock. Please try again.");
        }
        return;
      }

      if (data.knock?.id) {
        setActiveKnockId(data.knock.id);
        if (data.knock.status === "queued") {
          setQueuePosition(data.knock.queuePosition || 1);
          setOfficeState("queued");
        } else {
          setSecondsRemaining(60);
          setOfficeState("ringing");
        }
      }
    } catch (err) {
      console.error("Failed to submit knock:", err);
      setErrorMsg("Network error. Please check your connection and try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancelKnock = async () => {
    if (activeKnockId) {
      fetch(`/api/office/knock/${activeKnockId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel" }),
      }).catch(() => {});
    }
    setOfficeState("idle");
    setActiveKnockId(null);
  };

  const handleCopyRoomLink = () => {
    if (!meetLink) return;
    navigator.clipboard.writeText(meetLink);
    setCopiedRoomLink(true);
    setTimeout(() => setCopiedRoomLink(false), 2000);
  };

  return (
    <div className="w-full max-w-4xl mx-auto flex flex-col gap-4 sm:gap-6">
      {/* Brand Header */}
      <div className="flex items-center justify-between px-1 sm:px-2">
        <div className="flex items-center gap-2">
          <MorrowLogo className="h-5 sm:h-6 w-auto" />
          <span className="text-body-2-regular text-text-tertiary">|</span>
          <span className="text-body-2-medium text-text-secondary">Office</span>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2">
          {isDoorOpen ? (
            <Chip color="lime" variant="bold" className="animate-pulse">
              🟢 Door Open
            </Chip>
          ) : isDoorBusy ? (
            <Chip color="yellow" variant="bold">
              <span className="hidden sm:inline">🟡 In Call (Queue Open)</span>
              <span className="sm:hidden">🟡 In Call</span>
            </Chip>
          ) : (
            <Chip color="soft" variant="caption">
              🔴 Office Closed
            </Chip>
          )}
        </div>
      </div>

      {/* STATE 5: FALLBACK / CALENDAR SCHEDULER (Single layer card layout to eliminate mobile padding squeeze) */}
      {officeState === "fallback" ? (
        <div className="flex flex-col gap-4 sm:gap-6 w-full animate-in fade-in duration-300">
          <div className="p-4 sm:p-5 rounded-3xl bg-background-primary-default border border-border-button-default shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3.5 sm:gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className="size-10 sm:size-11 rounded-2xl bg-accent-50 dark:bg-accent-950/40 border border-border-button-default flex items-center justify-center shrink-0">
                <HugeCalendar className="size-5 text-accent-600" />
              </div>
              <div className="flex flex-col min-w-0">
                <span className="text-body-medium font-semibold text-text-primary">
                  {isDoorClosed ? `${host.name}'s door is currently closed.` : `${host.name} is away from desk.`}
                </span>
                <span className="text-caption-1-medium text-text-secondary">
                  {topic
                    ? `Your note was sent. Schedule a confirmed slot below to guarantee a call.`
                    : "Pick a dedicated slot on their calendar below to connect."}
                </span>
              </div>
            </div>

            {!isDoorClosed && (
              <Button
                variant="secondary"
                size="small"
                className="w-full sm:w-auto shrink-0 justify-center min-h-[40px]"
                onClick={() => setOfficeState("idle")}
              >
                Try Knocking Again
              </Button>
            )}
          </div>

          {/* Embedded Calendar Scheduler */}
          <PublicBookingView host={host} initialEventTypes={eventTypes} />
        </div>
      ) : (
        /* MAIN OFFICE CARD FOR IDLE, RINGING, QUEUED, & ADMITTED */
        <div className="rounded-3xl border border-border-button-default bg-background-primary-default p-4 sm:p-8 lg:p-10 shadow-sm flex flex-col gap-6 sm:gap-8">
          {/* Host Identity Hero */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 sm:pb-6 border-b border-border-button-default">
            <div className="flex items-center gap-3.5 sm:gap-4 min-w-0">
              <Avatar size="lg" initials={hostInitials} src={host.avatarUrl || undefined} color="blue" />
              <div className="flex flex-col min-w-0">
                <div className="flex items-center gap-1.5 min-w-0">
                  <h1 className="text-title-2-medium text-text-primary truncate">{host.name}</h1>
                  <HugeVerified className="size-4 text-accent-500 shrink-0" />
                </div>
                <span className="text-caption-1-medium text-text-secondary truncate">
                  usemorrow.xyz/{host.slug}/office
                </span>
              </div>
            </div>

            <div className="flex flex-wrap sm:flex-col items-start sm:items-end gap-1.5 sm:gap-1">
              <div className="flex items-center gap-1.5 text-body-2-regular text-text-secondary">
                <HugeClock className="size-4 text-foreground-icon-secondary shrink-0" />
                <span>{host.officeSpeedChatMins || 10} min speed-chat</span>
              </div>
              {host.officeTopic ? (
                <div className="inline-flex items-center text-caption-1-semibold text-accent-600 bg-accent-50/80 dark:bg-accent-950/40 border border-accent-200/50 dark:border-accent-800/40 px-2.5 py-0.5 rounded-full max-w-full">
                  <span className="truncate">&ldquo;{host.officeTopic}&rdquo;</span>
                </div>
              ) : null}
            </div>
          </div>

          {/* STATE 1: IDLE / PRE-KNOCK FORM */}
          {officeState === "idle" && (
            <div className="flex flex-col gap-5 sm:gap-6 max-w-lg mx-auto w-full animate-in fade-in duration-200">
              <div className="text-center flex flex-col gap-1">
                <h2 className="text-title-2-medium sm:text-title-3-semibold text-text-primary">
                  {isDoorBusy ? "Join the Drop-In Queue" : "Knock on the Door"}
                </h2>
                <p className="text-body-regular text-text-secondary">
                  {isDoorBusy
                    ? `${host.name} is currently speaking with someone. Knock to hold your place next in line.`
                    : `${host.name} is at their desk. Knock with a quick question to drop in.`}
                </p>
              </div>

              {errorMsg && (
                <div className="p-3.5 rounded-xl bg-destructive-50/30 border border-destructive-200 text-destructive-700 text-body-2-regular">
                  {errorMsg}
                </div>
              )}

              <form onSubmit={handleKnockSubmit} className="flex flex-col gap-4">
                <Input
                  label="Your Name"
                  placeholder="e.g. Alex Morgan"
                  value={guestName}
                  onChange={setGuestName}
                  isRequired
                />

                <Input
                  label="Your Email"
                  type="email"
                  placeholder="alex@company.com"
                  value={guestEmail}
                  onChange={setGuestEmail}
                  isRequired
                />

                <div className="flex flex-col gap-1">
                  <Textarea
                    label="What's on your mind?"
                    placeholder="e.g. Quick question regarding our pilot proposal..."
                    value={topic}
                    onChange={(val) => setTopic(val.slice(0, 140))}
                    rows={2}
                    isRequired
                  />
                  <span className="text-caption-2-medium text-text-tertiary text-end">
                    {topic.length}/140 chars
                  </span>
                </div>

                <Button
                  type="submit"
                  variant="primary"
                  size="medium"
                  disabled={isSubmitting || !guestName.trim() || !guestEmail.trim() || !topic.trim()}
                  className="w-full mt-1 min-h-[48px] justify-center text-body-medium font-semibold"
                >
                  {isSubmitting ? (
                    <div className="flex items-center gap-2">
                      <Spinner size="sm" />
                      <span>Knocking on desk...</span>
                    </div>
                  ) : (
                    <span>🚪 Knock on Door</span>
                  )}
                </Button>
              </form>
            </div>
          )}

          {/* STATE 2: ACTIVE 60-SECOND RINGING SCREEN */}
          {officeState === "ringing" && (
            <div className="flex flex-col items-center justify-center py-6 sm:py-10 px-2 sm:px-4 text-center gap-5 sm:gap-6 max-w-md mx-auto w-full animate-in fade-in duration-300">
              <div className="relative flex items-center justify-center size-20 sm:size-24 rounded-full bg-accent-50/80 dark:bg-accent-950/50 border border-accent-200 dark:border-accent-800">
                <span className="text-3xl sm:text-4xl animate-bounce">🔔</span>
                <div className="absolute inset-0 rounded-full border-2 border-accent-500 animate-ping opacity-25" />
              </div>

              <div className="flex flex-col gap-1 sm:gap-2">
                <h2 className="text-title-2-medium text-text-primary">
                  Ringing {host.name}&apos;s Desk...
                </h2>
                <p className="text-body-regular text-text-secondary">
                  Notifying {host.name} on their desktop and phone. Please keep this tab open.
                </p>
              </div>

              {/* Countdown Badge */}
              <div className="flex items-center gap-2 py-2 px-4 rounded-full bg-background-secondary-default border border-border-button-default">
                <span className="text-body-medium font-semibold text-accent-600">
                  00:{secondsRemaining < 10 ? `0${secondsRemaining}` : secondsRemaining}
                </span>
                <span className="text-caption-1-semibold text-text-tertiary">remaining</span>
              </div>

              <div className="w-full bg-background-secondary-default rounded-full h-2 overflow-hidden">
                <div
                  className="bg-accent-500 h-full transition-all duration-1000 ease-linear rounded-full"
                  style={{ width: `${(secondsRemaining / 60) * 100}%` }}
                />
              </div>

              <div className="pt-2 w-full">
                <Button
                  variant="secondary"
                  size="small"
                  onClick={handleCancelKnock}
                  className="w-full sm:w-auto justify-center min-h-[44px]"
                >
                  Cancel Knock
                </Button>
              </div>
            </div>
          )}

          {/* STATE 3: WAITING ROOM QUEUE */}
          {officeState === "queued" && (
            <div className="flex flex-col items-center justify-center py-6 sm:py-10 px-2 sm:px-4 text-center gap-5 sm:gap-6 max-w-md mx-auto w-full animate-in fade-in duration-300">
              <div className="relative flex items-center justify-center size-16 sm:size-20 rounded-full bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-600">
                <HugeClock className="size-8 sm:size-10" />
              </div>

              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-center gap-2">
                  <Chip color="yellow" variant="bold">
                    Queue Position #{queuePosition}
                  </Chip>
                </div>
                <h2 className="text-title-2-medium text-text-primary">
                  You&apos;re next in line
                </h2>
                <p className="text-body-regular text-text-secondary">
                  {host.name} is currently speaking with a visitor. Your spot is held and your knock will ring automatically as soon as their call wraps up.
                </p>
              </div>

              <div className="py-2.5 px-4 rounded-2xl bg-background-secondary-default border border-border-button-default text-caption-1-semibold text-text-secondary">
                Est. wait: ~{Math.max(1, queuePosition) * (host.officeSpeedChatMins || 10)} mins &bull; Keep this tab open
              </div>

              <div className="w-full">
                <Button
                  variant="secondary"
                  size="small"
                  onClick={handleCancelKnock}
                  className="w-full sm:w-auto justify-center min-h-[44px]"
                >
                  Leave Queue
                </Button>
              </div>
            </div>
          )}

          {/* STATE 4: ADMITTED / VIDEO CALL READY */}
          {officeState === "admitted" && meetLink && (
            <div className="flex flex-col items-center justify-center py-6 sm:py-10 px-2 sm:px-4 text-center gap-5 sm:gap-6 max-w-md mx-auto w-full animate-in zoom-in-95 duration-300">
              <div className="size-16 sm:size-20 rounded-full bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 flex items-center justify-center text-emerald-600">
                <HugeCheck className="size-8 sm:size-10" />
              </div>

              <div className="flex flex-col gap-1.5 sm:gap-2">
                <h2 className="text-title-1-medium text-text-primary">Door Opened!</h2>
                <p className="text-body-regular text-text-secondary">
                  {host.name} has admitted you. Click below to enter your video room.
                </p>
              </div>

              {/* Direct anchor link so mobile Safari / Chrome popup blockers never intercept */}
              <div className="flex flex-col gap-2.5 w-full">
                <a
                  href={meetLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-accent-600 hover:bg-accent-700 text-white py-3.5 px-5 text-body-medium font-semibold transition-all shadow-xs min-h-[48px] active:scale-[0.98]"
                >
                  <HugeVideo className="size-5" />
                  <span>Join Video Room</span>
                </a>

                <Button
                  variant="secondary"
                  size="small"
                  leadingIcon={copiedRoomLink ? HugeCheck : HugeCopy}
                  className="w-full justify-center min-h-[40px]"
                  onClick={handleCopyRoomLink}
                >
                  {copiedRoomLink ? "Room link copied!" : "Copy meeting link"}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
