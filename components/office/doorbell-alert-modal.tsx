"use client";

import { useState, useEffect, useRef } from "react";
import { Avatar } from "@/components/base/avatar/avatar";
import { Badge } from "@/components/base/badges/badge";
import { Chip } from "@/components/base/badges/chip";
import { Button } from "@/components/base/buttons/button";
import {
  HugeClock,
  HugeVideo,
  HugeCheck,
  HugeClose,
  HugeAlert,
  HugeVerified,
} from "@/components/icons/hugeicons";
import { playDoorbellChime, playTimerWarningChime } from "@/lib/audio/chime";
import { cx } from "@/utils/cx";

export interface OfficeKnock {
  id: string;
  guestName: string;
  guestEmail: string;
  guestAvatarUrl?: string | null;
  topic: string;
  status: "ringing" | "admitted" | "declined" | "missed" | "cancelled" | "concluded" | "queued";
  queuePosition?: number | null;
  meetLink?: string | null;
  admittedAt?: string | null;
  createdAt: string;
  expiresAt?: string;
  isExpired?: boolean;
}

interface DoorbellAlertModalProps {
  knocks: OfficeKnock[];
  hostSpeedChatMins?: number;
  onAdmit: (knockId: string) => Promise<string | null>; // Returns meetLink
  onDecline: (knockId: string) => Promise<void>;
  onConclude: (knockId: string) => Promise<void>;
}

