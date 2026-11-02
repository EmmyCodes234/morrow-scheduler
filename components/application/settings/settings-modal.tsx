"use client";

import { useDirection } from "@/components/foundations/direction/direction";
import { useEffect, useRef, useState, type ComponentType } from "react";
import { createPortal } from "react-dom";
import {
  HugeUser,
  HugePalette,
  HugeClock,
  HugeVideo,
  HugeClose,
  HugeCheck,
  HugeCopy,
  HugeLink,
  HugeUpload,
  HugeGlobe,
  HugeMail,
} from "@/components/icons/hugeicons";
import { GoogleCalendarIcon } from "@/components/icons/google-calendar";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { Textarea } from "@/components/base/textarea/textarea";
import { Switch } from "@/components/base/switch/switch";
import { SwitchCard } from "@/components/base/switch/switch-card";
import { Avatar } from "@/components/base/avatar/avatar";
import { Badge } from "@/components/base/badges/badge";
import { Chip } from "@/components/base/badges/chip";
import { signIn } from "next-auth/react";
import { cx } from "@/utils/cx";
import {
  SettingsCard,
  SettingsSectionLabel,
  SettingsRow,
} from "./settings-rows";

export type SettingsPage = "profile" | "appearance" | "rules" | "integrations";

export interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultPage?: SettingsPage;
  planArtSrc?: string;
  user?: {
    id?: string;
    name?: string;
    email?: string;
    slug?: string;
    initials?: string;
    timezone?: string;
    brandColor?: string | null;
    welcomeMessage?: string | null;
  };
}

type IconComponent = ComponentType<{
  className?: string;
  "aria-hidden"?: boolean | "true" | "false";
}>;

interface NavItem {
  label: string;
  icon: IconComponent;
  page: SettingsPage;
}

const NAV_ITEMS: NavItem[] = [
  { label: "Profile", icon: HugeUser, page: "profile" },
  { label: "Appearance Studio", icon: HugePalette, page: "appearance" },
  { label: "Booking Rules", icon: HugeClock, page: "rules" },
  { label: "Integrations", icon: HugeVideo, page: "integrations" },
];

const PRESET_COLORS = [
  { name: "Morrow Blue", hex: "#2563EB" },
  { name: "Emerald", hex: "#059669" },
  { name: "Violet", hex: "#7C3AED" },
  { name: "Amber", hex: "#D97706" },
  { name: "Rose", hex: "#E11D48" },
  { name: "Midnight", hex: "#0F172A" },
];

