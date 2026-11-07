"use client";

import { useState } from "react";
import { Avatar } from "@/components/base/avatar/avatar";
import { Badge } from "@/components/base/badges/badge";
import { Chip, type ChipColor } from "@/components/base/badges/chip";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { Switch } from "@/components/base/switch/switch";
import {
  HugeClock,
  HugeVideo,
  HugeCheck,
  HugeCopy,
  HugeLink,
  HugeGlobe,
  HugeSettings,
  HugeSparkles,
} from "@/components/icons/hugeicons";
import { playDoorbellChime } from "@/lib/audio/chime";
import { type OfficeKnock } from "./doorbell-alert-modal";
import { cx } from "@/utils/cx";

interface HostOfficeViewProps {
  user: {
    id: string;
    name: string;
    email: string;
    slug: string;
    officeStatus?: "open" | "busy" | "closed";
    officeTopic?: string | null;
    officeSpeedChatMins?: number;
    officeNotifyEmail?: boolean;
    officeAutoSchedule?: boolean;
    officeScheduleDays?: number[] | null;
    officeScheduleStart?: string | null;
    officeScheduleEnd?: string | null;
    defaultLocationType?: string;
    zoomMeetingUrl?: string;
    teamsMeetingUrl?: string;
  };
  knocks: OfficeKnock[];
  onUpdateSettings: (settings: {
    officeStatus?: "open" | "busy" | "closed";
    officeTopic?: string;
    officeSpeedChatMins?: number;
    officeNotifyEmail?: boolean;
    officeAutoSchedule?: boolean;
    officeScheduleDays?: number[];
    officeScheduleStart?: string;
    officeScheduleEnd?: string;
  }) => Promise<void>;
  onAdmitKnock: (knockId: string) => Promise<string | null>;
  onDeclineKnock: (knockId: string) => Promise<void>;
}

