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
    <div className="flex flex-col gap-6 sm:gap-8 w-full max-w-5xl">
      {/* 1. Header & Quick Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 sm:pb-6 border-b border-border-button-default">
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

        <div className="grid grid-cols-2 sm:flex sm:items-center gap-2.5 w-full sm:w-auto">
          <Button
            variant="secondary"
            className="w-full sm:w-auto justify-center"
            leadingIcon={copiedLink ? HugeCheck : HugeCopy}
            onClick={handleCopyLink}
          >
            {copiedLink ? "Link copied" : "Copy door link"}
          </Button>

          <Button
            variant="ghost"
            className="w-full sm:w-auto justify-center"
            leadingIcon={HugeGlobe}
            onClick={() => window.open(`/${user.slug}/office`, "_blank")}
          >
            Visit door
          </Button>
        </div>
      </div>

      {/* 2. Public Door URL Banner */}
      <div className="rounded-3xl border border-border-button-default bg-background-primary-default p-4 sm:p-6 shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4">
        <div className="flex items-center gap-3 sm:gap-4 min-w-0 w-full sm:w-auto">
          <div className="size-10 sm:size-11 rounded-2xl bg-accent-50 dark:bg-accent-950/40 border border-border-button-default flex items-center justify-center shrink-0">
            <HugeVideo className="size-5 text-accent-600" />
          </div>
          <div className="flex flex-col min-w-0 flex-1">
            <div className="text-body-medium font-semibold text-text-primary truncate">
              usemorrow.xyz/{user.slug}/office
            </div>
            <div className="text-caption-1-semibold text-text-secondary truncate">
              Share in your social bio or Slack status for live speed chats
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto justify-between sm:justify-end pt-2 sm:pt-0 border-t sm:border-t-0 border-border-button-default/40">
          <Button variant="secondary" size="small" className="w-full sm:w-auto justify-center" onClick={handleTestAudio}>
            {testedAudio ? "Chime playing..." : "Test doorbell audio"}
          </Button>
        </div>
      </div>

      {/* 3. Door Controls & Configuration */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Status & Speed-Chat Limit */}
        <div className="lg:col-span-2 rounded-3xl border border-border-button-default bg-background-primary-default p-5 sm:p-6 shadow-xs flex flex-col gap-6">
          <div className="flex items-center justify-between pb-3 sm:pb-0 border-b sm:border-b-0 border-border-button-default">
            <h2 className="text-title-2-medium text-text-primary">Door Controls</h2>
            <Button
              variant="primary"
              size="small"
              disabled={isSaving}
              onClick={handleSaveSettings}
              className="hidden sm:inline-flex"
            >
              {isSaving ? "Saving..." : "Save changes"}
            </Button>
          </div>

          {/* Status Selector: Mobile 3-way Segmented Control + Desktop Cards */}
          <div className="flex flex-col gap-2">
            <label className="text-body-medium font-medium text-text-primary">
              Door State
            </label>

            {/* Mobile Segmented Bar (< sm) */}
            <div className="grid grid-cols-3 p-1 rounded-2xl bg-background-secondary-default border border-border-button-default sm:hidden select-none">
              <button
                type="button"
                onClick={() => handleStatusChange("open")}
                className={cx(
                  "flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-caption-1-semibold transition-all cursor-pointer min-h-[44px]",
                  status === "open"
                    ? "bg-background-primary-default text-text-primary shadow-2xs font-bold ring-1 ring-border-button-default"
                    : "text-text-secondary hover:text-text-primary"
                )}
              >
                <span className="size-2 rounded-full bg-status-lime-text" />
                <span>Open</span>
              </button>

              <button
                type="button"
                onClick={() => handleStatusChange("busy")}
                className={cx(
                  "flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-caption-1-semibold transition-all cursor-pointer min-h-[44px]",
                  status === "busy"
                    ? "bg-background-primary-default text-text-primary shadow-2xs font-bold ring-1 ring-border-button-default"
                    : "text-text-secondary hover:text-text-primary"
                )}
              >
                <span className="size-2 rounded-full bg-status-yellow-text" />
                <span>Busy</span>
              </button>

              <button
                type="button"
                onClick={() => handleStatusChange("closed")}
                className={cx(
                  "flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-caption-1-semibold transition-all cursor-pointer min-h-[44px]",
                  status === "closed"
                    ? "bg-background-primary-default text-text-primary shadow-2xs font-bold ring-1 ring-border-button-default"
                    : "text-text-secondary hover:text-text-primary"
                )}
              >
                <span className="size-2 rounded-full bg-text-tertiary" />
                <span>Closed</span>
              </button>
            </div>

            {/* Mobile State Sub-Description Banner */}
            <div className="sm:hidden px-3.5 py-2 rounded-xl bg-background-secondary-default text-caption-1-medium text-text-secondary flex items-center gap-2">
              <span className={cx(
                "size-2 rounded-full shrink-0",
                status === "open" ? "bg-status-lime-text animate-pulse" : status === "busy" ? "bg-status-yellow-text" : "bg-text-tertiary"
              )} />
              <span>
                {status === "open"
                  ? "Live knocks enabled. Doorbell rings when visitors arrive."
                  : status === "busy"
                  ? "Visitor knocks are held in queue while you are in session."
                  : "Door shut. Visitors fall back to your calendar."}
              </span>
            </div>

            {/* Desktop Option Cards (>= sm) */}
            <div className="hidden sm:grid sm:grid-cols-3 gap-3">
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
            <div className="flex items-center justify-between">
              <label className="text-body-medium font-medium text-text-primary">
                Speed-Chat Duration
              </label>
              <span className="text-caption-1-semibold text-accent-600">
                {speedChatMins} min limit
              </span>
            </div>
            <p className="text-caption-1-semibold text-text-secondary">
              Morrow automatically warns you at 1 minute remaining to keep sessions brisk.
            </p>
            <div className="grid grid-cols-4 gap-2 pt-1">
              {[5, 10, 15, 20].map((mins) => (
                <button
                  key={mins}
                  type="button"
                  onClick={() => setSpeedChatMins(mins)}
                  className={cx(
                    "py-2.5 px-2 rounded-xl text-body-medium font-semibold border text-center transition-all cursor-pointer min-h-[44px] flex items-center justify-center",
                    speedChatMins === mins
                      ? "bg-accent-600 text-white border-transparent shadow-xs scale-[1.02]"
                      : "bg-background-secondary-default text-text-primary border-border-button-default hover:bg-background-secondary-hover"
                  )}
                >
                  <span className="sm:hidden">{mins}m</span>
                  <span className="hidden sm:inline">{mins} mins</span>
                </button>
              ))}
            </div>
          </div>

          {/* Discussion Topic / Banner Prompt */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <label className="text-body-medium font-medium text-text-primary">
                Discussion Topic
              </label>
              <span className="text-caption-1-semibold text-text-tertiary">
                {topic.length}/140
              </span>
            </div>
            <Input
              value={topic}
              onChange={(val) => setTopic(val.slice(0, 140))}
              placeholder="e.g. AMA on AI Agents, Seed Fundraising, or Architecture Reviews"
            />
            <p className="text-caption-1-semibold text-text-secondary">
              Displayed on your digital office door before visitors knock.
            </p>
          </div>

          {/* Email Notification Toggle */}
          <div className="pt-4 border-t border-border-button-default flex items-center justify-between gap-3">
            <div className="flex flex-col gap-0.5 min-w-0">
              <span className="text-body-medium font-medium text-text-primary">
                Email Doorbell Alerts
              </span>
              <span className="text-caption-1-semibold text-text-secondary">
                Receive instant emails with 1-click links to admit visitors.
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
            <div className="flex items-center justify-between gap-3">
              <div className="flex flex-col gap-0.5 min-w-0">
                <span className="text-body-medium font-medium text-text-primary">
                  Automate Office Schedule
                </span>
                <span className="text-caption-1-semibold text-text-secondary">
                  Automatically open and close your door on schedule.
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
                  <div className="grid grid-cols-7 gap-1.5 sm:flex sm:items-center sm:gap-2">
                    {[
                      { day: 1, label: "M", fullLabel: "Mon" },
                      { day: 2, label: "T", fullLabel: "Tue" },
                      { day: 3, label: "W", fullLabel: "Wed" },
                      { day: 4, label: "T", fullLabel: "Thu" },
                      { day: 5, label: "F", fullLabel: "Fri" },
                      { day: 6, label: "S", fullLabel: "Sat" },
                      { day: 0, label: "S", fullLabel: "Sun" },
                    ].map(({ day, label, fullLabel }) => {
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
                            "h-10 sm:h-auto sm:px-3 sm:py-1.5 rounded-xl text-caption-1-semibold border transition-all cursor-pointer flex items-center justify-center min-w-[36px]",
                            isSelected
                              ? "bg-accent-600 text-white border-transparent shadow-xs"
                              : "bg-background-primary-default text-text-secondary border-border-button-default hover:bg-background-secondary-hover"
                          )}
                        >
                          <span className="sm:hidden">{label}</span>
                          <span className="hidden sm:inline">{fullLabel}</span>
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

          {/* Full-width mobile save changes button */}
          <Button
            variant="primary"
            size="medium"
            disabled={isSaving}
            onClick={handleSaveSettings}
            className="w-full sm:hidden min-h-[48px] justify-center mt-2 shadow-xs"
          >
            {isSaving ? "Saving..." : "Save changes"}
          </Button>
        </div>

        {/* Right Column: Tips & Active Destination */}
        <div className="rounded-3xl border border-border-button-default bg-background-primary-default p-5 sm:p-6 shadow-xs flex flex-col gap-6">
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
      <div className="rounded-3xl border border-border-button-default bg-background-primary-default p-5 sm:p-6 shadow-xs flex flex-col gap-5 sm:gap-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <h2 className="text-title-2-medium text-text-primary">Visitor Activity</h2>
            <Chip color="soft" variant="caption">
              {knocks.length} knocks
            </Chip>
          </div>
        </div>

        {knocks.length === 0 ? (
          <div className="py-12 flex flex-col items-center justify-center text-center gap-2 border border-dashed border-border-button-default rounded-2xl">
            <HugeClock className="size-8 text-text-tertiary" />
            <div className="text-body-medium font-semibold text-text-primary">
              No knocks yet today
            </div>
            <p className="text-caption-1-semibold text-text-secondary max-w-sm px-4">
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
                  className="py-4 flex flex-col gap-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <Avatar
                        size="md"
                        initials={guestInitials}
                        src={k.guestAvatarUrl || undefined}
                      />
                      <div className="flex flex-col min-w-0">
                        <span className="text-body-medium font-semibold text-text-primary truncate">
                          {k.guestName}
                        </span>
                        <span className="text-caption-1-semibold text-text-secondary truncate">
                          {k.guestEmail}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <Chip
                        color={statusColorMap[k.status] || "soft"}
                        variant="caption"
                      >
                        {k.status === "queued" ? `Queue #${k.queuePosition || 1}` : k.status}
                      </Chip>
                      <span className="text-caption-2-medium text-text-tertiary hidden sm:inline">
                        {new Date(k.createdAt).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                  </div>

                  <div className="p-3 rounded-xl bg-background-secondary-default/70 border border-border-button-default text-body-2-regular text-text-primary">
                    &ldquo;{k.topic}&rdquo;
                  </div>

                  <div className="flex items-center justify-between gap-2 pt-1">
                    <span className="text-caption-2-medium text-text-tertiary sm:hidden">
                      {new Date(k.createdAt).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>

                    {isRinging && (
                      <div className="grid grid-cols-2 sm:flex sm:items-center gap-2 w-full sm:w-auto sm:ms-auto">
                        <Button
                          variant="secondary"
                          size="small"
                          className="w-full sm:w-auto justify-center"
                          onClick={() => onDeclineKnock(k.id)}
                        >
                          Decline
                        </Button>
                        <Button
                          variant="primary"
                          size="small"
                          className="w-full sm:w-auto justify-center"
                          leadingIcon={HugeVideo}
                          onClick={async () => {
                            const link = await onAdmitKnock(k.id);
                            if (link) window.open(link, "_blank");
                          }}
                        >
                          Admit
                        </Button>
                      </div>
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
