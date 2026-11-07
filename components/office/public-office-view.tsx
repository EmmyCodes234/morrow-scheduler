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
  const [currentOfficeStatus, setCurrentOfficeStatus] = useState<string>(host.officeStatus || "closed");
  const [currentOfficeTopic, setCurrentOfficeTopic] = useState<string | null>(host.officeTopic || null);

  const isDoorClosedInitial = (host.officeStatus || "closed") === "closed";

  const [officeState, setOfficeState] = useState<"idle" | "queued" | "ringing" | "admitted" | "fallback">(
    isDoorClosedInitial ? "fallback" : "idle"
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

  const isDoorOpen = currentOfficeStatus === "open";
  const isDoorBusy = currentOfficeStatus === "busy";
  const isDoorClosed = currentOfficeStatus === "closed";

  const storageKey = `morrow_office_knock_${host.slug}`;

  // Session Recovery for Mobile: If guest locks screen, switches apps, or reloads
  useEffect(() => {
    if (typeof window === "undefined") return;

    try {
      const savedKnockId = sessionStorage.getItem(storageKey);
      if (savedKnockId && !activeKnockId) {
        fetch(`/api/office/knock/${savedKnockId}`)
          .then((res) => (res.ok ? res.json() : null))
          .then((data) => {
            if (data?.knock) {
              const k = data.knock;
              if (k.status === "admitted" && k.meetLink) {
                setActiveKnockId(k.id);
                setMeetLink(k.meetLink);
                setOfficeState("admitted");
              } else if (k.status === "ringing") {
                setActiveKnockId(k.id);
                setOfficeState("ringing");
              } else if (k.status === "queued") {
                setActiveKnockId(k.id);
                setQueuePosition(k.queuePosition || 1);
                setOfficeState("queued");
              } else {
                sessionStorage.removeItem(storageKey);
              }
            } else {
              sessionStorage.removeItem(storageKey);
            }
          })
          .catch(() => {
            sessionStorage.removeItem(storageKey);
          });
      }
    } catch {
      // sessionStorage might be disabled in private mode
    }
  }, [storageKey, activeKnockId]);

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
        try {
          sessionStorage.removeItem(storageKey);
        } catch {}
        setActiveKnockId(null);
        setOfficeState("fallback");
      } else if (event.type === "office.status_changed") {
        const nextStatus = event.payload.officeStatus || "closed";
        setCurrentOfficeStatus(nextStatus);
        if (event.payload.officeTopic !== undefined) {
          setCurrentOfficeTopic(event.payload.officeTopic);
        }

        if (nextStatus === "open" || nextStatus === "busy") {
          // If door was previously closed, reopen the front desk for visitors!
          if (officeState === "fallback" && !activeKnockId) {
            setOfficeState("idle");
          }
        } else if (nextStatus === "closed") {
          if (officeState === "idle") {
            setOfficeState("fallback");
          }
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
            try {
              sessionStorage.removeItem(storageKey);
            } catch {}
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
            try {
              sessionStorage.removeItem(storageKey);
            } catch {}
            setActiveKnockId(null);
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
  }, [officeState, activeKnockId, storageKey]);

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
        try {
          sessionStorage.setItem(storageKey, data.knock.id);
        } catch {}

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
    try {
      sessionStorage.removeItem(storageKey);
    } catch {}
    setOfficeState("idle");
    setActiveKnockId(null);
  };

  const handleCopyRoomLink = () => {
    if (!meetLink) return;
    navigator.clipboard.writeText(meetLink);
    setCopiedRoomLink(true);
    setTimeout(() => setCopiedRoomLink(false), 2000);
  };

  // Determine conference provider label
  const isMeet = meetLink?.includes("meet.google.com");
  const isZoom = meetLink?.includes("zoom.us");
  const isTeams = meetLink?.includes("teams.microsoft.com");
  const providerLabel = isZoom ? "Zoom" : isTeams ? "Microsoft Teams" : "Google Meet";

  return (
    <div className="w-full max-w-2xl mx-auto flex flex-col gap-4 sm:gap-6">
      {/* Top Header Bar: Clean branding and door presence */}
      <header className="flex items-center justify-between px-2 sm:px-3">
        <div className="flex items-center gap-2.5">
          <MorrowLogo className="h-5 sm:h-6 w-auto" />
          <span className="text-caption-1-medium text-text-tertiary">/</span>
          <span className="text-body-2-medium text-text-secondary font-medium">Virtual Office</span>
        </div>

        <div className="flex items-center gap-2">
          {isDoorOpen ? (
            <Chip color="lime" variant="bold" className="flex items-center gap-1.5 px-2.5 py-1">
              <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>Door Open</span>
            </Chip>
          ) : isDoorBusy ? (
            <Chip color="yellow" variant="bold" className="flex items-center gap-1.5 px-2.5 py-1">
              <span className="size-2 rounded-full bg-amber-500" />
              <span>In Meeting</span>
            </Chip>
          ) : (
            <Chip color="soft" variant="caption" className="flex items-center gap-1.5 px-2.5 py-1">
              <span className="size-2 rounded-full bg-zinc-400" />
              <span>Door Closed</span>
            </Chip>
          )}
        </div>
      </header>

      {/* STATE 5: FALLBACK / CALENDAR SCHEDULER (Single integrated experience) */}
      {officeState === "fallback" ? (
        <div className="flex flex-col gap-4 sm:gap-6 w-full animate-in fade-in duration-300">
          <div className="p-4 sm:p-5 rounded-3xl bg-background-primary-default border border-border-button-default shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className="size-10 rounded-2xl bg-accent-50 dark:bg-accent-950/40 border border-border-button-default flex items-center justify-center shrink-0">
                <HugeCalendar className="size-5 text-accent-600" />
              </div>
              <div className="flex flex-col min-w-0">
                <span className="text-body-medium font-semibold text-text-primary">
                  {isDoorClosed ? `${host.name}'s door is closed.` : `${host.name} stepped away.`}
                </span>
                <span className="text-caption-1-medium text-text-secondary">
                  Book a confirmed meeting on their calendar below to guarantee a call.
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
          <PublicBookingView
            host={{
              ...host,
              officeStatus: currentOfficeStatus,
              officeTopic: currentOfficeTopic,
            }}
            initialEventTypes={eventTypes}
            hideOfficeBanner={true}
          />
        </div>
      ) : (
        /* MAIN OFFICE CARD FOR IDLE, RINGING, QUEUED, & ADMITTED */
        <main className="rounded-3xl border border-border-button-default bg-background-primary-default p-5 sm:p-8 lg:p-10 shadow-sm flex flex-col gap-6">
          {/* Host Profile Hero: Clear, human, mobile-first */}
          <div className="flex flex-col gap-3.5 pb-5 border-b border-border-button-default">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3.5 min-w-0">
                <div className="relative shrink-0">
                  <Avatar size="lg" initials={hostInitials} src={host.avatarUrl || undefined} color="blue" />
                  <span
                    className={`absolute -bottom-0.5 -right-0.5 size-3.5 rounded-full border-2 border-background-primary-default ${
                      isDoorOpen ? "bg-emerald-500 animate-pulse" : isDoorBusy ? "bg-amber-500" : "bg-zinc-400"
                    }`}
                  />
                </div>
                <div className="flex flex-col min-w-0">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <h1 className="text-title-2-medium text-text-primary truncate">{host.name}</h1>
                    <HugeVerified className="size-4 text-accent-500 shrink-0" />
                  </div>
                  <span className="text-caption-1-medium text-text-secondary truncate">
                    {host.welcomeMessage || "Drop-in speed chats & office hours"}
                  </span>
                </div>
              </div>

              <div className="hidden sm:flex items-center gap-1.5 text-caption-1-semibold text-text-secondary bg-background-secondary-default border border-border-button-default px-3 py-1.5 rounded-full shrink-0">
                <HugeClock className="size-3.5 text-foreground-icon-secondary" />
                <span>{host.officeSpeedChatMins || 10} min max</span>
              </div>
            </div>

            {/* Discussion Topic Spotlight Banner */}
            {currentOfficeTopic ? (
              <div className="p-3 sm:p-3.5 rounded-2xl bg-accent-50/60 dark:bg-accent-950/40 border border-accent-200/60 dark:border-accent-800/50 flex items-start gap-2.5 text-start">
                <span className="text-base leading-none shrink-0 mt-0.5">💬</span>
                <div className="flex flex-col min-w-0">
                  <span className="text-caption-2-medium text-text-tertiary uppercase tracking-wider font-semibold">
                    Current Discussion Focus
                  </span>
                  <span className="text-body-2-medium text-text-primary font-medium">
                    &ldquo;{currentOfficeTopic}&rdquo;
                  </span>
                </div>
              </div>
            ) : null}
          </div>

          {/* STATE 1: IDLE / PRE-KNOCK FORM */}
          {officeState === "idle" && (
            <div className="flex flex-col gap-5 sm:gap-6 w-full animate-in fade-in duration-200">
              <div className="text-center sm:text-start flex flex-col gap-1">
                <h2 className="text-title-2-medium sm:text-title-3-semibold text-text-primary">
                  {isDoorBusy ? "Join the Live Queue" : "Ring the Desk"}
                </h2>
                <p className="text-body-regular text-text-secondary">
                  {isDoorBusy
                    ? `${host.name} is speaking with a visitor. Knock to secure your turn next.`
                    : `${host.name} is available now. Knock to drop in for a quick ${host.officeSpeedChatMins || 10}-min video chat.`}
                </p>
              </div>

              {errorMsg && (
                <div className="p-3.5 rounded-xl bg-destructive-50/40 border border-destructive-200 text-destructive-700 text-body-2-regular">
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
                    label="What would you like to discuss?"
                    placeholder="e.g. Quick feedback on our pilot integration proposal..."
                    value={topic}
                    onChange={(val) => setTopic(val.slice(0, 140))}
                    rows={2}
                    isRequired
                  />
                  <span className="text-caption-2-medium text-text-tertiary text-end">
                    {topic.length}/140 characters
                  </span>
                </div>

                <Button
                  type="submit"
                  variant="primary"
                  size="medium"
                  disabled={isSubmitting || !guestName.trim() || !guestEmail.trim() || !topic.trim()}
                  className="w-full mt-1 min-h-[48px] justify-center text-body-medium font-semibold active:scale-[0.99] transition-transform"
                >
                  {isSubmitting ? (
                    <div className="flex items-center gap-2">
                      <Spinner size="sm" />
                      <span>Ringing {host.name}...</span>
                    </div>
                  ) : isDoorBusy ? (
                    <span>Hold Place in Queue</span>
                  ) : (
                    <span>Knock on Door ({host.officeSpeedChatMins || 10}m)</span>
                  )}
                </Button>

                <p className="text-center text-caption-2-medium text-text-tertiary">
                  Free instant drop-in &bull; Connects directly via {host.defaultLocationType === "zoom" ? "Zoom" : host.defaultLocationType === "teams" ? "Teams" : "Google Meet"}
                </p>
              </form>
            </div>
          )}

          {/* STATE 2: ACTIVE 60-SECOND RINGING SCREEN */}
          {officeState === "ringing" && (
            <div className="flex flex-col items-center justify-center py-6 sm:py-8 px-2 text-center gap-5 sm:gap-6 max-w-md mx-auto w-full animate-in fade-in duration-300">
              {/* Concentric pulsing radar ring */}
              <div className="relative flex items-center justify-center size-20 sm:size-24 rounded-full bg-accent-50/90 dark:bg-accent-950/60 border border-accent-200 dark:border-accent-800">
                <span className="text-3xl sm:text-4xl animate-bounce">🔔</span>
                <div className="absolute inset-0 rounded-full border-2 border-accent-500 animate-ping opacity-30" />
              </div>

              <div className="flex flex-col gap-1 sm:gap-2">
                <h2 className="text-title-2-medium text-text-primary">
                  Ringing {host.name}&apos;s Desk...
                </h2>
                <p className="text-body-regular text-text-secondary">
                  Sending a live doorbell alert to {host.name}&apos;s devices. Please keep this screen open.
                </p>
              </div>

              {/* Countdown Progress */}
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
            <div className="flex flex-col items-center justify-center py-6 sm:py-8 px-2 text-center gap-5 sm:gap-6 max-w-md mx-auto w-full animate-in fade-in duration-300">
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
                  {host.name} is in a session right now. Your place is held and the desk will ring automatically the moment they finish.
                </p>
              </div>

              <div className="py-2.5 px-4 rounded-2xl bg-background-secondary-default border border-border-button-default text-caption-1-semibold text-text-secondary">
                Est. wait: ~{Math.max(1, queuePosition) * (host.officeSpeedChatMins || 10)} mins &bull; Keep tab open
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
            <div className="flex flex-col items-center justify-center py-6 sm:py-8 px-2 text-center gap-5 sm:gap-6 max-w-md mx-auto w-full animate-in zoom-in-95 duration-300">
              <div className="size-16 sm:size-20 rounded-full bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 flex items-center justify-center text-emerald-600">
                <HugeCheck className="size-8 sm:size-10" />
              </div>

              <div className="flex flex-col gap-1.5 sm:gap-2">
                <h2 className="text-title-1-medium text-text-primary">Door Opened!</h2>
                <p className="text-body-regular text-text-secondary">
                  {host.name} has admitted you. Tap below to enter your video room.
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
                  <span>Join {providerLabel} Call</span>
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

                <p className="text-caption-2-medium text-text-tertiary">
                  Opens in your browser or {providerLabel} app
                </p>
              </div>
            </div>
          )}
        </main>
      )}
    </div>
  );
}