export function DoorbellAlertModal({
  knocks,
  hostSpeedChatMins = 10,
  onAdmit,
  onDecline,
  onConclude,
}: DoorbellAlertModalProps) {
  // Find current ringing knock (unexpired)
  const ringingKnock = knocks.find(
    (k) => k.status === "ringing" && (!k.isExpired || !k.expiresAt || new Date(k.expiresAt).getTime() > Date.now())
  );

  // Find currently active admitted knock
  const admittedKnock = knocks.find((k) => k.status === "admitted");

  // Count knocks waiting in queue
  const queuedKnocksCount = knocks.filter((k) => k.status === "queued").length;

  // Countdown timer for ringing knock (60s)
  const [secondsRemaining, setSecondsRemaining] = useState<number>(60);
  const [isAdmitting, setIsAdmitting] = useState(false);
  const [isDeclining, setIsDeclining] = useState(false);

  // Active chat session elapsed timer
  const [chatElapsedSeconds, setChatElapsedSeconds] = useState<number>(0);
  const [isConcluding, setIsConcluding] = useState(false);
  const warningChimePlayedRef = useRef<boolean>(false);

  // Track original document title
  const originalTitleRef = useRef<string>("");

  useEffect(() => {
    if (typeof document !== "undefined") {
      originalTitleRef.current = document.title;
    }
  }, []);

  // Handle ringing knock countdown & audio chime + tab pulsing
  useEffect(() => {
    if (!ringingKnock) {
      if (typeof document !== "undefined" && originalTitleRef.current) {
        document.title = originalTitleRef.current;
      }
      return;
    }

    // Play chime on arrival
    playDoorbellChime();

    // Calculate initial seconds remaining based on createdAt
    const createdAtMs = new Date(ringingKnock.createdAt).getTime();
    const initialElapsed = Math.floor((Date.now() - createdAtMs) / 1000);
    const initialRemaining = Math.max(0, 60 - initialElapsed);
    setSecondsRemaining(initialRemaining);

    // Flash tab title
    let titleToggle = false;
    const titleInterval = setInterval(() => {
      if (typeof document !== "undefined") {
        document.title = titleToggle
          ? `🔔 Knock from ${ringingKnock.guestName}!`
          : `(1) New Visitor — Morrow`;
        titleToggle = !titleToggle;
      }
    }, 1000);

    // Countdown ticker
    const timerInterval = setInterval(() => {
      setSecondsRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(timerInterval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      clearInterval(titleInterval);
      clearInterval(timerInterval);
      if (typeof document !== "undefined" && originalTitleRef.current) {
        document.title = originalTitleRef.current;
      }
    };
  }, [ringingKnock?.id]);

  // Handle active admitted chat session timer
  useEffect(() => {
    if (!admittedKnock || !admittedKnock.admittedAt) {
      setChatElapsedSeconds(0);
      warningChimePlayedRef.current = false;
      return;
    }

    const admittedAtMs = new Date(admittedKnock.admittedAt).getTime();
    const updateElapsed = () => {
      const elapsed = Math.max(0, Math.floor((Date.now() - admittedAtMs) / 1000));
      setChatElapsedSeconds(elapsed);

      // 1 minute warning
      const totalSeconds = hostSpeedChatMins * 60;
      if (totalSeconds - elapsed <= 60 && totalSeconds - elapsed > 0 && !warningChimePlayedRef.current) {
        warningChimePlayedRef.current = true;
        playTimerWarningChime();
      }
    };

    updateElapsed();
    const interval = setInterval(updateElapsed, 1000);

    return () => clearInterval(interval);
  }, [admittedKnock?.id, admittedKnock?.admittedAt, hostSpeedChatMins]);

  // Handler for host clicking Admit
  const handleAdmit = async () => {
    if (!ringingKnock || isAdmitting) return;
    setIsAdmitting(true);
    try {
      const meetLink = await onAdmit(ringingKnock.id);
      if (meetLink) {
        window.open(meetLink, "_blank");
      }
    } finally {
      setIsAdmitting(false);
    }
  };

  // Handler for host clicking Pass / Decline
  const handleDecline = async () => {
    if (!ringingKnock || isDeclining) return;
    setIsDeclining(true);
    try {
      await onDecline(ringingKnock.id);
    } finally {
      setIsDeclining(false);
    }
  };

  // Handler for concluding active speed chat
  const handleConclude = async () => {
    if (!admittedKnock || isConcluding) return;
    setIsConcluding(true);
    try {
      await onConclude(admittedKnock.id);
    } finally {
      setIsConcluding(false);
    }
  };

  const guestInitials = ringingKnock?.guestName
    ? ringingKnock.guestName
        .split(" ")
        .filter(Boolean)
        .map((n) => n[0])
        .join("")
        .slice(0, 2)
        .toUpperCase()
    : "G";

  const admittedInitials = admittedKnock?.guestName
    ? admittedKnock.guestName
        .split(" ")
        .filter(Boolean)
        .map((n) => n[0])
        .join("")
        .slice(0, 2)
        .toUpperCase()
    : "G";

  // Active chat duration calculations
  const totalChatSeconds = hostSpeedChatMins * 60;
  const chatSecondsLeft = Math.max(0, totalChatSeconds - chatElapsedSeconds);
  const chatMinsLeft = Math.floor(chatSecondsLeft / 60);
  const chatSecsLeft = chatSecondsLeft % 60;
  const isOvertime = chatElapsedSeconds > totalChatSeconds;
  const isOneMinWarning = chatSecondsLeft <= 60 && !isOvertime;

  return (
    <>
      {/* ========================================================================= */}
      {/* 1. RINGING DOORBELL POPUP MODAL (When visitor knocks)                      */}
      {/* ========================================================================= */}
      {ringingKnock && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200"
        >
          <div className="relative w-full max-w-lg rounded-3xl border border-border-button-default bg-background-primary-default p-6 shadow-2xl flex flex-col gap-5 animate-in zoom-in-95 duration-200">
            {/* Header: Pulsing Bell & Ringing Status */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className="relative flex size-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-status-lime-text opacity-75" />
                  <span className="relative inline-flex rounded-full size-3 bg-status-lime-text" />
                </span>
                <span className="text-body-medium font-semibold text-text-primary tracking-tight">
                  Doorbell Ringing
                </span>
              </div>

              <Chip color="yellow" variant="caption">
                {secondsRemaining}s remaining
              </Chip>
            </div>

            {/* Countdown Progress Bar */}
            <div className="w-full bg-background-secondary-default h-1.5 rounded-full overflow-hidden">
              <div
                className="bg-accent-600 h-full transition-all duration-1000 ease-linear rounded-full"
                style={{ width: `${(secondsRemaining / 60) * 100}%` }}
              />
            </div>

            {/* Visitor Card */}
            <div className="p-4 rounded-2xl bg-background-secondary-default border border-border-button-default flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <Avatar
                  size="md"
                  initials={guestInitials}
                  src={ringingKnock.guestAvatarUrl || undefined}
                />
                <div className="flex flex-col min-w-0">
                  <div className="text-body-medium font-semibold text-text-primary truncate">
                    {ringingKnock.guestName}
                  </div>
                  <div className="text-caption-1-semibold text-text-secondary truncate">
                    {ringingKnock.guestEmail}
                  </div>
                </div>
              </div>

              {/* Topic Screening */}
              <div className="pt-2 border-t border-border-button-default/60">
                <div className="text-caption-1-semibold text-text-tertiary uppercase tracking-wider mb-1">
                  What they want to discuss
                </div>
                <div className="text-body-medium text-text-primary bg-background-primary-default p-3 rounded-xl border border-border-button-default">
                  &ldquo;{ringingKnock.topic}&rdquo;
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-col sm:flex-row items-center gap-3 pt-1">
              <Button
                variant="secondary"
                className="w-full sm:w-1/3"
                disabled={isDeclining || isAdmitting}
                onClick={handleDecline}
              >
                Send to calendar
              </Button>

              <Button
                variant="primary"
                className="w-full sm:w-2/3"
                leadingIcon={HugeVideo}
                disabled={isAdmitting || isDeclining}
                onClick={handleAdmit}
              >
                {isAdmitting ? "Opening room..." : "Admit into call"}
              </Button>
            </div>

            <p className="text-center text-caption-1-semibold text-text-tertiary">
              Admitting opens your meeting room in a new tab.
            </p>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 2. ACTIVE SPEED-CHAT HUD (Persistent floating bar while meeting)          */}
      {/* ========================================================================= */}
      {admittedKnock && (
        <aside
          aria-label="Active drop-in speed chat session"
          className="fixed bottom-6 right-6 z-40 rounded-2xl border border-border-button-default bg-background-primary-default p-4 shadow-2xl flex flex-col sm:flex-row items-start sm:items-center gap-4 animate-in slide-in-from-bottom-5 duration-300 max-w-md w-full"
        >
          {/* Guest and Status */}
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className="relative shrink-0">
              <Avatar
                size="sm"
                initials={admittedInitials}
                src={admittedKnock.guestAvatarUrl || undefined}
              />
              <span className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full bg-status-lime-text border-2 border-background-primary-default" />
            </div>

            <div className="flex flex-col min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-body-medium font-semibold text-text-primary truncate">
                  {admittedKnock.guestName}
                </span>
                <Chip
                  color={isOvertime ? "rose" : isOneMinWarning ? "yellow" : "lime"}
                  variant="caption"
                >
                  {isOvertime
                    ? "Overtime"
                    : `${chatMinsLeft}:${chatSecsLeft.toString().padStart(2, "0")} left`}
                </Chip>
                {queuedKnocksCount > 0 && (
                  <Chip color="yellow" variant="caption">
                    +{queuedKnocksCount} in queue
                  </Chip>
                )}
              </div>
              <div className="text-caption-1-semibold text-text-secondary truncate">
                {admittedKnock.topic}
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto justify-end">
            {admittedKnock.meetLink && (
              <Button
                variant="secondary"
                size="small"
                leadingIcon={HugeVideo}
                onClick={() => window.open(admittedKnock.meetLink!, "_blank")}
              >
                Reopen room
              </Button>
            )}

            <Button
              variant="primary"
              size="small"
              disabled={isConcluding}
              onClick={handleConclude}
            >
              {isConcluding
                ? "Wrapping up..."
                : queuedKnocksCount > 0
                ? "Conclude & Call Next"
                : "Conclude chat"}
            </Button>
          </div>
        </aside>
      )}
    </>
  );
}
