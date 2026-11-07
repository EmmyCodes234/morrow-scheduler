"use client";

import { useState, useEffect, useRef } from "react";
import { Avatar } from "@/components/base/avatar/avatar";
import { Badge } from "@/components/base/badges/badge";
import { Chip } from "@/components/base/badges/chip";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { Textarea } from "@/components/base/textarea/textarea";
import { Spinner } from "@/components/base/spinner/spinner";
import {
  HugeVerified,
  HugeClock,
  HugeVideo,
  HugeGlobe,
  HugeArrowLeft,
  HugeCheck,
  HugeCalendar,
} from "@/components/icons/hugeicons";
import { MorrowLogo } from "@/components/brand/morrow-logo";
import { playDoorKnock, playDoorbellChime } from "@/lib/audio/chime";
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

  // Status polling for queued and ringing knocks
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

    // Sound effect on click
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

  return (
    <div className="w-full max-w-4xl mx-auto flex flex-col gap-6">
      {/* Brand Header */}
      <div className="flex items-center justify-between px-2">
        <div className="flex items-center gap-2">
          <MorrowLogo className="h-6 w-auto" />
          <span className="text-body-2-regular text-text-tertiary">|</span>
          <span className="text-body-2-medium text-text-secondary">Office Hours</span>
        </div>

        <div className="flex items-center gap-2">
          {isDoorOpen ? (
            <Chip color="lime" variant="bold" className="animate-pulse">
              🟢 Door Open
            </Chip>
          ) : isDoorBusy ? (
            <Chip color="yellow" variant="bold">
              🟡 In a Call (Queue Open)
            </Chip>
          ) : (
            <Chip color="soft" variant="caption">
              🔴 Office Closed
            </Chip>
          )}
        </div>
      </div>

      {/* Main Card */}
      <div className="rounded-3xl border border-border-button-default bg-background-primary-default p-6 sm:p-10 shadow-sm flex flex-col gap-8">
        {/* Host Identity Hero */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-border-button-default">
          <div className="flex items-center gap-4">
            <Avatar size="lg" initials={hostInitials} src={host.avatarUrl || undefined} color="blue" />
            <div className="flex flex-col">
              <div className="flex items-center gap-1.5">
                <h1 className="text-title-2-medium text-text-primary">{host.name}</h1>
                <HugeVerified className="size-4 text-accent-500" />
              </div>
              <span className="text-body-2-regular text-text-secondary">
                usemorrow.xyz/{host.slug}/office
              </span>
            </div>
          </div>

          <div className="flex flex-col sm:items-end gap-1">
            <div className="flex items-center gap-1.5 text-body-2-regular text-text-secondary">
              <HugeClock className="size-4 text-foreground-icon-secondary" />
              <span>{host.officeSpeedChatMins || 10} min speed-chat</span>
            </div>
            {host.officeTopic ? (
              <span className="text-caption-1-semibold text-accent-600 bg-accent-50/80 px-2.5 py-0.5 rounded-full">
                &ldquo;{host.officeTopic}&rdquo;
              </span>
            ) : null}
          </div>
        </div>

        {/* STATE 1: IDLE / PRE-KNOCK FORM */}
        {officeState === "idle" && (
          <div className="flex flex-col gap-6 max-w-lg mx-auto w-full">
            <div className="text-center flex flex-col gap-1.5">
              <h2 className="text-title-3-semibold text-text-primary">
                {isDoorBusy ? "Join the Drop-In Queue" : "Knock on the Door"}
              </h2>
              <p className="text-body-regular text-text-secondary">
                {isDoorBusy
                  ? `${host.name} is currently speaking with someone. Knock to let them know you're next in line.`
                  : `${host.name} is at their desk. Knock with a quick question to drop in.`}
              </p>
            </div>

            {errorMsg && (
              <div className="p-3 rounded-xl bg-destructive-50/20 border border-destructive-200 text-destructive-700 text-body-2-regular">
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
                className="w-full mt-2"
              >
                {isSubmitting ? (
                  <div className="flex items-center gap-2">
                    <Spinner size="sm" />
                    <span>Knocking...</span>
                  </div>
                ) : (
                  <span>🚪 Knock on Door</span>
                )}
              </Button>
            </form>
          </div>
        )}

        {/* STATE: WAITING ROOM QUEUE */}
        {officeState === "queued" && (
          <div className="flex flex-col items-center justify-center py-10 px-4 text-center gap-6 max-w-md mx-auto w-full animate-in fade-in duration-300">
            <div className="relative flex items-center justify-center size-20 rounded-full bg-status-yellow-background border border-border-button-default text-status-yellow-text">
              <HugeClock className="size-10" />
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

            <div className="py-2 px-4 rounded-xl bg-background-secondary-default border border-border-button-default text-caption-1-semibold text-text-secondary">
              Est. wait: ~{Math.max(1, queuePosition) * (host.officeSpeedChatMins || 10)} mins • Please keep this tab open
            </div>

            <Button variant="secondary" size="small" onClick={handleCancelKnock}>
              Leave Queue
            </Button>
          </div>
        )}

        {/* STATE 2: ACTIVE 60-SECOND RINGING SCREEN */}
        {officeState === "ringing" && (
          <div className="flex flex-col items-center justify-center py-10 px-4 text-center gap-6 max-w-md mx-auto w-full">
            <div className="relative flex items-center justify-center size-24 rounded-full bg-accent-50/60 border border-accent-200">
              <span className="text-4xl animate-bounce">🔔</span>
              <div className="absolute inset-0 rounded-full border-2 border-accent-500 animate-ping opacity-25" />
            </div>

            <div className="flex flex-col gap-2">
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

            <div className="w-full bg-background-secondary-default rounded-full h-1.5 overflow-hidden">
              <div
                className="bg-accent-500 h-full transition-all duration-1000 ease-linear rounded-full"
                style={{ width: `${(secondsRemaining / 60) * 100}%` }}
              />
            </div>

            <div className="pt-2">
              <Button variant="secondary" size="small" onClick={handleCancelKnock}>
                Cancel Knock
              </Button>
            </div>
          </div>
        )}

        {/* STATE 3: ADMITTED / VIDEO CALL READY */}
        {officeState === "admitted" && meetLink && (
          <div className="flex flex-col items-center justify-center py-8 text-center gap-6 max-w-md mx-auto w-full">
            <div className="size-20 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600">
              <HugeCheck className="size-10" />
            </div>

            <div className="flex flex-col gap-2">
              <h2 className="text-title-1-medium text-text-primary">Door Opened!</h2>
              <p className="text-body-regular text-text-secondary">
                {host.name} has admitted you. Click below to join your video room.
              </p>
            </div>

            <Button
              variant="primary"
              size="medium"
              leadingIcon={HugeVideo}
              onClick={() => window.open(meetLink, "_blank")}
              className="w-full"
            >
              Join Video Room
            </Button>
          </div>
        )}

        {/* STATE 4: FALLBACK / CALENDAR SCHEDULER */}
        {officeState === "fallback" && (
          <div className="flex flex-col gap-8">
            <div className="p-4 sm:p-5 rounded-2xl bg-accent-50/30 border border-accent-200/60 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex flex-col gap-1">
                <span className="text-body-medium font-semibold text-text-primary">
                  {isDoorClosed ? `${host.name}'s door is currently closed.` : `${host.name} stepped away or is deep in flow.`}
                </span>
                <span className="text-body-2-regular text-text-secondary">
                  {topic
                    ? `Your note ("${topic}") has been sent to their inbox. Pick a slot below to guarantee a meeting.`
                    : "You can schedule a dedicated appointment on their calendar below."}
                </span>
              </div>

              {!isDoorClosed && (
                <Button variant="secondary" size="small" onClick={() => setOfficeState("idle")}>
                  Try Knocking Again
                </Button>
              )}
            </div>

            {/* Embedded Calendar Scheduler */}
            <div className="pt-2">
              <PublicBookingView host={host} initialEventTypes={eventTypes} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
