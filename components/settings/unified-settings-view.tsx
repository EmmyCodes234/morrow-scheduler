"use client";

import { useState, useEffect } from "react";
import { DirectionProvider } from "@/components/foundations/direction/direction";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { Textarea } from "@/components/base/textarea/textarea";
import { Switch } from "@/components/base/switch/switch";
import { Avatar } from "@/components/base/avatar/avatar";
import { Chip } from "@/components/base/badges/chip";
import { GoogleCalendarIcon } from "@/components/icons/google-calendar";
import { GoogleMeetIcon } from "@/components/icons/google-meet";
import { ZoomIcon } from "@/components/icons/zoom";
import { MicrosoftTeamsIcon } from "@/components/icons/microsoft-teams";
import {
  HugeUser,
  HugePalette,
  HugeClock,
  HugeVideo,
  HugeCheck,
  HugeCopy,
  HugeGlobe,
  HugeCheckIn,
} from "@/components/icons/hugeicons";
import { cx } from "@/utils/cx";
import type { HostUser } from "@/components/scheduling/dashboard-view";

export type SettingsTab = "profile" | "integrations" | "availability" | "office" | "appearance";

export interface WorkingDay {
  dayOfWeek: number;
  dayName: string;
  startTime: string;
  endTime: string;
  isEnabled: boolean;
}

export interface UnifiedSettingsViewProps {
  user: HostUser;
  defaultTab?: SettingsTab;
  workingDays: WorkingDay[];
  onUpdateUser: (patch: Partial<HostUser>) => Promise<void>;
  onUpdateWorkingDays: (days: WorkingDay[]) => Promise<void>;
  onShowNotification: (msg: string) => void;
  onRefreshData?: () => void;
}

const PRESET_COLORS = [
  { name: "Morrow Blue", hex: "#2563EB" },
  { name: "Emerald", hex: "#059669" },
  { name: "Violet", hex: "#7C3AED" },
  { name: "Amber", hex: "#D97706" },
  { name: "Rose", hex: "#E11D48" },
  { name: "Midnight", hex: "#0F172A" },
];

const TIME_OPTIONS = [
  { value: "08:00", label: "08:00 AM" },
  { value: "08:30", label: "08:30 AM" },
  { value: "09:00", label: "09:00 AM" },
  { value: "09:30", label: "09:30 AM" },
  { value: "10:00", label: "10:00 AM" },
  { value: "11:00", label: "11:00 AM" },
  { value: "12:00", label: "12:00 PM" },
  { value: "13:00", label: "01:00 PM" },
  { value: "14:00", label: "02:00 PM" },
  { value: "15:00", label: "03:00 PM" },
  { value: "16:00", label: "04:00 PM" },
  { value: "17:00", label: "05:00 PM" },
  { value: "18:00", label: "06:00 PM" },
  { value: "19:00", label: "07:00 PM" },
  { value: "20:00", label: "08:00 PM" },
];