export function SettingsModal({
  isOpen,
  onClose,
  defaultPage = "profile",
  user,
}: SettingsModalProps) {
  const direction = useDirection();
  const [page, setPage] = useState<SettingsPage>(defaultPage);

  // Dynamic Profile state
  const [name, setName] = useState(user?.name || "");
  const [email, setEmail] = useState(user?.email || "");
  const [slug, setSlug] = useState(user?.slug || "");
  const [timezone, setTimezone] = useState(user?.timezone || "UTC");

  // Dynamic Appearance state
  const [welcomeMessage, setWelcomeMessage] = useState(user?.welcomeMessage || "Pick a time that works for you.");
  const [brandColor, setBrandColor] = useState(user?.brandColor || "#2563EB");
  const [customHex, setCustomHex] = useState(user?.brandColor || "#2563EB");

  useEffect(() => {
    if (user) {
      if (user.name) setName(user.name);
      if (user.email) setEmail(user.email);
      if (user.slug) setSlug(user.slug);
      if (user.timezone) setTimezone(user.timezone);
      if (user.brandColor) {
        setBrandColor(user.brandColor);
        setCustomHex(user.brandColor);
      }
      if (user.welcomeMessage) setWelcomeMessage(user.welcomeMessage);
    }
  }, [user]);

  // Booking rules state
  const [bufferTime, setBufferTime] = useState("10");
  const [minNotice, setMinNotice] = useState("2");
  const [maxWindow, setMaxWindow] = useState("30");

  // Mount/visible transitions
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const unmountTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Saved toast state
  const [savedPhase, setSavedPhase] = useState<"hidden" | "shown" | "leaving">("hidden");
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showSavedToast = () => {
    if (savedTimer.current) clearTimeout(savedTimer.current);
    setSavedPhase("shown");
    savedTimer.current = setTimeout(() => {
      setSavedPhase("leaving");
      savedTimer.current = setTimeout(() => setSavedPhase("hidden"), 220);
    }, 2000);
  };

  const persistSettings = (patch: Record<string, any>) => {
    showSavedToast();
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(async () => {
      try {
        await fetch("/api/user/me", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
      } catch (err) {
        console.error("Failed to auto-persist settings:", err);
      }
    }, 350);
  };

  useEffect(() => {
    if (isOpen) {
      if (unmountTimer.current) clearTimeout(unmountTimer.current);
      setPage(defaultPage);
      setMounted(true);
      requestAnimationFrame(() => requestAnimationFrame(() => setVisible(true)));
    } else {
      setVisible(false);
      setSavedPhase("hidden");
      unmountTimer.current = setTimeout(() => setMounted(false), 320);
    }
    return () => {
      if (unmountTimer.current) clearTimeout(unmountTimer.current);
      if (savedTimer.current) clearTimeout(savedTimer.current);
    };
  }, [isOpen, defaultPage]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    panelRef.current?.focus();
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  if (!mounted || typeof document === "undefined") return null;

  const computedInitials = (name || user?.name || "U")
    .split(" ")
    .filter(Boolean)
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase() || "U";

  const handleColorChange = (hex: string) => {
    setBrandColor(hex);
    setCustomHex(hex);
    persistSettings({ brandColor: hex });
  };

  return createPortal(
    <div dir={direction} className="fixed inset-0 z-100 flex items-center justify-center p-3 sm:p-4" role="presentation">
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Close settings"
        tabIndex={-1}
        onClick={onClose}
        className={cx(
          "absolute inset-0 cursor-default bg-black/70 backdrop-blur-xs transition-opacity duration-300 ease-out",
          visible ? "opacity-100" : "opacity-0",
        )}
      />

      {/* Animated panel wrapper */}
      <div
        className={cx(
          "relative w-full max-w-[920px]",
          "transform-gpu transition-[opacity,transform,filter] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]",
          visible ? "scale-100 opacity-100 blur-0" : "scale-[0.88] opacity-0 blur-[4px]",
        )}
      >
        {/* Panel */}
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label="Morrow Settings"
          tabIndex={-1}
          className={cx(
            "relative flex flex-col md:flex-row h-[660px] max-h-[calc(100dvh-32px)] w-full",
            "overflow-clip rounded-3xl bg-background-full border border-border-button-default shadow-sidebar outline-none",
          )}
        >
          {/* Navigation rail */}
          <nav
            aria-label="Settings sections"
            className="flex md:flex-col gap-1.5 shrink-0 border-b md:border-b-0 md:border-e border-separator-border bg-background-secondary-default p-3 md:w-56 overflow-x-auto md:overflow-y-auto"
          >
            <div className="hidden md:flex items-center gap-2 px-3 py-2 mb-2">
              <span className="text-body-2-medium font-semibold text-text-primary">Settings</span>
            </div>

            {NAV_ITEMS.map((item) => {
              const selected = item.page === page;
              return (
                <button
                  key={item.page}
                  type="button"
                  aria-label={item.label}
                  aria-current={selected ? "page" : undefined}
                  onClick={() => setPage(item.page)}
                  className={cx(
                    "flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-start whitespace-nowrap cursor-pointer transition-colors duration-150",
                    selected
                      ? "bg-accent-500 text-white shadow-nav-selected"
                      : "text-text-secondary hover:bg-background-secondary-hover hover:text-text-primary",
                  )}
                >
                  <item.icon className={cx("size-4 shrink-0", selected ? "text-white" : "text-foreground-icon-secondary")} />
                  <span className="text-body-medium font-medium">{item.label}</span>
                </button>
              );
            })}
          </nav>

          {/* Content pane */}
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
            {/* Title header */}
            <div className="flex shrink-0 items-center justify-between px-6 sm:px-8 py-5 border-b border-separator-border">
              <div className="flex flex-col gap-0.5">
                <h2 className="text-title-3-semibold text-text-primary">
                  {page === "profile" && "Profile & Public Page"}
                  {page === "appearance" && "Appearance Studio"}
                  {page === "rules" && "Booking & Availability Rules"}
                  {page === "integrations" && "Connected Integrations"}
                </h2>
                <p className="text-body-2-regular text-text-secondary">
                  {page === "profile" && "Manage your personal host information and Morrow link."}
                  {page === "appearance" && "Personalize your public scheduling page branding and colors."}
                  {page === "rules" && "Configure scheduling buffers, lead times, and booking limits."}
                  {page === "integrations" && "Connect Google Calendar and communication channels."}
                </p>
              </div>

              <button
                type="button"
                aria-label="Close settings"
                onClick={onClose}
                className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-full bg-background-tertiary-default text-foreground-icon-secondary hover:bg-background-tertiary-hover transition-colors"
              >
                <HugeClose className="size-4" />
              </button>
            </div>

            {/* Scrollable content area */}
            <div className="flex-1 overflow-y-auto p-6 sm:p-8 flex flex-col gap-6">
              {/* ================================================================= */}
              {/* PAGE 1: PROFILE */}
              {/* ================================================================= */}
              {page === "profile" && (
                <div className="flex flex-col gap-6 max-w-xl">
                  <div className="flex items-center gap-4 p-4 rounded-2xl border border-border-button-default bg-background-primary-default">
                    <Avatar size="lg" initials={computedInitials} color="blue" />
                    <div className="flex flex-col">
                      <span className="text-body-medium font-semibold text-text-primary">{name}</span>
                      <span className="text-body-2-regular text-text-secondary">{email}</span>
                      <span className="text-caption-1-semibold text-accent-600 mt-0.5">usemorrow.xyz/{slug}</span>
                    </div>
                  </div>

                  <div className="flex flex-col gap-4">
                    <div className="flex flex-col gap-1.5">
                      <label className="text-body-medium font-medium text-text-primary">Full Name</label>
                      <Input
                        value={name}
                        onChange={(val) => { setName(val); persistSettings({ name: val }); }}
                        placeholder="Your full name"
                      />
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <label className="text-body-medium font-medium text-text-primary">Morrow Public Link</label>
                      <div className="flex items-center gap-2">
                        <span className="px-3 py-2 rounded-xl bg-background-secondary-default border border-border-button-default text-text-secondary text-body-2-regular select-none font-mono">
                          usemorrow.xyz/
                        </span>
                        <Input
                          value={slug}
                          onChange={(val) => { setSlug(val); persistSettings({ slug: val }); }}
                          placeholder="username"
                          className="flex-1"
                        />
                      </div>
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <label className="text-body-medium font-medium text-text-primary">Account Email</label>
                      <Input
                        value={email}
                        isDisabled
                        placeholder="you@domain.com"
                      />
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <label className="text-body-medium font-medium text-text-primary">Primary Timezone</label>
                      <select
                        value={timezone}
                        onChange={(e) => { setTimezone(e.target.value); persistSettings({ timezone: e.target.value }); }}
                        aria-label="Primary Timezone"
                        className="w-full px-3 py-2.5 rounded-xl border border-border-button-default bg-background-primary-default text-body-medium text-text-primary outline-none focus:ring-2 focus:ring-border-focus-ring cursor-pointer"
                      >
                        <option value="Africa/Lagos (GMT+1)">Africa/Lagos (GMT+1)</option>
                        <option value="America/New_York (GMT-5)">America/New_York (GMT-5)</option>
                        <option value="America/Los_Angeles (GMT-8)">America/Los_Angeles (GMT-8)</option>
                        <option value="Europe/London (GMT+0)">Europe/London (GMT+0)</option>
                        <option value="Europe/Paris (GMT+1)">Europe/Paris (GMT+1)</option>
                        <option value="Asia/Dubai (GMT+4)">Asia/Dubai (GMT+4)</option>
                        <option value="Asia/Singapore (GMT+8)">Asia/Singapore (GMT+8)</option>
                        <option value="Asia/Tokyo (GMT+9)">Asia/Tokyo (GMT+9)</option>
                      </select>
                    </div>
                  </div>
                </div>
              )}

              {/* ================================================================= */}
              {/* PAGE 2: APPEARANCE STUDIO */}
              {/* ================================================================= */}
              {page === "appearance" && (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
                  {/* Left controls */}
                  <div className="lg:col-span-7 flex flex-col gap-6">
                    <div className="flex flex-col gap-2">
                      <label className="text-body-medium font-medium text-text-primary">Welcome Message</label>
                      <Textarea
                        value={welcomeMessage}
                        onChange={(val) => { setWelcomeMessage(val); persistSettings({ welcomeMessage: val }); }}
                        placeholder="Pick a time that works for you."
                        rows={3}
                      />
                      <span className="text-body-2-regular text-text-tertiary">
                        Shown at the top of your public booking page.
                      </span>
                    </div>

                    <div className="flex flex-col gap-3">
                      <label className="text-body-medium font-medium text-text-primary">Brand Accent Color</label>
                      <div className="flex flex-wrap items-center gap-2.5">
                        {PRESET_COLORS.map((preset) => (
                          <button
                            key={preset.hex}
                            type="button"
                            onClick={() => handleColorChange(preset.hex)}
                            aria-label={preset.name}
                            className={cx(
                              "size-9 rounded-full flex items-center justify-center cursor-pointer transition-transform hover:scale-110",
                              brandColor === preset.hex && "ring-2 ring-offset-2 ring-border-focus-ring scale-105"
                            )}
                            style={{ backgroundColor: preset.hex }}
                          >
                            {brandColor === preset.hex && <HugeCheck className="size-4 text-white" />}
                          </button>
                        ))}
                      </div>

                      <div className="flex items-center gap-3 pt-2">
                        <span className="text-body-2-regular text-text-secondary">Custom hex:</span>
                        <div className="flex items-center gap-2">
                          <div
                            className="size-7 rounded-lg border border-border-button-default shrink-0 shadow-2xs"
                            style={{ backgroundColor: customHex }}
                          />
                          <Input
                            size="small"
                            value={customHex}
                            onChange={(val) => {
                              setCustomHex(val);
                              if (/^#[0-9A-Fa-f]{6}$/.test(val)) {
                                setBrandColor(val);
                                persistSettings({ brandColor: val });
                              }
                            }}
                            className="w-28 font-mono"
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Right Live Preview Card */}
                  <div className="lg:col-span-5 flex flex-col gap-2">
                    <span className="text-body-2-medium font-semibold text-text-secondary">
                      Live Public Page Preview
                    </span>
                    <div className="rounded-2xl border border-border-button-default bg-background-primary-default p-5 flex flex-col gap-4 shadow-sm">
                      <div className="flex items-center gap-3 pb-3 border-b border-border-button-default">
                        <Avatar size="md" initials={computedInitials} color="blue" />
                        <div className="flex flex-col">
                          <span className="text-body-medium font-semibold text-text-primary">{name}</span>
                          <span className="text-body-2-regular text-text-secondary">usemorrow.xyz/{slug}</span>
                        </div>
                      </div>

                      <div className="p-3 rounded-xl bg-background-secondary-default text-body-2-regular text-text-primary italic border border-border-button-default">
                        &ldquo;{welcomeMessage}&rdquo;
                      </div>

                      <div className="flex flex-col gap-2">
                        <span className="text-caption-1-semibold text-text-tertiary uppercase tracking-wider">
                          Sample Event
                        </span>
                        <div className="p-3 rounded-xl border border-border-button-default flex items-center justify-between bg-background-secondary-default/40">
                          <span className="text-body-2-regular font-medium text-text-primary">30 Min Strategy</span>
                          <span
                            className="px-2.5 py-1 rounded-lg text-body-2-regular font-semibold text-white shadow-2xs"
                            style={{ backgroundColor: brandColor }}
                          >
                            Select
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* ================================================================= */}
              {/* PAGE 3: BOOKING RULES */}
              {/* ================================================================= */}
              {page === "rules" && (
                <div className="flex flex-col gap-5 max-w-xl">
                  <div className="flex flex-col gap-2">
                    <label className="text-body-medium font-medium text-text-primary">
                      Buffer time before & after calls
                    </label>
                    <select
                      value={bufferTime}
                      onChange={(e) => { setBufferTime(e.target.value); persistSettings({ bufferMins: Number(e.target.value) }); }}
                      aria-label="Buffer time before & after calls"
                      className="w-full px-3 py-2.5 rounded-xl border border-border-button-default bg-background-primary-default text-body-medium text-text-primary outline-none cursor-pointer"
                    >
                      <option value="0">No buffer</option>
                      <option value="5">5 minutes</option>
                      <option value="10">10 minutes (Recommended)</option>
                      <option value="15">15 minutes</option>
                      <option value="30">30 minutes</option>
                    </select>
                    <span className="text-body-2-regular text-text-tertiary">
                      Gives you breathing room between consecutive meetings.
                    </span>
                  </div>

                  <div className="flex flex-col gap-2">
                    <label className="text-body-medium font-medium text-text-primary">
                      Minimum notice period
                    </label>
                    <select
                      value={minNotice}
                      onChange={(e) => { setMinNotice(e.target.value); persistSettings({ minNoticeHours: Number(e.target.value) }); }}
                      aria-label="Minimum notice period"
                      className="w-full px-3 py-2.5 rounded-xl border border-border-button-default bg-background-primary-default text-body-medium text-text-primary outline-none cursor-pointer"
                    >
                      <option value="1">1 hour</option>
                      <option value="2">2 hours (Standard)</option>
                      <option value="4">4 hours</option>
                      <option value="24">24 hours in advance</option>
                    </select>
                    <span className="text-body-2-regular text-text-tertiary">
                      Prevents last-minute surprises on your calendar.
                    </span>
                  </div>

                  <div className="flex flex-col gap-2">
                    <label className="text-body-medium font-medium text-text-primary">
                      Future booking window
                    </label>
                    <select
                      value={maxWindow}
                      onChange={(e) => { setMaxWindow(e.target.value); persistSettings({ maxBookingDays: Number(e.target.value) }); }}
                      aria-label="Future booking window"
                      className="w-full px-3 py-2.5 rounded-xl border border-border-button-default bg-background-primary-default text-body-medium text-text-primary outline-none cursor-pointer"
                    >
                      <option value="14">14 days ahead</option>
                      <option value="30">30 days ahead (Recommended)</option>
                      <option value="60">60 days ahead</option>
                      <option value="90">90 days ahead</option>
                    </select>
                    <span className="text-body-2-regular text-text-tertiary">
                      Limits how far into the future guests can schedule appointments.
                    </span>
                  </div>
                </div>
              )}

              {/* ================================================================= */}
              {/* PAGE 4: INTEGRATIONS */}
              {/* ================================================================= */}
              {page === "integrations" && (
                <div className="flex flex-col gap-5 max-w-xl">
                  {/* Google Calendar Card */}
                  <div className="rounded-2xl border border-border-button-default bg-background-primary-default p-5 flex items-center justify-between gap-4 shadow-2xs">
                    <div className="flex items-center gap-3.5">
                      <GoogleCalendarIcon className="size-9 shrink-0" />
                      <div className="flex flex-col">
                        <div className="flex items-center gap-2">
                          <span className="text-body-medium font-semibold text-text-primary">Google Calendar</span>
                          <Chip color="lime" variant="bold">Connected</Chip>
                        </div>
                        <span className="text-body-2-regular text-text-secondary">
                          {email} &bull; 2-way sync active
                        </span>
                      </div>
                    </div>

                    <Button
                      variant="secondary"
                      size="xs"
                      onClick={() => {
                        signIn("google", { callbackUrl: "/dashboard", redirectTo: "/dashboard" });
                      }}
                    >
                      Re-authenticate
                    </Button>
                  </div>

                  <SwitchCard
                    title="Google Meet Video"
                    description="Automatically add Google Meet video conference links to every new booking."
                    defaultSelected={true}
                  />

                  <SwitchCard
                    title="Email Notifications"
                    description="Dispatch instant confirmation and calendar invites via Resend."
                    defaultSelected={true}
                  />
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Saved feedback pill */}
        <div
          aria-live="polite"
          className={cx(
            "pointer-events-none absolute bottom-0 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5",
            "rounded-full border border-border-button-default bg-background-primary-default py-1.5 px-3 shadow-dropdown",
            "transition-[opacity,transform] duration-200 ease-out",
            savedPhase === "shown" && "translate-y-1/2 opacity-100 scale-100",
            savedPhase === "hidden" && "translate-y-[calc(50%+12px)] opacity-0 scale-90",
            savedPhase === "leaving" && "translate-y-[calc(50%-10px)] opacity-0 scale-90",
          )}
        >
          <HugeCheck className="size-4 shrink-0 text-status-lime-text" />
          <span className="text-body-2-medium text-text-primary font-medium">Settings saved</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
