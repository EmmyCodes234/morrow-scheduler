"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { Avatar } from "@/components/base/avatar/avatar";
import { Chip } from "@/components/base/badges/chip";
import { Badge } from "@/components/base/badges/badge";
import { Switch } from "@/components/base/switch/switch";
import { GoogleCalendarIcon } from "@/components/icons/google-calendar";
import {
  HugeArrowRight,
  HugeArrowLeft,
  HugeCheck,
  HugeVideo,
  HugeCalendar,
  HugeClock,
  HugeGlobe,
  HugeCopy,
  HugeVerified,
  HugeAdd,
} from "@/components/icons/hugeicons";
import { cx } from "@/utils/cx";

export interface OnboardingViewProps {
  onComplete?: () => void;
  userEmail?: string;
  userName?: string;
}

export function OnboardingView({
  onComplete,
  userEmail = "",
  userName = "",
}: OnboardingViewProps) {
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5 | 6 | 7>(1);

  // Form State
  const initialSlug = (userName || userEmail.split("@")[0] || "me")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  const [slug, setSlug] = useState(initialSlug);
  const [displayName, setDisplayName] = useState(userName || "Host");
  const [timezone, setTimezone] = useState("UTC");
  const [currentTime, setCurrentTime] = useState("");
  const [eventTitle, setEventTitle] = useState("30 Min Strategy Call");
  const [duration, setDuration] = useState<number>(30);
  const [calendarConnected, setCalendarConnected] = useState(true);
  const [copied, setCopied] = useState(false);

  // Working Hours State
  const [weekDays, setWeekDays] = useState([
    { day: "Monday", enabled: true, start: "09:00 AM", end: "05:00 PM" },
    { day: "Tuesday", enabled: true, start: "09:00 AM", end: "05:00 PM" },
    { day: "Wednesday", enabled: true, start: "09:00 AM", end: "05:00 PM" },
    { day: "Thursday", enabled: true, start: "09:00 AM", end: "05:00 PM" },
    { day: "Friday", enabled: true, start: "09:00 AM", end: "05:00 PM" },
    { day: "Saturday", enabled: false, start: "10:00 AM", end: "02:00 PM" },
    { day: "Sunday", enabled: false, start: "10:00 AM", end: "02:00 PM" },
  ]);

  useEffect(() => {
    if (userName) setDisplayName(userName);
    if (userName || userEmail) {
      const s = (userName || userEmail.split("@")[0] || "me")
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");
      setSlug(s);
    }
    try {
      const userTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (userTz) setTimezone(userTz);
      const now = new Intl.DateTimeFormat("en-US", {
        hour: "numeric",
        minute: "numeric",
        hour12: true,
      }).format(new Date());
      setCurrentTime(now);
    } catch {
      // fallback
    }
  }, [userName, userEmail]);

  const handleCopyLink = () => {
    navigator.clipboard.writeText(`https://usemorrow.xyz/${slug}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const handleCopyMondayToWeekdays = () => {
    const monday = weekDays[0];
    setWeekDays((prev) =>
      prev.map((d, i) =>
        i < 5 ? { ...d, enabled: monday.enabled, start: monday.start, end: monday.end } : d
      )
    );
  };

  const toggleDay = (index: number) => {
    setWeekDays((prev) =>
      prev.map((d, i) => (i === index ? { ...d, enabled: !d.enabled } : d))
    );
  };

  return (
    <div className="w-full max-w-xl mx-auto rounded-3xl border border-border-button-default bg-background-primary-default p-6 sm:p-10 shadow-sm flex flex-col gap-8 transition-all">
      {/* PROGRESS BAR */}
      <div className="flex items-center justify-between border-b border-border-button-default pb-4">
        <div className="flex items-center gap-2">
          {step > 1 && step < 7 && (
            <button
              type="button"
              onClick={() => setStep((s) => (s - 1) as any)}
              className="p-1 rounded-lg border border-border-button-default hover:bg-background-secondary-default text-text-secondary hover:text-text-primary transition-colors cursor-pointer mr-1"
              aria-label="Previous step"
            >
              <HugeArrowLeft className="size-4" />
            </button>
          )}
          <div className="flex items-center gap-1.5">
            {[1, 2, 3, 4, 5, 6, 7].map((num) => (
              <div
                key={num}
                className={cx(
                  "size-2 rounded-full transition-all duration-300",
                  step === num
                    ? "w-6 bg-accent-500"
                    : step > num
                    ? "bg-accent-500/70"
                    : "bg-background-tertiary-default"
                )}
              />
            ))}
          </div>
        </div>

        <span className="text-caption-1-semibold text-text-tertiary uppercase tracking-wider">
          Step {step} of 7
        </span>
      </div>

      <AnimatePresence mode="wait">
        {/* STEP 1: WELCOME */}
        {step === 1 && (
          <motion.div
            key="step1"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.2 }}
            className="flex flex-col gap-6 text-center items-center py-4"
          >
            <div className="relative">
              <Avatar size="lg" initials={displayName.charAt(0)} color="blue" />
              <div className="absolute -bottom-1 -right-1 size-5 rounded-full bg-accent-500 text-white flex items-center justify-center font-bold text-caption-1-semibold shadow-xs">
                M
              </div>
            </div>

            <div className="flex flex-col gap-2 max-w-md">
              <h1 className="text-title-1-medium text-text-primary">
                Welcome to Morrow, {displayName.split(" ")[0]} 👋
              </h1>
              <p className="text-body-regular text-text-secondary leading-relaxed">
                Tomorrow starts here. Let’s get your calendar connected and claim your personal scheduling link in 2 minutes.
              </p>
            </div>

            <div className="w-full flex flex-col gap-3 pt-4">
              <Button
                variant="primary"
                size="medium"
                className="w-full justify-center"
                trailingIcon={HugeArrowRight}
                onClick={() => setStep(2)}
              >
                Let’s set you up
              </Button>
            </div>
          </motion.div>
        )}

        {/* STEP 2: CLAIM URL */}
        {step === 2 && (
          <motion.div
            key="step2"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.2 }}
            className="flex flex-col gap-6"
          >
            <div className="flex flex-col gap-1">
              <h2 className="text-title-2-medium text-text-primary">Claim your booking link</h2>
              <p className="text-body-regular text-text-secondary">
                This is the clean, memorable link guests will use to schedule time with you.
              </p>
            </div>

            <div className="flex flex-col gap-4">
              <div>
                <label className="block text-body-medium text-text-primary mb-1.5 font-medium">
                  Your custom URL
                </label>
                <div className="flex items-center rounded-xl border border-border-button-default bg-background-secondary-default px-3.5 py-2.5 text-body-medium text-text-secondary focus-within:border-accent-500 focus-within:ring-2 focus-within:ring-accent-500/20 transition-all">
                  <span className="text-text-tertiary select-none font-medium">usemorrow.xyz/</span>
                  <input
                    type="text"
                    value={slug}
                    onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                    className="w-full bg-transparent text-text-primary outline-none ps-0.5 font-semibold tracking-tight"
                    placeholder="your-name"
                    autoFocus
                  />
                  <Chip color="lime" variant="bold" className="shrink-0">Available</Chip>
                </div>
              </div>

              <Input
                label="Display name"
                value={displayName}
                onChange={setDisplayName}
                hint="Shown at the top of your public booking page"
              />
            </div>

            <Button
              variant="primary"
              size="medium"
              trailingIcon={HugeArrowRight}
              className="w-full justify-center mt-2"
              onClick={() => setStep(3)}
            >
              Continue
            </Button>
          </motion.div>
        )}

        {/* STEP 3: TIMEZONE */}
        {step === 3 && (
          <motion.div
            key="step3"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.2 }}
            className="flex flex-col gap-6"
          >
            <div className="flex flex-col gap-1">
              <h2 className="text-title-2-medium text-text-primary">Where are you based?</h2>
              <p className="text-body-regular text-text-secondary">
                Morrow automatically translates your available slots into every guest’s local timezone.
              </p>
            </div>

            <div className="rounded-2xl border border-border-button-default bg-background-secondary-default p-5 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <HugeGlobe className="size-5 text-accent-500" />
                  <span className="text-body-medium font-semibold text-text-primary">
                    Detected Timezone
                  </span>
                </div>
                {currentTime && (
                  <Badge color="neutral" className="font-mono">
                    {currentTime}
                  </Badge>
                )}
              </div>
              <p className="text-title-3-semibold text-text-primary">{timezone}</p>
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-body-2-regular text-text-secondary">
                Want to change it?
              </span>
              <select
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="w-full rounded-xl border border-border-button-default bg-background-primary-default px-3.5 py-2.5 text-body-medium text-text-primary outline-none focus:border-accent-500"
              >
                <option value="Africa/Lagos">Africa/Lagos (West Africa Time, GMT+1)</option>
                <option value="Europe/London">Europe/London (GMT/BST)</option>
                <option value="America/New_York">America/New_York (Eastern Time)</option>
                <option value="America/Chicago">America/Chicago (Central Time)</option>
                <option value="America/Los_Angeles">America/Los_Angeles (Pacific Time)</option>
                <option value="Asia/Dubai">Asia/Dubai (GST, GMT+4)</option>
                <option value="Asia/Singapore">Asia/Singapore (SGT, GMT+8)</option>
                <option value="UTC">UTC (Universal Time)</option>
              </select>
            </div>

            <Button
              variant="primary"
              size="medium"
              trailingIcon={HugeArrowRight}
              className="w-full justify-center mt-2"
              onClick={() => setStep(4)}
            >
              Continue
            </Button>
          </motion.div>
        )}

        {/* STEP 4: WORKING HOURS */}
        {step === 4 && (
          <motion.div
            key="step4"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.2 }}
            className="flex flex-col gap-5"
          >
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-title-2-medium text-text-primary">When are you free?</h2>
                <p className="text-body-regular text-text-secondary">
                  Set standard hours when guests can book you.
                </p>
              </div>
              <Button
                variant="ghost"
                size="xs"
                onClick={handleCopyMondayToWeekdays}
                className="text-accent-500 hover:text-accent-600"
              >
                Copy Mon to all
              </Button>
            </div>

            <div className="flex flex-col divide-y divide-border-button-default rounded-2xl border border-border-button-default bg-background-secondary-default/50 p-2">
              {weekDays.map((d, idx) => (
                <div
                  key={d.day}
                  className="p-3 flex items-center justify-between gap-3 text-body-medium"
                >
                  <div className="flex items-center gap-3">
                    <Switch
                      isSelected={d.enabled}
                      onChange={() => toggleDay(idx)}
                      aria-label={`Toggle ${d.day}`}
                    />
                    <span
                      className={cx(
                        "font-medium w-24",
                        d.enabled ? "text-text-primary" : "text-text-tertiary"
                      )}
                    >
                      {d.day}
                    </span>
                  </div>

                  {d.enabled ? (
                    <div className="flex items-center gap-1.5 text-body-2-regular text-text-primary">
                      <span className="px-2 py-1 rounded-md bg-background-primary-default border border-border-button-default">
                        {d.start}
                      </span>
                      <span className="text-text-tertiary">–</span>
                      <span className="px-2 py-1 rounded-md bg-background-primary-default border border-border-button-default">
                        {d.end}
                      </span>
                    </div>
                  ) : (
                    <span className="text-body-2-regular text-text-tertiary italic">Unavailable</span>
                  )}
                </div>
              ))}
            </div>

            <Button
              variant="primary"
              size="medium"
              trailingIcon={HugeArrowRight}
              className="w-full justify-center mt-1"
              onClick={() => setStep(5)}
            >
              Continue
            </Button>
          </motion.div>
        )}

        {/* STEP 5: CONNECT CALENDAR */}
        {step === 5 && (
          <motion.div
            key="step5"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.2 }}
            className="flex flex-col gap-6"
          >
            <div className="flex flex-col gap-1">
              <h2 className="text-title-2-medium text-text-primary">Connect your calendar</h2>
              <p className="text-body-regular text-text-secondary">
                Morrow checks your real-time busy blocks to prevent any double-bookings.
              </p>
            </div>

            <div className="rounded-2xl border border-border-button-default bg-background-secondary-default p-6 flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <GoogleCalendarIcon className="size-8 shrink-0" />
                  <div className="flex flex-col">
                    <span className="text-body-medium font-semibold text-text-primary">
                      Google Calendar
                    </span>
                    <span className="text-body-2-regular text-text-secondary">
                      {userEmail}
                    </span>
                  </div>
                </div>

                <Badge color="primary">Connected</Badge>
              </div>

              <div className="pt-3 border-t border-border-button-default flex flex-col gap-2 text-body-2-regular text-text-secondary">
                <div className="flex items-center gap-2">
                  <HugeCheck className="size-4 text-status-lime-text" />
                  <span>Checks for busy blocks automatically</span>
                </div>
                <div className="flex items-center gap-2">
                  <HugeCheck className="size-4 text-status-lime-text" />
                  <span>Creates unique Google Meet video links for bookings</span>
                </div>
                <div className="flex items-center gap-2">
                  <HugeCheck className="size-4 text-status-lime-text" />
                  <span>Adds new meetings directly to your calendar</span>
                </div>
              </div>
            </div>

            <Button
              variant="primary"
              size="medium"
              trailingIcon={HugeArrowRight}
              className="w-full justify-center mt-2"
              onClick={() => setStep(6)}
            >
              Continue
            </Button>
          </motion.div>
        )}

        {/* STEP 6: FIRST EVENT TYPE */}
        {step === 6 && (
          <motion.div
            key="step6"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.2 }}
            className="flex flex-col gap-6"
          >
            <div className="flex flex-col gap-1">
              <h2 className="text-title-2-medium text-text-primary">Your first meeting type</h2>
              <p className="text-body-regular text-text-secondary">
                You can create more meeting types anytime from your dashboard.
              </p>
            </div>

            <div className="flex flex-col gap-4">
              <Input
                label="Event title"
                value={eventTitle}
                onChange={setEventTitle}
                placeholder="e.g. 30 Min Strategy Call"
              />

              <div className="flex flex-col gap-1.5">
                <span className="text-body-medium font-medium text-text-primary">Duration</span>
                <div className="grid grid-cols-4 gap-2">
                  {[15, 30, 45, 60].map((mins) => (
                    <button
                      key={mins}
                      type="button"
                      onClick={() => setDuration(mins)}
                      className={cx(
                        "py-2 px-3 rounded-xl border text-body-medium font-medium transition-all cursor-pointer text-center",
                        duration === mins
                          ? "border-accent-500 bg-accent-500 text-white font-semibold shadow-2xs"
                          : "border-border-button-default bg-background-primary-default text-text-secondary hover:text-text-primary"
                      )}
                    >
                      {mins} mins
                    </button>
                  ))}
                </div>
              </div>

              {/* LIVE MINI PREVIEW */}
              <div className="rounded-2xl border border-dashed border-border-button-default p-4 flex flex-col gap-2 bg-background-secondary-default/40">
                <span className="text-caption-1-semibold uppercase tracking-wider text-text-tertiary">
                  Preview on your link
                </span>
                <div className="flex items-center justify-between">
                  <div className="flex flex-col">
                    <span className="text-body-medium font-semibold text-text-primary">{eventTitle}</span>
                    <span className="text-body-2-regular text-text-secondary">Google Meet • {duration} mins</span>
                  </div>
                  <Chip color="blue" variant="bold">{duration}m</Chip>
                </div>
              </div>
            </div>

            <Button
              variant="primary"
              size="medium"
              trailingIcon={HugeArrowRight}
              className="w-full justify-center mt-2"
              onClick={() => setStep(7)}
            >
              Finish setup
            </Button>
          </motion.div>
        )}

        {/* STEP 7: BOARDUI CELEBRATION & LIVE LINK */}
        {step === 7 && (
          <motion.div
            key="step7"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.3 }}
            className="flex flex-col items-center text-center gap-6 py-2"
          >
            {/* ANIMATED SUCCESS SHIELD */}
            <div className="relative flex items-center justify-center">
              <motion.div
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: [1, 1.25, 1], opacity: 1 }}
                transition={{ duration: 0.6, ease: "easeOut" }}
                className="size-20 rounded-full bg-status-lime-background/80 flex items-center justify-center text-status-lime-text shadow-sm"
              >
                <HugeCheck className="size-10 stroke-[2.5]" />
              </motion.div>
            </div>

            <div className="flex flex-col gap-2 max-w-sm">
              <h2 className="text-title-1-medium text-text-primary">You are ready for tomorrow</h2>
              <p className="text-body-regular text-text-secondary">
                Your personal scheduling page is live and ready for guests.
              </p>
            </div>

            {/* INTERACTIVE LIVE LINK CARD */}
            <div className="w-full rounded-2xl border border-border-button-default bg-background-secondary-default p-4 flex items-center justify-between gap-3 text-left">
              <div className="flex flex-col min-w-0">
                <span className="text-caption-1-semibold uppercase tracking-wider text-text-tertiary">
                  Your live link
                </span>
                <span className="text-body-medium font-semibold text-text-primary truncate">
                  usemorrow.xyz/{slug}
                </span>
              </div>

              <Button
                variant="secondary"
                size="small"
                leadingIcon={copied ? HugeCheck : HugeCopy}
                onClick={handleCopyLink}
                className="shrink-0"
              >
                {copied ? "Copied!" : "Copy link"}
              </Button>
            </div>

            <div className="w-full flex flex-col gap-3 pt-2">
              <Button
                variant="primary"
                size="medium"
                className="w-full justify-center"
                onClick={onComplete}
              >
                Enter your dashboard
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