export function UnifiedSettingsView({
  user,
  defaultTab = "profile",
  workingDays: initialWorkingDays,
  onUpdateUser,
  onUpdateWorkingDays,
  onShowNotification,
}: UnifiedSettingsViewProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>(defaultTab);

  // Profile Form State
  const [name, setName] = useState(user.name || "");
  const [slug, setSlug] = useState(user.slug || "");
  const [timezone, setTimezone] = useState(user.timezone || "UTC");
  const [welcomeMessage, setWelcomeMessage] = useState(user.welcomeMessage || "Pick a time that works for you.");
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  // Appearance Form State
  const [brandColor, setBrandColor] = useState(user.brandColor || "#2563EB");
  const [customHex, setCustomHex] = useState(user.brandColor || "#2563EB");
  const [isSavingAppearance, setIsSavingAppearance] = useState(false);

  // Integrations State
  const [zoomUrl, setZoomUrl] = useState(user.zoomMeetingUrl || "");
  const [teamsUrl, setTeamsUrl] = useState(user.teamsMeetingUrl || "");
  const [isSavingZoom, setIsSavingZoom] = useState(false);
  const [isSavingTeams, setIsSavingTeams] = useState(false);
  const [isDisconnectingZoom, setIsDisconnectingZoom] = useState(false);

  // Working Days State
  const [days, setDays] = useState<WorkingDay[]>(initialWorkingDays);
  const [isSavingDays, setIsSavingDays] = useState(false);

  // Office Hours Settings
  const [speedChatMins, setSpeedChatMins] = useState<number>(user.officeSpeedChatMins || 10);
  const [notifyEmail, setNotifyEmail] = useState<boolean>(user.officeNotifyEmail !== false);
  const [autoSchedule, setAutoSchedule] = useState<boolean>(Boolean(user.officeAutoSchedule));
  const [officeTopic, setOfficeTopic] = useState<string>(user.officeTopic || "");
  const [isSavingOffice, setIsSavingOffice] = useState(false);

  useEffect(() => {
    setName(user.name || "");
    setSlug(user.slug || "");
    setTimezone(user.timezone || "UTC");
    setWelcomeMessage(user.welcomeMessage || "Pick a time that works for you.");
    setBrandColor(user.brandColor || "#2563EB");
    setCustomHex(user.brandColor || "#2563EB");
    setZoomUrl(user.zoomMeetingUrl || "");
    setTeamsUrl(user.teamsMeetingUrl || "");
    setSpeedChatMins(user.officeSpeedChatMins || 10);
    setNotifyEmail(user.officeNotifyEmail !== false);
    setAutoSchedule(Boolean(user.officeAutoSchedule));
    setOfficeTopic(user.officeTopic || "");
  }, [user]);

  useEffect(() => {
    setDays(initialWorkingDays);
  }, [initialWorkingDays]);

  const handleCopyProfileUrl = () => {
    const url = `https://usemorrow.xyz/${slug}`;
    navigator.clipboard.writeText(url);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
    onShowNotification("Booking link copied to clipboard");
  };

  const handleSaveProfile = async () => {
    setIsSavingProfile(true);
    try {
      const sanitizedSlug = slug
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");

      await onUpdateUser({
        name: name.trim(),
        slug: sanitizedSlug,
        timezone,
        welcomeMessage: welcomeMessage.trim(),
      });
      onShowNotification("Profile updated successfully");
    } catch {
      onShowNotification("Failed to save profile changes");
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleSaveAppearance = async (colorToSave: string) => {
    setIsSavingAppearance(true);
    try {
      await onUpdateUser({ brandColor: colorToSave });
      onShowNotification("Brand styling updated");
    } catch {
      onShowNotification("Failed to save appearance");
    } finally {
      setIsSavingAppearance(false);
    }
  };

  const handleSaveWorkingHours = async () => {
    setIsSavingDays(true);
    try {
      await onUpdateWorkingDays(days);
      onShowNotification("Working hours updated in real-time");
    } catch {
      onShowNotification("Failed to save working hours");
    } finally {
      setIsSavingDays(false);
    }
  };

  const handleCopyMondayToWeekdays = () => {
    const monday = days.find((d) => d.dayOfWeek === 1);
    if (!monday) return;
    setDays((prev) =>
      prev.map((d) => {
        if (d.dayOfWeek >= 1 && d.dayOfWeek <= 5) {
          return {
            ...d,
            startTime: monday.startTime,
            endTime: monday.endTime,
            isEnabled: monday.isEnabled,
          };
        }
        return d;
      })
    );
    onShowNotification("Copied Monday hours to all weekdays");
  };

  const handleSaveOfficeSettings = async () => {
    setIsSavingOffice(true);
    try {
      await onUpdateUser({
        officeSpeedChatMins: speedChatMins,
        officeNotifyEmail: notifyEmail,
        officeAutoSchedule: autoSchedule,
        officeTopic: officeTopic.trim() || null,
      });
      onShowNotification("Virtual office settings saved");
    } catch {
      onShowNotification("Failed to save virtual office settings");
    } finally {
      setIsSavingOffice(false);
    }
  };

  const handleSetDefaultProvider = async (provider: "google_meet" | "zoom" | "teams") => {
    try {
      await onUpdateUser({ defaultLocationType: provider });
      const label = provider === "google_meet" ? "Google Meet" : provider === "zoom" ? "Zoom Meetings" : "Microsoft Teams";
      onShowNotification(`${label} set as default location`);
    } catch {
      onShowNotification("Failed to update default video provider");
    }
  };

  const handleSaveZoomLink = async () => {
    setIsSavingZoom(true);
    try {
      await onUpdateUser({ zoomMeetingUrl: zoomUrl.trim() });
      onShowNotification("Zoom room saved");
    } catch {
      onShowNotification("Failed to save Zoom details");
    } finally {
      setIsSavingZoom(false);
    }
  };

  const handleDisconnectZoom = async () => {
    setIsDisconnectingZoom(true);
    try {
      const res = await fetch("/api/integrations/zoom/disconnect", { method: "POST" });
      if (!res.ok) throw new Error("Failed");
      await onUpdateUser({
        hasZoomOAuth: false,
        zoomEmail: null,
        defaultLocationType: user.defaultLocationType === "zoom" ? "google_meet" : user.defaultLocationType,
      });
      onShowNotification("Zoom account disconnected");
    } catch {
      onShowNotification("Failed to disconnect Zoom");
    } finally {
      setIsDisconnectingZoom(false);
    }
  };

  const handleSaveTeamsLink = async () => {
    setIsSavingTeams(true);
    try {
      await onUpdateUser({ teamsMeetingUrl: teamsUrl.trim() });
      onShowNotification("Microsoft Teams room saved");
    } catch {
      onShowNotification("Failed to save Teams link");
    } finally {
      setIsSavingTeams(false);
    }
  };

  const isZoomActive = user.defaultLocationType === "zoom";
  const isTeamsActive = user.defaultLocationType === "teams";
  const isGoogleMeetActive = !isZoomActive && !isTeamsActive;

  return (
    <DirectionProvider locale="en-US">
      <div className="flex flex-col gap-6 w-full max-w-4xl">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-border-button-default">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2.5">
              <h1 className="text-title-1-medium text-text-primary">Settings</h1>
              <Chip color="soft" variant="caption">Unified Hub</Chip>
            </div>
            <p className="text-body-regular text-text-secondary">
              Manage your personal profile, real-time video integrations, availability schedule, and branding.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="small"
              leadingIcon={copiedLink ? HugeCheck : HugeCopy}
              onClick={handleCopyProfileUrl}
            >
              {copiedLink ? "Copied" : "Copy Link"}
            </Button>
            <Button
              variant="secondary"
              size="small"
              leadingIcon={HugeGlobe}
              onClick={() => window.open(`/${slug}`, "_blank")}
            >
              View Public Page
            </Button>
          </div>
        </div>

        {/* Unified Tab Navigation */}
        <div className="flex items-center gap-1.5 p-1 rounded-2xl bg-background-secondary-default border border-border-button-default overflow-x-auto scrollbar-none touch-pan-x">
          <button
            type="button"
            onClick={() => setActiveTab("profile")}
            className={cx(
              "flex items-center gap-2 px-3.5 py-2 rounded-xl text-body-medium transition-colors cursor-pointer shrink-0",
              activeTab === "profile"
                ? "bg-background-primary-default text-text-primary shadow-2xs font-semibold"
                : "text-text-secondary hover:text-text-primary hover:bg-background-secondary-hover"
            )}
          >
            <HugeUser className="size-4 shrink-0" />
            <span>Profile & Link</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("integrations")}
            className={cx(
              "flex items-center gap-2 px-3.5 py-2 rounded-xl text-body-medium transition-colors cursor-pointer shrink-0",
              activeTab === "integrations"
                ? "bg-background-primary-default text-text-primary shadow-2xs font-semibold"
                : "text-text-secondary hover:text-text-primary hover:bg-background-secondary-hover"
            )}
          >
            <HugeVideo className="size-4 shrink-0" />
            <span>Integrations & Video</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("availability")}
            className={cx(
              "flex items-center gap-2 px-3.5 py-2 rounded-xl text-body-medium transition-colors cursor-pointer shrink-0",
              activeTab === "availability"
                ? "bg-background-primary-default text-text-primary shadow-2xs font-semibold"
                : "text-text-secondary hover:text-text-primary hover:bg-background-secondary-hover"
            )}
          >
            <HugeClock className="size-4 shrink-0" />
            <span>Working Hours</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("office")}
            className={cx(
              "flex items-center gap-2 px-3.5 py-2 rounded-xl text-body-medium transition-colors cursor-pointer shrink-0",
              activeTab === "office"
                ? "bg-background-primary-default text-text-primary shadow-2xs font-semibold"
                : "text-text-secondary hover:text-text-primary hover:bg-background-secondary-hover"
            )}
          >
            <HugeCheckIn className="size-4 shrink-0" />
            <span>Virtual Office</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("appearance")}
            className={cx(
              "flex items-center gap-2 px-3.5 py-2 rounded-xl text-body-medium transition-colors cursor-pointer shrink-0",
              activeTab === "appearance"
                ? "bg-background-primary-default text-text-primary shadow-2xs font-semibold"
                : "text-text-secondary hover:text-text-primary hover:bg-background-secondary-hover"
            )}
          >
            <HugePalette className="size-4 shrink-0" />
            <span>Appearance Studio</span>
          </button>
        </div>

        {/* ========================================================================= */}
        {/* TAB 1: PROFILE & PUBLIC LINK */}
        {/* ========================================================================= */}
        {activeTab === "profile" && (
          <div className="flex flex-col gap-6">
            <div className="rounded-3xl border border-border-button-default bg-background-primary-default p-6 flex flex-col gap-5 shadow-2xs">
              <div className="flex items-center justify-between pb-4 border-b border-border-button-default">
                <div className="flex items-center gap-4">
                  <Avatar size="lg" initials={user.initials} color="blue" />
                  <div className="flex flex-col">
                    <span className="text-body-medium font-semibold text-text-primary">{name || "Your Name"}</span>
                    <span className="text-body-2-regular text-text-secondary">{user.email}</span>
                  </div>
                </div>
                <Chip color="lime" variant="caption">Account Active</Chip>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-body-2-medium text-text-secondary">Display Name</label>
                  <Input
                    value={name}
                    onChange={(val) => setName(val)}
                    placeholder="e.g. Alex Morgan"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-body-2-medium text-text-secondary">Public Booking Handle</label>
                  <div className="flex items-center gap-2">
                    <span className="text-body-2-regular text-text-tertiary select-none font-mono">usemorrow.xyz/</span>
                    <Input
                      value={slug}
                      onChange={(val) => setSlug(val)}
                      placeholder="alex"
                    />
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-body-2-medium text-text-secondary">Timezone</label>
                <select
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-border-button-default bg-background-primary-default text-text-primary text-body-medium focus:outline-none focus:ring-2 focus:ring-accent-500"
                >
                  <option value="UTC">UTC (Universal Coordinated Time)</option>
                  <option value="America/New_York">Eastern Time (US & Canada) - New York</option>
                  <option value="America/Chicago">Central Time (US & Canada) - Chicago</option>
                  <option value="America/Denver">Mountain Time (US & Canada) - Denver</option>
                  <option value="America/Los_Angeles">Pacific Time (US & Canada) - Los Angeles</option>
                  <option value="Europe/London">London / GMT</option>
                  <option value="Europe/Paris">Central European Time - Paris / Berlin</option>
                  <option value="Africa/Lagos">West Africa Time - Lagos</option>
                  <option value="Africa/Nairobi">East Africa Time - Nairobi</option>
                  <option value="Asia/Dubai">Gulf Standard Time - Dubai</option>
                  <option value="Asia/Singapore">Singapore / Hong Kong</option>
                  <option value="Asia/Tokyo">Tokyo Standard Time</option>
                  <option value="Australia/Sydney">Australian Eastern Time - Sydney</option>
                </select>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-body-2-medium text-text-secondary">Welcome Headline & Bio</label>
                <Textarea
                  value={welcomeMessage}
                  onChange={(val) => setWelcomeMessage(val)}
                  placeholder="Welcome to my scheduling page. Pick an open slot that works best for you."
                  rows={3}
                />
              </div>

              <div className="flex justify-end pt-3 border-t border-border-button-default">
                <Button
                  variant="primary"
                  size="medium"
                  disabled={isSavingProfile}
                  onClick={handleSaveProfile}
                >
                  {isSavingProfile ? "Saving..." : "Save Profile Changes"}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 2: INTEGRATIONS & VIDEO HUB */}
        {/* ========================================================================= */}
        {activeTab === "integrations" && (
          <div className="flex flex-col gap-6">
            {/* Default Location Selector Card */}
            <div className="rounded-3xl border border-border-button-default bg-background-primary-default p-6 flex flex-col gap-4 shadow-2xs">
              <div className="flex flex-col gap-1">
                <span className="text-title-2-medium text-text-primary">Default Video Provider</span>
                <p className="text-body-2-regular text-text-secondary">
                  Choose which platform automatically creates video meeting rooms when guests book time on your calendar.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
                {/* Google Meet Card Option */}
                <button
                  type="button"
                  onClick={() => handleSetDefaultProvider("google_meet")}
                  className={cx(
                    "flex flex-col items-start gap-3 p-4 rounded-2xl border text-start transition-all cursor-pointer",
                    isGoogleMeetActive
                      ? "border-accent-500 bg-accent-50/20 dark:bg-accent-950/20 ring-1 ring-accent-500"
                      : "border-border-button-default bg-background-secondary-default hover:bg-background-secondary-hover"
                  )}
                >
                  <div className="flex items-center justify-between w-full">
                    <GoogleMeetIcon className="size-8" />
                    {isGoogleMeetActive && <Chip color="lime" variant="bold">Active</Chip>}
                  </div>
                  <div className="flex flex-col">
                    <span className="text-body-medium font-semibold text-text-primary">Google Meet</span>
                    <span className="text-caption-1-medium text-text-secondary">Native dynamic rooms per booking</span>
                  </div>
                </button>

                {/* Zoom Option */}
                <button
                  type="button"
                  onClick={() => handleSetDefaultProvider("zoom")}
                  className={cx(
                    "flex flex-col items-start gap-3 p-4 rounded-2xl border text-start transition-all cursor-pointer",
                    isZoomActive
                      ? "border-accent-500 bg-accent-50/20 dark:bg-accent-950/20 ring-1 ring-accent-500"
                      : "border-border-button-default bg-background-secondary-default hover:bg-background-secondary-hover"
                  )}
                >
                  <div className="flex items-center justify-between w-full">
                    <ZoomIcon className="size-8" />
                    {isZoomActive && <Chip color="lime" variant="bold">Active</Chip>}
                  </div>
                  <div className="flex flex-col">
                    <span className="text-body-medium font-semibold text-text-primary">Zoom</span>
                    <span className="text-caption-1-medium text-text-secondary">OAuth or personal meeting link</span>
                  </div>
                </button>

                {/* Teams Option */}
                <button
                  type="button"
                  onClick={() => handleSetDefaultProvider("teams")}
                  className={cx(
                    "flex flex-col items-start gap-3 p-4 rounded-2xl border text-start transition-all cursor-pointer",
                    isTeamsActive
                      ? "border-accent-500 bg-accent-50/20 dark:bg-accent-950/20 ring-1 ring-accent-500"
                      : "border-border-button-default bg-background-secondary-default hover:bg-background-secondary-hover"
                  )}
                >
                  <div className="flex items-center justify-between w-full">
                    <MicrosoftTeamsIcon className="size-8" />
                    {isTeamsActive && <Chip color="lime" variant="bold">Active</Chip>}
                  </div>
                  <div className="flex flex-col">
                    <span className="text-body-medium font-semibold text-text-primary">Microsoft Teams</span>
                    <span className="text-caption-1-medium text-text-secondary">Personal or corporate team room</span>
                  </div>
                </button>
              </div>
            </div>

            {/* Google Calendar Card */}
            <div className="rounded-3xl border border-border-button-default bg-background-primary-default p-6 flex flex-col gap-4 shadow-2xs">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3.5">
                  <GoogleCalendarIcon className="size-10 shrink-0" />
                  <div className="flex flex-col">
                    <div className="flex items-center gap-2">
                      <span className="text-body-medium font-semibold text-text-primary">Google Calendar</span>
                      <Chip color="blue" variant="bold">Real-time Sync</Chip>
                    </div>
                    <span className="text-body-2-regular text-text-secondary">
                      Connected with {user.email}. Detects busy events and automatically writes new bookings.
                    </span>
                  </div>
                </div>
                <Chip color="lime" variant="caption">Connected</Chip>
              </div>
            </div>

            {/* Zoom Configuration (In-place) */}
            <div className="rounded-3xl border border-border-button-default bg-background-primary-default p-6 flex flex-col gap-4 shadow-2xs">
              <div className="flex items-center justify-between pb-3 border-b border-border-button-default">
                <div className="flex items-center gap-3.5">
                  <ZoomIcon className="size-10 shrink-0" />
                  <div className="flex flex-col">
                    <div className="flex items-center gap-2">
                      <span className="text-body-medium font-semibold text-text-primary">Zoom Meetings</span>
                      {user.hasZoomOAuth ? (
                        <Chip color="blue" variant="bold">Connected via OAuth</Chip>
                      ) : user.zoomMeetingUrl ? (
                        <Chip color="soft" variant="caption">Personal Room</Chip>
                      ) : (
                        <Chip color="soft" variant="caption">Not Configured</Chip>
                      )}
                    </div>
                    <span className="text-body-2-regular text-text-secondary">
                      {user.hasZoomOAuth
                        ? `OAuth connected as ${user.zoomEmail || "Zoom user"}. Dynamic links generated automatically.`
                        : "Connect your Zoom account or provide your personal meeting room link."}
                    </span>
                  </div>
                </div>

                {user.hasZoomOAuth ? (
                  <Button
                    variant="ghost"
                    size="small"
                    disabled={isDisconnectingZoom}
                    onClick={handleDisconnectZoom}
                  >
                    Disconnect
                  </Button>
                ) : (
                  <Button
                    variant="secondary"
                    size="small"
                    onClick={() => {
                      window.location.href = "/api/integrations/zoom/auth";
                    }}
                  >
                    Connect Zoom
                  </Button>
                )}
              </div>

              {/* Personal Meeting Link input fallback */}
              <div className="flex flex-col gap-2 pt-1">
                <label className="text-body-2-medium text-text-secondary">
                  Personal Meeting Room URL (optional fallback)
                </label>
                <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                  <Input
                    value={zoomUrl}
                    onChange={(val) => setZoomUrl(val)}
                    placeholder="https://zoom.us/j/1234567890"
                    className="flex-1"
                  />
                  <div className="flex items-center gap-2">
                    <Button
                      variant="secondary"
                      size="medium"
                      className="flex-1 sm:flex-initial"
                      disabled={isSavingZoom || zoomUrl === user.zoomMeetingUrl}
                      onClick={handleSaveZoomLink}
                    >
                      {isSavingZoom ? "Saving..." : "Save"}
                    </Button>
                    {zoomUrl && (
                      <Button
                        variant="ghost"
                        size="medium"
                        className="flex-1 sm:flex-initial"
                        onClick={() => window.open(zoomUrl, "_blank")}
                      >
                        Test Room
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Microsoft Teams Configuration (In-place) */}
            <div className="rounded-3xl border border-border-button-default bg-background-primary-default p-6 flex flex-col gap-4 shadow-2xs">
              <div className="flex items-center justify-between pb-3 border-b border-border-button-default">
                <div className="flex items-center gap-3.5">
                  <MicrosoftTeamsIcon className="size-10 shrink-0" />
                  <div className="flex flex-col">
                    <div className="flex items-center gap-2">
                      <span className="text-body-medium font-semibold text-text-primary">Microsoft Teams</span>
                      {user.teamsMeetingUrl ? (
                        <Chip color="lime" variant="caption">Configured</Chip>
                      ) : (
                        <Chip color="soft" variant="caption">Not Configured</Chip>
                      )}
                    </div>
                    <span className="text-body-2-regular text-text-secondary">
                      Use your organization or personal Microsoft Teams meeting link for guest bookings.
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-2 pt-1">
                <label className="text-body-2-medium text-text-secondary">
                  Teams Meeting URL
                </label>
                <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                  <Input
                    value={teamsUrl}
                    onChange={(val) => setTeamsUrl(val)}
                    placeholder="https://teams.microsoft.com/l/meetup-join/..."
                    className="flex-1"
                  />
                  <div className="flex items-center gap-2">
                    <Button
                      variant="secondary"
                      size="medium"
                      className="flex-1 sm:flex-initial"
                      disabled={isSavingTeams || teamsUrl === user.teamsMeetingUrl}
                      onClick={handleSaveTeamsLink}
                    >
                      {isSavingTeams ? "Saving..." : "Save"}
                    </Button>
                    {teamsUrl && (
                      <Button
                        variant="ghost"
                        size="medium"
                        className="flex-1 sm:flex-initial"
                        onClick={() => window.open(teamsUrl, "_blank")}
                      >
                        Test Room
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 3: WORKING HOURS & AVAILABILITY */}
        {/* ========================================================================= */}
        {activeTab === "availability" && (
          <div className="flex flex-col gap-6">
            <div className="rounded-3xl border border-border-button-default bg-background-primary-default p-6 flex flex-col gap-5 shadow-2xs">
              <div className="flex items-center justify-between pb-4 border-b border-border-button-default">
                <div className="flex flex-col">
                  <span className="text-title-2-medium text-text-primary">Weekly Schedule</span>
                  <span className="text-body-2-regular text-text-secondary">
                    Set your available window for each day of the week. Times are in {timezone}.
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="small"
                  onClick={handleCopyMondayToWeekdays}
                >
                  Copy Mon to Weekdays
                </Button>
              </div>

              <div className="flex flex-col divide-y divide-border-button-default">
                {days.map((day, idx) => (
                  <div key={day.dayOfWeek} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-3 w-36">
                      <Switch
                        isSelected={day.isEnabled}
                        onChange={(enabled) => {
                          setDays((prev) =>
                            prev.map((d, i) => (i === idx ? { ...d, isEnabled: enabled } : d))
                          );
                        }}
                        aria-label={`Enable ${day.dayName}`}
                      />
                      <span className={cx(
                        "text-body-medium font-medium",
                        day.isEnabled ? "text-text-primary" : "text-text-tertiary"
                      )}>
                        {day.dayName}
                      </span>
                    </div>

                    {day.isEnabled ? (
                      <div className="flex items-center gap-2">
                        <select
                          value={day.startTime}
                          onChange={(e) => {
                            const val = e.target.value;
                            setDays((prev) =>
                              prev.map((d, i) => (i === idx ? { ...d, startTime: val } : d))
                            );
                          }}
                          className="px-2.5 py-1.5 rounded-xl border border-border-button-default bg-background-secondary-default text-text-primary text-body-medium focus:outline-none"
                        >
                          {TIME_OPTIONS.map((t) => (
                            <option key={t.value} value={t.value}>{t.label}</option>
                          ))}
                        </select>
                        <span className="text-text-tertiary text-body-2-regular">to</span>
                        <select
                          value={day.endTime}
                          onChange={(e) => {
                            const val = e.target.value;
                            setDays((prev) =>
                              prev.map((d, i) => (i === idx ? { ...d, endTime: val } : d))
                            );
                          }}
                          className="px-2.5 py-1.5 rounded-xl border border-border-button-default bg-background-secondary-default text-text-primary text-body-medium focus:outline-none"
                        >
                          {TIME_OPTIONS.map((t) => (
                            <option key={t.value} value={t.value}>{t.label}</option>
                          ))}
                        </select>
                      </div>
                    ) : (
                      <span className="text-caption-1-medium text-text-tertiary italic">Unavailable</span>
                    )}
                  </div>
                ))}
              </div>

              <div className="flex justify-end pt-3 border-t border-border-button-default">
                <Button
                  variant="primary"
                  size="medium"
                  disabled={isSavingDays}
                  onClick={handleSaveWorkingHours}
                >
                  {isSavingDays ? "Saving..." : "Save Working Hours"}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 4: VIRTUAL OFFICE SETTINGS */}
        {/* ========================================================================= */}
        {activeTab === "office" && (
          <div className="flex flex-col gap-6">
            <div className="rounded-3xl border border-border-button-default bg-background-primary-default p-6 flex flex-col gap-5 shadow-2xs">
              <div className="flex flex-col gap-1 pb-4 border-b border-border-button-default">
                <span className="text-title-2-medium text-text-primary">Virtual Office Drop-in Rules</span>
                <p className="text-body-2-regular text-text-secondary">
                  Configure live speed-chats, doorbell rings, and instant walk-in availability.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-body-2-medium text-text-secondary">Speed-Chat Duration</label>
                  <select
                    value={speedChatMins}
                    onChange={(e) => setSpeedChatMins(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-xl border border-border-button-default bg-background-primary-default text-text-primary text-body-medium focus:outline-none"
                  >
                    <option value={5}>5 minutes (Quick check-in)</option>
                    <option value={10}>10 minutes (Standard speed-chat)</option>
                    <option value={15}>15 minutes (Deep-dive consult)</option>
                    <option value={20}>20 minutes (Extended drop-in)</option>
                  </select>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-body-2-medium text-text-secondary">Office Topic / Focus Banner</label>
                  <Input
                    value={officeTopic}
                    onChange={(val) => setOfficeTopic(val)}
                    placeholder="e.g. Open for design critiques & mentorship"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between p-4 rounded-2xl bg-background-secondary-default border border-border-button-default">
                <div className="flex flex-col">
                  <span className="text-body-medium font-semibold text-text-primary">Doorbell Email Alerts</span>
                  <span className="text-caption-1-medium text-text-secondary">
                    Receive an immediate email notification when someone knocks while you are busy.
                  </span>
                </div>
                <Switch
                  isSelected={notifyEmail}
                  onChange={setNotifyEmail}
                  aria-label="Email Doorbell Alerts"
                />
              </div>

              <div className="flex items-center justify-between p-4 rounded-2xl bg-background-secondary-default border border-border-button-default">
                <div className="flex flex-col">
                  <span className="text-body-medium font-semibold text-text-primary">Auto-schedule Drop-in Hours</span>
                  <span className="text-caption-1-medium text-text-secondary">
                    Automatically flip your office to Open on weekdays between 2:00 PM and 4:00 PM.
                  </span>
                </div>
                <Switch
                  isSelected={autoSchedule}
                  onChange={setAutoSchedule}
                  aria-label="Auto-schedule Drop-in Hours"
                />
              </div>

              <div className="flex justify-end pt-3 border-t border-border-button-default">
                <Button
                  variant="primary"
                  size="medium"
                  disabled={isSavingOffice}
                  onClick={handleSaveOfficeSettings}
                >
                  {isSavingOffice ? "Saving..." : "Save Office Rules"}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 5: APPEARANCE STUDIO */}
        {/* ========================================================================= */}
        {activeTab === "appearance" && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
            {/* Left Column: Preset Colors & Custom Hex */}
            <div className="rounded-3xl border border-border-button-default bg-background-primary-default p-6 flex flex-col gap-5 shadow-2xs">
              <div className="flex flex-col gap-1 pb-3 border-b border-border-button-default">
                <span className="text-title-2-medium text-text-primary">Brand Accent Color</span>
                <p className="text-body-2-regular text-text-secondary">
                  Customize the highlight color that appears on your public booking cards, time slot selection, and buttons.
                </p>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {PRESET_COLORS.map((preset) => (
                  <button
                    key={preset.hex}
                    type="button"
                    onClick={() => {
                      setBrandColor(preset.hex);
                      setCustomHex(preset.hex);
                      handleSaveAppearance(preset.hex);
                    }}
                    className={cx(
                      "flex items-center gap-2.5 p-3 rounded-2xl border text-start transition-all cursor-pointer",
                      brandColor.toLowerCase() === preset.hex.toLowerCase()
                        ? "border-accent-500 bg-background-secondary-hover shadow-2xs ring-1 ring-accent-500"
                        : "border-border-button-default bg-background-secondary-default hover:bg-background-secondary-hover"
                    )}
                  >
                    <span
                      className="size-5 rounded-full shrink-0 shadow-xs border border-white/20"
                      style={{ backgroundColor: preset.hex }}
                    />
                    <span className="text-caption-1-medium text-text-primary truncate">{preset.name}</span>
                  </button>
                ))}
              </div>

              <div className="flex flex-col gap-2 pt-2">
                <label className="text-body-2-medium text-text-secondary">Custom Hex Code</label>
                <div className="flex items-center gap-2">
                  <div className="relative flex items-center flex-1">
                    <span
                      className="absolute left-3 size-4 rounded-full border border-border-button-default shrink-0"
                      style={{ backgroundColor: customHex }}
                    />
                    <Input
                      value={customHex}
                      onChange={(val) => {
                        setCustomHex(val);
                        if (/^#[0-9A-Fa-f]{6}$/.test(val)) {
                          setBrandColor(val);
                          handleSaveAppearance(val);
                        }
                      }}
                      placeholder="#2563EB"
                      className="pl-9 font-mono"
                    />
                  </div>
                  <Button
                    variant="secondary"
                    size="medium"
                    disabled={isSavingAppearance || !/^#[0-9A-Fa-f]{6}$/.test(customHex)}
                    onClick={() => handleSaveAppearance(customHex)}
                  >
                    Apply
                  </Button>
                </div>
              </div>
            </div>

            {/* Right Column: Live Booking Card Preview */}
            <div className="rounded-3xl border border-border-button-default bg-background-primary-default p-6 flex flex-col gap-4 shadow-2xs">
              <div className="flex items-center justify-between pb-3 border-b border-border-button-default">
                <span className="text-title-2-medium text-text-primary">Live Card Preview</span>
                <Chip color="soft" variant="caption">Guest Perspective</Chip>
              </div>

              <div className="rounded-2xl border border-border-button-default bg-background-secondary-default p-5 flex flex-col gap-4">
                <div className="flex items-center gap-3.5">
                  <div
                    className="size-12 rounded-full flex items-center justify-center font-bold text-white shadow-sm"
                    style={{ backgroundColor: brandColor }}
                  >
                    {user.initials}
                  </div>
                  <div className="flex flex-col">
                    <span className="text-body-medium font-semibold text-text-primary">{name || "Your Name"}</span>
                    <span className="text-caption-1-medium text-text-secondary">usemorrow.xyz/{slug}</span>
                  </div>
                </div>

                <p className="text-body-2-regular text-text-secondary italic">
                  &ldquo;{welcomeMessage}&rdquo;
                </p>

                <div className="pt-3 border-t border-border-button-default flex items-center justify-between">
                  <span className="text-caption-1-medium text-text-primary font-semibold">30 Min Consultation</span>
                  <div
                    className="px-3 py-1.5 rounded-xl text-caption-1-medium font-semibold text-white shadow-xs"
                    style={{ backgroundColor: brandColor }}
                  >
                    Book Slot
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </DirectionProvider>
  );
}