export function HostOfficeView({
  user,
  knocks,
  onUpdateSettings,
  onAdmitKnock,
  onDeclineKnock,
}: HostOfficeViewProps) {
  const [status, setStatus] = useState<"open" | "busy" | "closed">(
    user.officeStatus || "closed"
  );
  const [speedChatMins, setSpeedChatMins] = useState<number>(
    user.officeSpeedChatMins || 10
  );
  const [topic, setTopic] = useState<string>(user.officeTopic || "");
  const [notifyEmail, setNotifyEmail] = useState<boolean>(
    user.officeNotifyEmail !== false
  );
  const [autoSchedule, setAutoSchedule] = useState<boolean>(
    user.officeAutoSchedule || false
  );
  const [scheduleDays, setScheduleDays] = useState<number[]>(
    user.officeScheduleDays || [1, 2, 3, 4, 5]
  );
  const [scheduleStart, setScheduleStart] = useState<string>(
    user.officeScheduleStart || "14:00"
  );
  const [scheduleEnd, setScheduleEnd] = useState<string>(
    user.officeScheduleEnd || "16:00"
  );

  const [isSaving, setIsSaving] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [testedAudio, setTestedAudio] = useState(false);

  const handleCopyLink = () => {
    const url = `https://usemorrow.xyz/${user.slug}/office`;
    navigator.clipboard.writeText(url);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const handleTestAudio = () => {
    playDoorbellChime();
    setTestedAudio(true);
    setTimeout(() => setTestedAudio(false), 2000);
  };

  const handleStatusChange = async (newStatus: "open" | "busy" | "closed") => {
    setStatus(newStatus);
    await onUpdateSettings({ officeStatus: newStatus });
  };

  const handleSaveSettings = async () => {
    setIsSaving(true);
    try {
      await onUpdateSettings({
        officeStatus: status,
        officeTopic: topic.trim(),
        officeSpeedChatMins: speedChatMins,
        officeNotifyEmail: notifyEmail,
        officeAutoSchedule: autoSchedule,
        officeScheduleDays: scheduleDays,
        officeScheduleStart: scheduleStart,
        officeScheduleEnd: scheduleEnd,
      });
    } finally {
      setIsSaving(false);
    }
  };

  const activeRingingKnocks = knocks.filter(
    (k) => k.status === "ringing" && (!k.isExpired || !k.expiresAt || new Date(k.expiresAt).getTime() > Date.now())
  );

  return (
    <div className="flex flex-col gap-8 w-full max-w-5xl">
      {/* 1. Header & Quick Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-border-button-default">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <h1 className="text-title-1-medium text-text-primary">Virtual Office Hours</h1>
            <Chip
              color={status === "open" ? "lime" : status === "busy" ? "yellow" : "soft"}
              variant="caption"
            >
              {status === "open" ? "Door Open" : status === "busy" ? "In Meeting" : "Door Closed"}
            </Chip>
          </div>
          <p className="text-body-regular text-text-secondary">
            Your live digital front desk for high-context drop-in speed chats.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <Button
            variant="secondary"
            leadingIcon={copiedLink ? HugeCheck : HugeCopy}
            onClick={handleCopyLink}
          >
            {copiedLink ? "Link copied" : "Copy office link"}
          </Button>

          <Button
            variant="ghost"
            leadingIcon={HugeGlobe}
            onClick={() => window.open(`/${user.slug}/office`, "_blank")}
          >
            Visit door
          </Button>
        </div>
      </div>

      {/* 2. Public Door URL Banner */}
      <div className="rounded-3xl border border-border-button-default bg-background-primary-default p-5 sm:p-6 shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4 min-w-0">
          <div className="size-11 rounded-2xl bg-accent-50 dark:bg-accent-950/40 border border-border-button-default flex items-center justify-center shrink-0">
            <HugeVideo className="size-5 text-accent-600" />
          </div>
          <div className="flex flex-col min-w-0">
            <div className="text-body-medium font-semibold text-text-primary">
              Public Door: https://usemorrow.xyz/{user.slug}/office
            </div>
            <div className="text-caption-1-semibold text-text-secondary truncate">
              Share in your social bio, email signature, or Slack status when holding office hours.
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Button variant="secondary" size="small" onClick={handleTestAudio}>
            {testedAudio ? "Playing chime..." : "Test doorbell audio"}
          </Button>
        </div>
      </div>

      {/* 3. Door Controls & Configuration */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Status & Speed-Chat Limit */}
        <div className="lg:col-span-2 rounded-3xl border border-border-button-default bg-background-primary-default p-6 shadow-xs flex flex-col gap-6">
          <div className="flex items-center justify-between">
            <h2 className="text-title-2-medium text-text-primary">Door Controls</h2>
            <Button
              variant="primary"
              size="small"
              disabled={isSaving}
              onClick={handleSaveSettings}
            >
              {isSaving ? "Saving..." : "Save changes"}
            </Button>
          </div>

          {/* Status Segmented Selector */}
          <div className="flex flex-col gap-2">
            <label className="text-body-medium font-medium text-text-primary">
              Door State
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {/* Option 1: Open */}
              <button
                type="button"
                onClick={() => handleStatusChange("open")}
                className={cx(
                  "p-4 rounded-2xl border text-start flex flex-col gap-1 transition-all cursor-pointer",
                  status === "open"
                    ? "border-status-lime-text bg-background-secondary-default ring-2 ring-status-lime-text/20"
                    : "border-border-button-default bg-background-primary-default hover:bg-background-secondary-hover"
                )}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="size-2.5 rounded-full bg-status-lime-text" />
                    <span className="text-body-medium font-semibold text-text-primary">Open</span>
                  </div>
                  {status === "open" && <HugeCheck className="size-4 text-status-lime-text" />}
                </div>
                <p className="text-caption-1-semibold text-text-secondary">
                  Accepts live knocks and rings your chime.
                </p>
              </button>

              {/* Option 2: Busy */}
              <button
                type="button"
                onClick={() => handleStatusChange("busy")}
                className={cx(
                  "p-4 rounded-2xl border text-start flex flex-col gap-1 transition-all cursor-pointer",
                  status === "busy"
                    ? "border-status-yellow-text bg-background-secondary-default ring-2 ring-status-yellow-text/20"
                    : "border-border-button-default bg-background-primary-default hover:bg-background-secondary-hover"
                )}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="size-2.5 rounded-full bg-status-yellow-text" />
                    <span className="text-body-medium font-semibold text-text-primary">Busy</span>
                  </div>
                  {status === "busy" && <HugeCheck className="size-4 text-status-yellow-text" />}
                </div>
                <p className="text-caption-1-semibold text-text-secondary">
                  Holds knocks in queue while in a private session.
                </p>
              </button>

              {/* Option 3: Closed */}
              <button
                type="button"
                onClick={() => handleStatusChange("closed")}
                className={cx(
                  "p-4 rounded-2xl border text-start flex flex-col gap-1 transition-all cursor-pointer",
                  status === "closed"
                    ? "border-border-button-default bg-background-secondary-default ring-2 ring-border-button-default/50"
                    : "border-border-button-default bg-background-primary-default hover:bg-background-secondary-hover"
                )}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="size-2.5 rounded-full bg-text-tertiary" />
                    <span className="text-body-medium font-semibold text-text-primary">Closed</span>
                  </div>
                  {status === "closed" && <HugeCheck className="size-4 text-text-secondary" />}
                </div>
                <p className="text-caption-1-semibold text-text-secondary">
                  Door shut. Visitors fall back to your calendar.
                </p>
              </button>
            </div>
          </div>

          {/* Speed-Chat Duration Presets */}
          <div className="flex flex-col gap-2">
            <label className="text-body-medium font-medium text-text-primary">
              Speed-Chat Duration
            </label>
            <p className="text-caption-1-semibold text-text-secondary">
              Morrow automatically warns you at 1 minute remaining to keep sessions brisk.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-1">
              {[5, 10, 15, 20].map((mins) => (
                <button
                  key={mins}
                  type="button"
                  onClick={() => setSpeedChatMins(mins)}
                  className={cx(
                    "py-2.5 px-3 rounded-xl text-body-medium font-medium border text-center transition-all cursor-pointer min-h-[44px] flex items-center justify-center",
                    speedChatMins === mins
                      ? "bg-accent-600 text-white border-transparent shadow-xs"
                      : "bg-background-secondary-default text-text-primary border-border-button-default hover:bg-background-secondary-hover"
                  )}
                >
                  {mins} minutes
                </button>
              ))}
            </div>
          </div>

          {/* Discussion Topic / Banner Prompt */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <label className="text-body-medium font-medium text-text-primary">
                Today&apos;s Topic or Discussion Prompt
              </label>
              <span className="text-caption-1-semibold text-text-tertiary">
                {topic.length}/140 chars
              </span>
            </div>
            <Input
              value={topic}
              onChange={(val) => setTopic(val.slice(0, 140))}
              placeholder="e.g. AMA on AI Agents, Seed Fundraising, or Architecture Reviews"
            />
            <p className="text-caption-1-semibold text-text-secondary">
              Shown to visitors on your office door before they knock.
            </p>
          </div>

          {/* Email Notification Toggle */}
          <div className="pt-4 border-t border-border-button-default flex items-center justify-between">
            <div className="flex flex-col gap-0.5">
              <span className="text-body-medium font-medium text-text-primary">
                Email Doorbell Alerts
              </span>
              <span className="text-caption-1-semibold text-text-secondary">
                Receive an instant email notification with a direct link to admit visitors.
              </span>
            </div>
            <Switch
              isSelected={notifyEmail}
              onChange={setNotifyEmail}
              aria-label="Email Doorbell Alerts"
            />
          </div>

          {/* Automated Recurring Schedule */}
          <div className="pt-4 border-t border-border-button-default flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div className="flex flex-col gap-0.5">
                <span className="text-body-medium font-medium text-text-primary">
                  Automate Office Hours Schedule
                </span>
                <span className="text-caption-1-semibold text-text-secondary">
                  Automatically open your door during scheduled hours and close it afterwards.
                </span>
              </div>
              <Switch
                isSelected={autoSchedule}
                onChange={setAutoSchedule}
                aria-label="Automate Office Hours Schedule"
              />
            </div>

            {autoSchedule && (
              <div className="p-4 rounded-2xl bg-background-secondary-default border border-border-button-default flex flex-col gap-4 animate-in fade-in slide-in-from-top-1">
                {/* Days of week selector */}
                <div className="flex flex-col gap-1.5">
                  <span className="text-caption-1-semibold text-text-primary">Active Days</span>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {[
                      { day: 1, label: "Mon" },
                      { day: 2, label: "Tue" },
                      { day: 3, label: "Wed" },
                      { day: 4, label: "Thu" },
                      { day: 5, label: "Fri" },
                      { day: 6, label: "Sat" },
                      { day: 0, label: "Sun" },
                    ].map(({ day, label }) => {
                      const isSelected = scheduleDays.includes(day);
                      return (
                        <button
                          key={day}
                          type="button"
                          onClick={() => {
                            setScheduleDays((prev) =>
                              isSelected ? prev.filter((d) => d !== day) : [...prev, day]
                            );
                          }}
                          className={cx(
                            "px-3 py-1.5 rounded-xl text-caption-1-semibold border transition-all cursor-pointer",
                            isSelected
                              ? "bg-accent-600 text-white border-transparent"
                              : "bg-background-primary-default text-text-secondary border-border-button-default hover:bg-background-secondary-hover"
                          )}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Hours selector */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1">
                    <span className="text-caption-1-semibold text-text-secondary">Opens at</span>
                    <Input
                      type="time"
                      value={scheduleStart}
                      onChange={(val) => setScheduleStart(val)}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-caption-1-semibold text-text-secondary">Closes at</span>
                    <Input
                      type="time"
                      value={scheduleEnd}
                      onChange={(val) => setScheduleEnd(val)}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Tips & Active Destination */}
        <div className="rounded-3xl border border-border-button-default bg-background-primary-default p-6 shadow-xs flex flex-col gap-6">
          <h2 className="text-title-2-medium text-text-primary">Meeting Room</h2>

          <div className="p-4 rounded-2xl bg-background-secondary-default border border-border-button-default flex flex-col gap-2.5">
            <div className="text-caption-1-semibold text-text-tertiary uppercase tracking-wider">
              Connected Video Provider
            </div>
            <div className="flex items-center gap-2 text-body-medium font-semibold text-text-primary">
              <HugeVideo className="size-4 text-accent-600" />
              <span>
                {user.defaultLocationType === "zoom"
                  ? "Zoom Meeting"
                  : user.defaultLocationType === "teams"
                  ? "Microsoft Teams"
                  : "Google Meet"}
              </span>
            </div>
            <p className="text-caption-1-semibold text-text-secondary">
              When you admit a guest, both of you are connected directly in your meeting room.
            </p>
          </div>

          <div className="flex flex-col gap-3">
            <div className="text-body-medium font-semibold text-text-primary">
              How office hours work
            </div>
            <ul className="text-caption-1-semibold text-text-secondary flex flex-col gap-2 list-disc list-inside">
              <li>Visitors ring your doorbell with a short topic note.</li>
              <li>You have 60 seconds to review and admit them into your meeting room.</li>
              <li>Unanswered knocks automatically let visitors pick a time on your calendar.</li>
            </ul>
          </div>
        </div>
      </div>

      {/* 4. Live Knock Activity Log */}
      <div className="rounded-3xl border border-border-button-default bg-background-primary-default p-6 shadow-xs flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <h2 className="text-title-2-medium text-text-primary">Visitor Activity</h2>
            <Chip color="soft" variant="caption">
              {knocks.length} total knocks
            </Chip>
          </div>
        </div>

        {knocks.length === 0 ? (
          <div className="py-12 flex flex-col items-center justify-center text-center gap-2 border border-dashed border-border-button-default rounded-2xl">
            <HugeClock className="size-8 text-text-tertiary" />
            <div className="text-body-medium font-semibold text-text-primary">
              No knocks yet today
            </div>
            <p className="text-caption-1-semibold text-text-secondary max-w-sm">
              Keep your door open and share your link. When visitors ring your doorbell, they will appear here in real time.
            </p>
          </div>
        ) : (
          <div className="flex flex-col divide-y divide-border-button-default">
            {knocks.map((k) => {
              const guestInitials = k.guestName
                ? k.guestName
                    .split(" ")
                    .filter(Boolean)
                    .map((n) => n[0])
                    .join("")
                    .slice(0, 2)
                    .toUpperCase()
                : "G";

              const statusColorMap: Record<string, ChipColor> = {
                ringing: "yellow",
                queued: "yellow",
                admitted: "lime",
                concluded: "soft",
                missed: "orange",
                declined: "rose",
                cancelled: "soft",
              };

              const isRinging =
                k.status === "ringing" &&
                (!k.isExpired || !k.expiresAt || new Date(k.expiresAt).getTime() > Date.now());

              return (
                <div
                  key={k.id}
                  className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <Avatar
                      size="md"
                      initials={guestInitials}
                      src={k.guestAvatarUrl || undefined}
                    />
                    <div className="flex flex-col min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-body-medium font-semibold text-text-primary truncate">
                          {k.guestName}
                        </span>
                        <Chip
                          color={statusColorMap[k.status] || "soft"}
                          variant="caption"
                        >
                          {k.status === "queued" ? `In queue (#${k.queuePosition || 1})` : k.status}
                        </Chip>
                      </div>
                      <span className="text-caption-1-semibold text-text-secondary truncate">
                        {k.guestEmail}
                      </span>
                      <p className="text-body-medium text-text-primary pt-1">
                        &ldquo;{k.topic}&rdquo;
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                    <span className="text-caption-1-semibold text-text-tertiary">
                      {new Date(k.createdAt).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>

                    {isRinging && (
                      <>
                        <Button
                          variant="secondary"
                          size="small"
                          onClick={() => onDeclineKnock(k.id)}
                        >
                          Pass
                        </Button>
                        <Button
                          variant="primary"
                          size="small"
                          leadingIcon={HugeVideo}
                          onClick={async () => {
                            const link = await onAdmitKnock(k.id);
                            if (link) window.open(link, "_blank");
                          }}
                        >
                          Admit
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
