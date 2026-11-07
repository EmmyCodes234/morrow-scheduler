"use client";

import { useState, useEffect, useCallback } from "react";
import { DashboardSidebar, type DashboardNavItem } from "@/components/application/dashboard/dashboard-sidebar";
import { Button } from "@/components/base/buttons/button";
import { Avatar } from "@/components/base/avatar/avatar";
import { Badge } from "@/components/base/badges/badge";
import { Chip } from "@/components/base/badges/chip";
import { Switch } from "@/components/base/switch/switch";
import { SwitchCard } from "@/components/base/switch/switch-card";
import { cx } from "@/utils/cx";
import { GoogleCalendarIcon } from "@/components/icons/google-calendar";
import { GoogleMeetIcon } from "@/components/icons/google-meet";
import { ZoomIcon } from "@/components/icons/zoom";
import { MicrosoftTeamsIcon } from "@/components/icons/microsoft-teams";
import {
  HugeCalendar,
  HugeClock,
  HugeVideo,
  HugeCopy,
  HugeCheck,
  HugeAdd,
  HugeSettings,
  HugeEdit,
  HugeVerified,
  HugeGlobe,
  HugeLink,
  HugeUser,
  HugeCheckIn,
  HugeDashboard,
  HugeAnalytics,
  HugeContacts,
  HugeArrowRight,
  HugeSidebar,
  HugeSparkles,
} from "@/components/icons/hugeicons";
import { ProductTour } from "@/components/application/dashboard/product-tour";
import { NewEventModal, type EventFormData } from "@/components/scheduling/modals/new-event-modal";
import { RescheduleModal } from "@/components/scheduling/modals/reschedule-modal";
import { ZoomModal } from "@/components/scheduling/modals/zoom-modal";
import { TeamsModal } from "@/components/scheduling/modals/teams-modal";
import { GCalModal } from "@/components/scheduling/modals/gcal-modal";
import { MorrowLogo, MorrowIcon } from "@/components/brand/morrow-logo";
import { HostOfficeView } from "@/components/office/host-office-view";
import { DoorbellAlertModal, type OfficeKnock } from "@/components/office/doorbell-alert-modal";
import { OfficeStatusPill } from "@/components/office/office-status-pill";
import { DashboardAnalyticsView } from "@/components/analytics/dashboard-analytics-view";
import { useMorrowRealtime } from "@/lib/realtime/use-realtime";
import { playDoorbellChime, playBookingChime, playCancelChime } from "@/lib/audio/chime";
import { UnifiedSettingsView, type SettingsTab } from "@/components/settings/unified-settings-view";
import { DashboardBottomNav } from "@/components/application/dashboard/dashboard-bottom-nav";

interface EventTypeItem {
  id: string;
  title: string;
  slug: string;
  duration: number;
  description?: string;
  location: string;
  locationType?: "google_meet" | "zoom" | "teams" | "in_person" | "phone";
  active: boolean;
  maxAttendees?: number;
  showRemainingSpots?: boolean;
}

interface BookingItem {
  id: string;
  guestName: string;
  guestEmail: string;
  eventTitle: string;
  date: string;
  time: string;
  meetLink?: string;
  roomToken?: string;
  status: "Confirmed" | "Completed" | "Cancelled" | string;
  isGroup?: boolean;
  maxAttendees?: number;
  attendeeCount?: number;
  duration?: number;
  createdAt?: string;
  attendees?: Array<{
    id: string;
    guestName: string;
    guestEmail: string;
    guestNotes?: string | null;
  }>;
}

interface ContactItem {
  id: string;
  name: string;
  email: string;
  totalBookings: number;
  lastBookingAt: string;
  notes?: string;
}

interface WorkingDay {
  dayOfWeek: number; // 1 = Mon ... 6 = Sat, 0 = Sun
  dayName: string;
  startTime: string;
  endTime: string;
  isEnabled: boolean;
}

const DEFAULT_DAYS: WorkingDay[] = [
  { dayOfWeek: 1, dayName: "Monday", startTime: "09:00", endTime: "17:00", isEnabled: true },
  { dayOfWeek: 2, dayName: "Tuesday", startTime: "09:00", endTime: "17:00", isEnabled: true },
  { dayOfWeek: 3, dayName: "Wednesday", startTime: "09:00", endTime: "17:00", isEnabled: true },
  { dayOfWeek: 4, dayName: "Thursday", startTime: "09:00", endTime: "17:00", isEnabled: true },
  { dayOfWeek: 5, dayName: "Friday", startTime: "09:00", endTime: "17:00", isEnabled: true },
  { dayOfWeek: 6, dayName: "Saturday", startTime: "09:00", endTime: "17:00", isEnabled: false },
  { dayOfWeek: 0, dayName: "Sunday", startTime: "09:00", endTime: "17:00", isEnabled: false },
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

export interface DashboardViewProps {
  onOpenNewEventModal?: () => void;
  onOpenRescheduleModal?: (booking: BookingItem) => void;
  onPreviewPublicBooking?: () => void;
  initialUser?: HostUser;
}

export interface HostUser {
  id: string;
  name: string;
  email: string;
  slug: string;
  initials: string;
  timezone: string;
  avatarUrl?: string | null;
  brandColor?: string | null;
  welcomeMessage?: string | null;
  defaultLocationType?: string;
  zoomMeetingUrl?: string;
  teamsMeetingUrl?: string;
  zoomEmail?: string | null;
  zoomConnectedAt?: Date | string | null;
  hasZoomOAuth?: boolean;
  hasGoogleCalendar?: boolean;
  officeStatus?: "open" | "busy" | "closed";
  officeTopic?: string | null;
  officeSpeedChatMins?: number;
  officeNotifyEmail?: boolean;
  officeAutoSchedule?: boolean;
  officeScheduleDays?: number[] | null;
  officeScheduleStart?: string | null;
  officeScheduleEnd?: string | null;
}

export function DashboardView({
  onOpenNewEventModal: externalOpenNewEvent,
  onOpenRescheduleModal: externalOpenReschedule,
  onPreviewPublicBooking,
  initialUser,
}: DashboardViewProps) {
  const [activeTab, setActiveTab] = useState<string>("events");
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("profile");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(!initialUser);

  // Dynamic user profile from Neon
  const [user, setUser] = useState<HostUser | null>(initialUser || null);

  // Event types from Neon
  const [eventTypes, setEventTypes] = useState<EventTypeItem[]>([]);

  // Bookings from Neon
  const [bookings, setBookings] = useState<BookingItem[]>([]);
  const [contacts, setContacts] = useState<ContactItem[]>([]);

  // Office Hours Knocks & Doorbell state
  const [officeKnocks, setOfficeKnocks] = useState<OfficeKnock[]>([]);

  // Working hours
  const [workingDays, setWorkingDays] = useState<WorkingDay[]>(DEFAULT_DAYS);
  const [isSavingHours, setIsSavingHours] = useState(false);
  const [hoursSavedSuccess, setHoursSavedSuccess] = useState(false);

  // Modals state
  const [isNewEventOpen, setIsNewEventOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<EventTypeItem | null>(null);
  const [isZoomModalOpen, setIsZoomModalOpen] = useState(false);
  const [isTeamsModalOpen, setIsTeamsModalOpen] = useState(false);
  const [isGCalModalOpen, setIsGCalModalOpen] = useState(false);
  const [isRescheduleOpen, setIsRescheduleOpen] = useState(false);
  const [activeBooking, setActiveBooking] = useState<BookingItem | null>(null);

  // Status message
  const [statusNotification, setStatusNotification] = useState<string | null>(null);

  // Interactive Onboarding Tour state
  const [tourOpen, setTourOpen] = useState(false);

  useEffect(() => {
    try {
      const completed = localStorage.getItem("morrow_tour_completed_v1");
      if (!completed) {
        const t = setTimeout(() => setTourOpen(true), 1000);
        return () => clearTimeout(t);
      }
    } catch {}
  }, []);

  const showNotification = (msg: string) => {
    setStatusNotification(msg);
    setTimeout(() => setStatusNotification(null), 3000);
  };

  // Realtime by Default: Comprehensive host subscriptions across all features
  const { isConnected: isRealtimeConnected } = useMorrowRealtime({
    channels: user?.id ? [`host:${user.id}`] : [],
    enabled: Boolean(user?.id),
    onEvent: (event) => {
      if (event.type === "booking.created") {
        setBookings((prev) => {
          if (prev.some((b) => b.id === event.payload.id)) return prev;
          return [event.payload, ...prev];
        });
        showNotification(`New booking from ${event.payload.guestName || "guest"}!`);
        playBookingChime();
      } else if (event.type === "booking.cancelled") {
        setBookings((prev) =>
          prev.map((b) => (b.id === event.payload.id ? { ...b, status: "Cancelled" } : b))
        );
        showNotification(`Booking cancelled by ${event.payload.guestName || "guest"}`);
        playCancelChime();
      } else if (event.type === "event_type.created") {
        const et = event.payload;
        setEventTypes((prev) => {
          if (prev.some((e) => e.id === et.id)) return prev;
          return [
            {
              id: et.id,
              title: et.title,
              slug: et.slug,
              duration: et.durationMins || 30,
              description: et.description || "",
              location: et.locationType === "zoom" ? "Zoom Meetings" : et.locationType === "teams" ? "Microsoft Teams" : "Google Meet",
              locationType: et.locationType || "google_meet",
              active: et.isActive ?? true,
              maxAttendees: et.maxAttendees || 1,
              showRemainingSpots: et.showRemainingSpots ?? true,
            },
            ...prev,
          ];
        });
        showNotification(`Event type created: ${et.title}`);
      } else if (event.type === "event_type.updated") {
        const et = event.payload;
        setEventTypes((prev) =>
          prev.map((e) => {
            if (e.id === et.id) {
              return {
                ...e,
                title: et.title !== undefined ? et.title : e.title,
                slug: et.slug !== undefined ? et.slug : e.slug,
                duration: et.durationMins !== undefined ? et.durationMins : e.duration,
                description: et.description !== undefined ? et.description : e.description,
                locationType: et.locationType !== undefined ? et.locationType : e.locationType,
                active: et.isActive !== undefined ? et.isActive : e.active,
                maxAttendees: et.maxAttendees !== undefined ? et.maxAttendees : e.maxAttendees,
                showRemainingSpots: et.showRemainingSpots !== undefined ? et.showRemainingSpots : e.showRemainingSpots,
              };
            }
            return e;
          })
        );
      } else if (event.type === "event_type.deleted") {
        setEventTypes((prev) => prev.filter((e) => e.id !== event.payload.id));
        showNotification("Event type removed");
      } else if (event.type === "user.updated") {
        setUser((prev) => (prev ? { ...prev, ...event.payload } : prev));
      } else if (event.type === "availability.updated") {
        loadAvailability();
      } else if (event.type === "knock.created") {
        setOfficeKnocks((prev) => {
          if (prev.some((k) => k.id === event.payload.id)) return prev;
          return [event.payload, ...prev];
        });
        if (event.payload.status === "ringing") {
          playDoorbellChime();
        }
      } else if (event.type === "knock.updated") {
        setOfficeKnocks((prev) =>
          prev.map((k) => (k.id === event.payload.id ? { ...k, ...event.payload } : k))
        );
      } else if (event.type === "knock.cancelled") {
        setOfficeKnocks((prev) => prev.filter((k) => k.id !== event.payload.id));
      } else if (event.type === "office.status_changed") {
        setUser((prev) => (prev ? { ...prev, ...event.payload } : prev));
      }
    },
  });

  const loadUserData = () => {
    // 1. Fetch authenticated user profile
    fetch("/api/user/me")
      .then((res) => {
        if (res.status === 401) {
          window.location.href = "/login";
          return null;
        }
        return res.json();
      })
      .then((data) => {
        if (data && data.user) {
          const initials = data.user.name
            ? data.user.name
                .split(" ")
                .filter(Boolean)
                .map((n: string) => n[0])
                .join("")
                .slice(0, 2)
                .toUpperCase()
            : "U";

          setUser({
            id: data.user.id,
            name: data.user.name,
            email: data.user.email,
            slug: data.user.slug,
            initials: initials || "U",
            timezone: data.user.timezone || "UTC",
            avatarUrl: data.user.avatarUrl,
            brandColor: data.user.brandColor,
            welcomeMessage: data.user.welcomeMessage,
            defaultLocationType: data.user.defaultLocationType || "google_meet",
            zoomMeetingUrl: data.user.zoomMeetingUrl || "",
            teamsMeetingUrl: data.user.teamsMeetingUrl || "",
            zoomEmail: data.user.zoomEmail || null,
            zoomConnectedAt: data.user.zoomConnectedAt || null,
            hasZoomOAuth: Boolean(data.user.hasZoomOAuth),
            hasGoogleCalendar: data.user.hasGoogleCalendar ?? true,
            officeStatus: data.user.officeStatus || "closed",
            officeTopic: data.user.officeTopic || null,
            officeSpeedChatMins: data.user.officeSpeedChatMins || 10,
            officeNotifyEmail: data.user.officeNotifyEmail !== false,
            officeAutoSchedule: Boolean(data.user.officeAutoSchedule),
            officeScheduleDays: data.user.officeScheduleDays || [1, 2, 3, 4, 5],
            officeScheduleStart: data.user.officeScheduleStart || "14:00",
            officeScheduleEnd: data.user.officeScheduleEnd || "16:00",
          });
        }
        setIsLoading(false);
      })
      .catch((err) => {
        console.error("Error loading user profile:", err);
        setIsLoading(false);
      });
  };

  const loadEventTypes = () => {
    fetch("/api/event-types")
      .then((res) => res.json())
      .then((data) => {
        if (data.eventTypes && Array.isArray(data.eventTypes)) {
          setEventTypes(
            data.eventTypes.map((et: { id: string; title: string; slug: string; durationMins?: number; description?: string; locationType?: string; isActive?: boolean; maxAttendees?: number; showRemainingSpots?: boolean }) => ({
              id: et.id,
              title: et.title,
              slug: et.slug,
              duration: et.durationMins || 30,
              description: et.description || "",
              location: et.locationType === "zoom" ? "Zoom Meetings" : et.locationType === "teams" ? "Microsoft Teams" : et.locationType === "phone" ? "Phone Call" : et.locationType === "in_person" ? "In Person" : "Google Meet",
              locationType: et.locationType || "google_meet",
              active: et.isActive ?? true,
              maxAttendees: et.maxAttendees || 1,
              showRemainingSpots: et.showRemainingSpots ?? true,
            }))
          );
        }
      })
      .catch((err) => console.error("Error loading event types:", err));
  };

  const loadBookings = () => {
    fetch("/api/bookings")
      .then((res) => res.json())
      .then((data) => {
        if (data.bookings && Array.isArray(data.bookings)) {
          setBookings(data.bookings);
        }
      })
      .catch((err) => console.error("Error loading bookings:", err));
  };

  const loadContacts = () => {
    fetch("/api/contacts")
      .then((res) => res.json())
      .then((data) => {
        if (data.contacts && Array.isArray(data.contacts)) {
          setContacts(data.contacts);
        }
      })
      .catch((err) => console.error("Error loading contacts:", err));
  };

  const loadAvailability = () => {
    fetch("/api/availability")
      .then((res) => res.json())
      .then((data) => {
        if (data.availability && Array.isArray(data.availability) && data.availability.length > 0) {
          const map = new Map<number, { dayOfWeek: number; isEnabled: boolean; startTime: string; endTime: string }>();
          data.availability.forEach((row: { dayOfWeek: number; isEnabled: boolean; startTime: string; endTime: string }) => {
            map.set(row.dayOfWeek, row);
          });

          setWorkingDays((prev) =>
            prev.map((d) => {
              const found = map.get(d.dayOfWeek);
              if (found) {
                return {
                  ...d,
                  startTime: found.startTime || "09:00",
                  endTime: found.endTime || "17:00",
                  isEnabled: found.isEnabled ?? true,
                };
              }
              return d;
            })
          );
        }
      })
      .catch((err) => console.error("Error loading availability:", err));
  };

  const loadOfficeState = useCallback(async () => {
    try {
      const res = await fetch("/api/user/office");
      if (!res.ok) return;
      const data = await res.json();
      if (data.knocks && Array.isArray(data.knocks)) {
        setOfficeKnocks(data.knocks);
      }
      if (data.officeStatus) {
        setUser((prev) =>
          prev
            ? {
                ...prev,
                officeStatus: data.officeStatus,
                officeTopic: data.officeTopic ?? prev.officeTopic,
                officeSpeedChatMins: data.officeSpeedChatMins ?? prev.officeSpeedChatMins,
                officeNotifyEmail: data.officeNotifyEmail ?? prev.officeNotifyEmail,
                officeAutoSchedule: data.officeAutoSchedule ?? prev.officeAutoSchedule,
                officeScheduleDays: data.officeScheduleDays ?? prev.officeScheduleDays,
                officeScheduleStart: data.officeScheduleStart ?? prev.officeScheduleStart,
                officeScheduleEnd: data.officeScheduleEnd ?? prev.officeScheduleEnd,
              }
            : null
        );
      }
    } catch (err) {
      console.error("Error loading office state:", err);
    }
  }, []);

  useEffect(() => {
    loadUserData();
    loadEventTypes();
    loadBookings();
    loadContacts();
    loadAvailability();
    loadOfficeState();
  }, [loadOfficeState]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        loadOfficeState();
      }
    }, 3500);
    return () => clearInterval(interval);
  }, [loadOfficeState]);

  // Office hours actions
  const handleAdmitKnock = async (knockId: string): Promise<string | null> => {
    try {
      const res = await fetch(`/api/office/knock/${knockId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "admit" }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        showNotification(err.error || "Failed to admit knock");
        return null;
      }
      const data = await res.json();
      showNotification("Visitor admitted into office");
      loadOfficeState();
      return data.meetLink || null;
    } catch (err) {
      console.error("Error admitting knock:", err);
      showNotification("Failed to admit visitor");
      return null;
    }
  };

  const handleDeclineKnock = async (knockId: string): Promise<void> => {
    try {
      const res = await fetch(`/api/office/knock/${knockId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "decline" }),
      });
      if (!res.ok) throw new Error("Failed to decline knock");
      showNotification("Knock redirected to calendar");
      loadOfficeState();
    } catch (err) {
      console.error("Error declining knock:", err);
      showNotification("Failed to decline knock");
    }
  };

  const handleConcludeKnock = async (knockId: string): Promise<void> => {
    try {
      const res = await fetch(`/api/office/knock/${knockId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "conclude" }),
      });
      if (!res.ok) throw new Error("Failed to conclude chat");
      showNotification("Speed chat concluded");
      loadOfficeState();
    } catch (err) {
      console.error("Error concluding knock:", err);
      showNotification("Failed to conclude chat");
    }
  };

  const handleUpdateOfficeSettings = async (settings: {
    officeStatus?: "open" | "busy" | "closed";
    officeTopic?: string;
    officeSpeedChatMins?: number;
    officeNotifyEmail?: boolean;
    officeAutoSchedule?: boolean;
    officeScheduleDays?: number[];
    officeScheduleStart?: string;
    officeScheduleEnd?: string;
  }): Promise<void> => {
    try {
      const res = await fetch("/api/user/office", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      if (!res.ok) throw new Error("Failed to update office settings");
      const data = await res.json();
      if (data.user) {
        setUser((prev) =>
          prev
            ? {
                ...prev,
                officeStatus: data.user.officeStatus,
                officeTopic: data.user.officeTopic,
                officeSpeedChatMins: data.user.officeSpeedChatMins,
                officeNotifyEmail: data.user.officeNotifyEmail,
                officeAutoSchedule: data.user.officeAutoSchedule,
                officeScheduleDays: data.user.officeScheduleDays,
                officeScheduleStart: data.user.officeScheduleStart,
                officeScheduleEnd: data.user.officeScheduleEnd,
              }
            : null
        );
      }
      showNotification("Office hours updated");
    } catch (err) {
      console.error("Error updating office settings:", err);
      showNotification("Failed to update office settings");
    }
  };

  const handleCopy = (id: string, path: string) => {
    if (!user) return;
    const url = path ? `https://usemorrow.xyz/${user.slug}/${path}` : `https://usemorrow.xyz/${user.slug}`;
    navigator.clipboard.writeText(url);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const toggleEventActive = async (id: string, currentActive: boolean) => {
    const nextActive = !currentActive;
    setEventTypes((prev) =>
      prev.map((e) => (e.id === id ? { ...e, active: nextActive } : e))
    );

    try {
      const res = await fetch(`/api/event-types/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: nextActive }),
      });
      if (!res.ok) throw new Error("Failed to persist status");
      showNotification(`Event ${nextActive ? "activated" : "deactivated"}`);
    } catch (err) {
      console.error("Error toggling event active:", err);
      // Revert on failure
      setEventTypes((prev) =>
        prev.map((e) => (e.id === id ? { ...e, active: currentActive } : e))
      );
    }
  };

  const handleOpenPublicPage = () => {
    if (!user) return;
    window.open(`/${user.slug}`, "_blank");
  };

  // Zoom management
  const handleSaveZoom = async (url: string, setActive: boolean) => {
    const res = await fetch("/api/user/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...(url !== undefined ? { zoomMeetingUrl: url } : {}),
        defaultLocationType: setActive ? "zoom" : "google_meet",
      }),
    });
    if (!res.ok) throw new Error("Failed to save Zoom details");
    const data = await res.json();
    if (data.user) {
      setUser((prev) =>
        prev
          ? {
              ...prev,
              zoomMeetingUrl: data.user.zoomMeetingUrl,
              defaultLocationType: data.user.defaultLocationType,
              zoomEmail: data.user.zoomEmail ?? prev.zoomEmail,
              hasZoomOAuth: data.user.hasZoomOAuth ?? prev.hasZoomOAuth,
            }
          : null
      );
    }
    showNotification(setActive ? "Zoom configured as default provider" : "Zoom details updated");
  };

  const handleDisconnectZoomOAuth = async () => {
    const res = await fetch("/api/integrations/zoom/disconnect", { method: "POST" });
    if (!res.ok) throw new Error("Failed to disconnect Zoom account");
    setUser((prev) =>
      prev
        ? {
            ...prev,
            zoomEmail: null,
            hasZoomOAuth: false,
            defaultLocationType: prev.defaultLocationType === "zoom" ? "google_meet" : prev.defaultLocationType,
          }
        : null
    );
    showNotification("Zoom OAuth disconnected");
  };

  // Teams management
  const handleSaveTeams = async (url: string, setActive: boolean) => {
    const res = await fetch("/api/user/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        teamsMeetingUrl: url,
        defaultLocationType: setActive ? "teams" : "google_meet",
      }),
    });
    if (!res.ok) throw new Error("Failed to save Teams details");
    const data = await res.json();
    if (data.user) {
      setUser((prev) =>
        prev
          ? {
              ...prev,
              teamsMeetingUrl: data.user.teamsMeetingUrl,
              defaultLocationType: data.user.defaultLocationType,
              zoomEmail: data.user.zoomEmail ?? prev.zoomEmail,
              hasZoomOAuth: data.user.hasZoomOAuth ?? prev.hasZoomOAuth,
              zoomConnectedAt: data.user.zoomConnectedAt ?? prev.zoomConnectedAt,
            }
          : null
      );
    }
    showNotification("Microsoft Teams configured as default provider");
  };

  const handleSwitchToGoogleMeet = async () => {
    const res = await fetch("/api/user/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        defaultLocationType: "google_meet",
      }),
    });
    if (!res.ok) throw new Error("Failed to switch provider");
    const data = await res.json();
    if (data.user) {
      setUser((prev) =>
        prev
          ? {
              ...prev,
              defaultLocationType: data.user.defaultLocationType,
              zoomEmail: data.user.zoomEmail ?? prev.zoomEmail,
              hasZoomOAuth: data.user.hasZoomOAuth ?? prev.hasZoomOAuth,
              zoomConnectedAt: data.user.zoomConnectedAt ?? prev.zoomConnectedAt,
            }
          : null
      );
    }
    showNotification("Switched default video conferencing to Google Meet");
  };

  // Save Working Hours
  const handleSaveWorkingHours = async () => {
    setIsSavingHours(true);
    setHoursSavedSuccess(false);
    try {
      const res = await fetch("/api/availability", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          days: workingDays.map((d) => ({
            dayOfWeek: d.dayOfWeek,
            startTime: d.startTime,
            endTime: d.endTime,
            isEnabled: d.isEnabled,
          })),
          timezone: user?.timezone,
        }),
      });
      if (!res.ok) throw new Error("Failed to save hours");
      setHoursSavedSuccess(true);
      setTimeout(() => setHoursSavedSuccess(false), 2500);
      showNotification("Working hours successfully updated");
    } catch (err) {
      console.error("Error saving working hours:", err);
    } finally {
      setIsSavingHours(false);
    }
  };

  // Event modal actions
  const handleSaveEvent = async (data: EventFormData) => {
    if (data.id) {
      // Edit existing
      const res = await fetch(`/api/event-types/${data.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: data.title,
          slug: data.slug,
          durationMins: data.duration,
          description: data.description,
          locationType: data.locationType || "google_meet",
          maxAttendees: data.maxAttendees ?? 1,
          showRemainingSpots: data.showRemainingSpots ?? true,
        }),
      });
      if (res.ok) {
        loadEventTypes();
        showNotification("Event type updated");
      }
    } else {
      // Create new
      const res = await fetch("/api/event-types", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: data.title,
          slug: data.slug,
          durationMins: data.duration,
          description: data.description,
          locationType: data.locationType || user?.defaultLocationType || "google_meet",
          maxAttendees: data.maxAttendees ?? 1,
          showRemainingSpots: data.showRemainingSpots ?? true,
        }),
      });
      if (res.ok) {
        loadEventTypes();
        showNotification("New event type created");
      }
    }
  };

  const handleDeleteEvent = async (id: string) => {
    const res = await fetch(`/api/event-types/${id}`, {
      method: "DELETE",
    });
    if (res.ok) {
      loadEventTypes();
      showNotification("Event type removed");
    }
  };

  // Booking actions
  const handleCancelBooking = async (id: string, reason?: string) => {
    const res = await fetch(`/api/bookings/${id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        status: "cancelled",
        reason: reason?.trim() || undefined,
      }),
    });
    if (res.ok) {
      setBookings((prev) =>
        prev.map((b) => (b.id === id ? { ...b, status: "Cancelled" } : b))
      );
      showNotification("Meeting cancelled");
    } else {
      const errData = await res.json().catch(() => ({}));
      const msg = errData.error || "Failed to cancel meeting";
      showNotification(msg);
      throw new Error(msg);
    }
  };

  // Active unexpired ringing knocks count for badge
  const activeRingingCount = officeKnocks.filter(
    (k) =>
      k.status === "ringing" &&
      (!k.isExpired || !k.expiresAt || new Date(k.expiresAt).getTime() > Date.now())
  ).length;

  // Dedicated sidebar navigation
  const sidebarNavItems: DashboardNavItem[] = [
    {
      key: "events",
      label: "Event types",
      icon: HugeLink,
      badge: eventTypes.length,
      onClick: () => setActiveTab("events"),
    },
    {
      key: "office",
      label: "Office hours",
      icon: HugeCheckIn,
      badge: activeRingingCount > 0 ? `${activeRingingCount} ringing` : user?.officeStatus === "open" ? "Open" : undefined,
      onClick: () => setActiveTab("office"),
    },
    {
      key: "bookings",
      label: "Bookings",
      icon: HugeCalendar,
      badge: bookings.length > 0 ? bookings.length : undefined,
      onClick: () => setActiveTab("bookings"),
    },
    {
      key: "contacts",
      label: "Contacts",
      icon: HugeContacts,
      badge: contacts.length > 0 ? contacts.length : undefined,
      onClick: () => setActiveTab("contacts"),
    },
    {
      key: "analytics",
      label: "Analytics",
      icon: HugeAnalytics,
      onClick: () => setActiveTab("analytics"),
    },
    {
      key: "settings",
      label: "Settings",
      icon: HugeSettings,
      onClick: () => {
        setSettingsTab("profile");
        setActiveTab("settings");
      },
      dataTour: "nav-settings",
    },
    {
      key: "public-page",
      label: "Public booking",
      icon: HugeUser,
      onClick: handleOpenPublicPage,
    },
  ];

  if (isLoading || !user) {
    return (
      <div className="min-h-[70vh] flex flex-col items-center justify-center">
        <MorrowIcon size={44} showBadge={true} className="animate-pulse" />

      </div>
    );
  }

  const isZoomActive = user.defaultLocationType === "zoom";
  const isTeamsActive = user.defaultLocationType === "teams";
  const isGoogleMeetActive = !isZoomActive && !isTeamsActive;

  return (
    <div className="flex flex-col lg:flex-row w-full gap-6 lg:gap-8 items-start relative">
      {/* Toast Notification */}
      {statusNotification && (
        <div className="fixed top-6 right-6 z-50 rounded-2xl border border-border-button-default bg-background-primary-default py-2.5 px-4 shadow-xl flex items-center gap-2.5 text-body-medium text-text-primary animate-in fade-in slide-in-from-top-2">
          <HugeCheck className="size-4 text-status-lime-text shrink-0" />
          <span>{statusNotification}</span>
        </div>
      )}

      {/* MOBILE STICKY FROSTED APP BAR (visible < lg) */}
      <header className="sticky top-0 z-30 flex lg:hidden items-center justify-between h-14 -mx-4 -mt-4 px-4 bg-background-full/85 backdrop-blur-md border-b border-border-button-default w-[calc(100%+2rem)] transition-colors select-none">
        {/* Left: Menu trigger + Brand Logo + Realtime Indicator */}
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            aria-label="Open navigation menu"
            onClick={() => setIsMobileMenuOpen(true)}
            className="p-2 -ms-1 rounded-xl bg-background-secondary-default/80 border border-border-button-default text-text-primary hover:bg-background-secondary-hover active:scale-95 cursor-pointer touch-manipulation"
          >
            <HugeSidebar className="size-4.5" />
          </button>
          <MorrowLogo size={26} />
          <div
            className="flex items-center gap-1 px-2 py-0.5 rounded-full border border-border-button-default bg-background-primary-default/80 text-[11px] font-medium text-text-secondary select-none"
            title={isRealtimeConnected ? "Universal Realtime sync active across all features" : "Connecting to realtime event stream..."}
          >
            <span
              className={cx(
                "size-1.5 rounded-full",
                isRealtimeConnected ? "bg-status-lime-text animate-pulse" : "bg-status-amber-text"
              )}
            />
            <span className="text-caption-2-medium">{isRealtimeConnected ? "Live" : "Syncing"}</span>
          </div>
        </div>

        {/* Right: Compact Office Pill + Avatar Tap Drawer */}
        <div className="flex items-center gap-2">
          <OfficeStatusPill
            compact={true}
            status={user.officeStatus || "closed"}
            slug={user.slug}
            speedChatMins={user.officeSpeedChatMins || 10}
            onUpdateStatus={(newStatus) => handleUpdateOfficeSettings({ officeStatus: newStatus })}
            onUpdateSpeedChatMins={(mins) => handleUpdateOfficeSettings({ officeSpeedChatMins: mins })}
          />
          <button
            type="button"
            aria-label="Open profile and menu"
            onClick={() => setIsMobileMenuOpen(true)}
            className="rounded-full ring-2 ring-transparent hover:ring-accent-500/30 active:scale-95 transition-all cursor-pointer touch-manipulation"
          >
            <Avatar size="sm" initials={user.initials} color="blue" />
          </button>
        </div>
      </header>

      {/* MOBILE DRAWER (overlay) */}
      {isMobileMenuOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden" role="dialog" aria-modal="true">
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-xs transition-opacity"
            onClick={() => setIsMobileMenuOpen(false)}
          />
          <div className="relative flex flex-col w-[280px] max-w-[85vw] h-full bg-background-full p-3 z-10 shadow-2xl">
            <DashboardSidebar
              mobile={true}
              onClose={() => setIsMobileMenuOpen(false)}
              selected={activeTab === "availability" || activeTab === "integrations" ? "settings" : (activeTab as any)}
              items={sidebarNavItems.map((item) => ({
                ...item,
                onClick: () => {
                  item.onClick?.();
                  setIsMobileMenuOpen(false);
                },
              }))}
              user={user}
              onStartTour={() => {
                setIsMobileMenuOpen(false);
                setTourOpen(true);
              }}
              onOpenSettings={() => {
                setIsMobileMenuOpen(false);
                setSettingsTab("profile");
                setActiveTab("settings");
              }}
            />
          </div>
        </div>
      )}

      {/* PERSISTENT DESKTOP BOARDUI SIDEBAR */}
      <DashboardSidebar
        selected={activeTab === "availability" || activeTab === "integrations" ? "settings" : (activeTab as any)}
        items={sidebarNavItems}
        user={user}
        showThemeToggle={false}
        onStartTour={() => setTourOpen(true)}
        onOpenSettings={() => {
          setSettingsTab("profile");
          setActiveTab("settings");
        }}
        className="shrink-0 sticky top-6 h-[calc(100vh-3rem)] hidden lg:flex"
      />

      {/* ACTIVE SECTION CONTENT */}
      <div className="flex-1 min-w-0 flex flex-col gap-6 w-full pb-24 lg:pb-0">
        {/* ========================================================================= */}
        {/* VIEW 1: EVENT TYPES */}
        {/* ========================================================================= */}
        {activeTab === "events" && (
          <div className="flex flex-col gap-8">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-border-button-default">
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <h1 className="text-title-1-medium text-text-primary">Event types</h1>
                  <Chip color="soft" variant="caption">{eventTypes.filter((e) => e.active).length} active</Chip>
                </div>
                <p className="text-body-regular text-text-secondary">
                  Create and manage links for guests to book time on your calendar.
                </p>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center gap-2.5 w-full sm:w-auto">
                <div className="hidden lg:block">
                  <OfficeStatusPill
                    status={user.officeStatus || "closed"}
                    slug={user.slug}
                    speedChatMins={user.officeSpeedChatMins || 10}
                    onUpdateStatus={(newStatus) => handleUpdateOfficeSettings({ officeStatus: newStatus })}
                    onUpdateSpeedChatMins={(mins) => handleUpdateOfficeSettings({ officeSpeedChatMins: mins })}
                  />
                </div>

                <div className="hidden sm:block">
                  <Button
                    variant="ghost"
                    leadingIcon={HugeSparkles}
                    onClick={() => setTourOpen(true)}
                    title="Take a quick tour"
                  >
                    Quick tour
                  </Button>
                </div>

                <div className="grid grid-cols-2 sm:flex sm:items-center gap-2.5 w-full sm:w-auto">
                  <div data-tour="copy-link-btn" className="w-full sm:w-auto">
                    <Button
                      variant="secondary"
                      className="w-full"
                      leadingIcon={copiedId === "profile" ? HugeCheck : HugeCopy}
                      onClick={() => handleCopy("profile", "")}
                    >
                      {copiedId === "profile" ? "Link copied" : "Copy link"}
                    </Button>
                  </div>

                  <div data-tour="new-event-btn" className="w-full sm:w-auto">
                    <Button
                      variant="primary"
                      className="w-full"
                      leadingIcon={HugeAdd}
                      onClick={() => {
                        setEditingEvent(null);
                        setIsNewEventOpen(true);
                      }}
                    >
                      New event
                    </Button>
                  </div>
                </div>
              </div>
            </div>

            {/* KPI Stat Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
              <div className="rounded-2xl border border-border-button-default bg-background-primary-default p-4 sm:p-5 flex flex-col gap-1 shadow-2xs">
                <span className="text-body-2-regular text-text-secondary">Bookings this month</span>
                <div className="flex items-baseline gap-2">
                  <span className="text-title-1-medium text-text-primary">{bookings.length}</span>
                  <Chip color="lime" variant="bold">+100%</Chip>
                </div>
              </div>

              <div className="rounded-2xl border border-border-button-default bg-background-primary-default p-4 sm:p-5 flex flex-col gap-1 shadow-2xs">
                <span className="text-body-2-regular text-text-secondary">Scheduled hours</span>
                <div className="flex items-baseline gap-2">
                  <span className="text-title-1-medium text-text-primary">
                    {(bookings.length * 0.5).toFixed(1)} hrs
                  </span>
                  <Chip color="blue" variant="bold">On track</Chip>
                </div>
              </div>

              <div className="rounded-2xl border border-border-button-default bg-background-primary-default p-4 sm:p-5 flex flex-col gap-1 shadow-2xs">
                <span className="text-body-2-regular text-text-secondary">Completion rate</span>
                <div className="flex items-baseline gap-2">
                  <span className="text-title-1-medium text-text-primary">100%</span>
                  <Chip color="lime" variant="bold">0 no-shows</Chip>
                </div>
              </div>
            </div>

            {/* Event Types Card Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              {eventTypes.map((event, idx) => (
                <div
                  key={event.id}
                  data-tour={idx === 0 ? "event-types-card" : undefined}
                  className={`rounded-3xl border border-border-button-default bg-background-primary-default p-6 flex flex-col justify-between gap-6 hover:border-accent-500/50 transition-all shadow-2xs ${
                    !event.active ? "opacity-60 grayscale-[40%]" : ""
                  }`}
                >
                  <div className="flex flex-col gap-3.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <Chip color="blue" variant="bold">{event.duration} mins</Chip>
                        {event.maxAttendees && event.maxAttendees > 1 ? (
                          <Chip color="purple" variant="bold">Group (max {event.maxAttendees})</Chip>
                        ) : (
                          <Chip color="soft" variant="caption">1-on-1</Chip>
                        )}
                      </div>
                      <Switch
                        isSelected={event.active}
                        onChange={() => toggleEventActive(event.id, event.active)}
                        aria-label={`Toggle ${event.title}`}
                      />
                    </div>

                    <div className="flex flex-col gap-1">
                      <h3 className="text-title-3-semibold text-text-primary">{event.title}</h3>
                      <span className="text-body-2-regular text-text-secondary truncate">
                        usemorrow.xyz/{user.slug}/{event.slug}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 text-body-2-regular text-text-secondary">
                      <HugeVideo className="size-4 shrink-0 text-foreground-icon-secondary" />
                      <span>{event.location || (isZoomActive ? "Zoom Meetings" : isTeamsActive ? "Microsoft Teams" : "Google Meet")}</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-4 border-t border-border-button-default">
                    <Button
                      variant="secondary"
                      size="xs"
                      leadingIcon={copiedId === event.id ? HugeCheck : HugeCopy}
                      onClick={() => handleCopy(event.id, event.slug)}
                    >
                      {copiedId === event.id ? "Copied" : "Copy link"}
                    </Button>

                    <Button
                      variant="ghost"
                      size="xs"
                      leadingIcon={HugeEdit}
                      onClick={() => {
                        setEditingEvent(event);
                        setIsNewEventOpen(true);
                      }}
                    >
                      Edit
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* VIEW 2: BOOKINGS */}
        {/* ========================================================================= */}
        {activeTab === "bookings" && (
          <div className="flex flex-col gap-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-border-button-default">
              <div className="flex flex-col gap-1">
                <h1 className="text-title-1-medium text-text-primary">Bookings</h1>
                <p className="text-body-regular text-text-secondary">
                  Meetings confirmed and scheduled directly onto your calendar.
                </p>
              </div>
            </div>

            {bookings.length === 0 ? (
              <div className="rounded-3xl border border-dashed border-border-button-default p-12 text-center flex flex-col items-center gap-4 bg-background-primary-default">
                <div className="size-12 rounded-full bg-background-secondary-default flex items-center justify-center text-text-secondary">
                  <HugeCalendar className="size-6" />
                </div>
                <div className="flex flex-col gap-1">
                  <h3 className="text-title-3-semibold text-text-primary">No bookings yet</h3>
                  <p className="text-body-regular text-text-secondary max-w-sm">
                    Share your personal booking link with guests to start scheduling meetings.
                  </p>
                </div>
                <Button
                  variant="primary"
                  leadingIcon={HugeCopy}
                  onClick={() => handleCopy("empty", "")}
                >
                  Copy booking link
                </Button>
              </div>
            ) : (
              <div className="rounded-3xl border border-border-button-default bg-background-primary-default overflow-hidden shadow-2xs">
                <div className="divide-y divide-border-button-default">
                  {bookings.map((b) => (
                    <div
                      key={b.id}
                      className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-background-secondary-default/50 transition-colors"
                    >
                      <div className="flex items-center gap-4">
                        <Avatar size="md" initials={b.guestName.charAt(0)} color="blue" />
                        <div className="flex flex-col">
                          <span className="text-body-medium font-semibold text-text-primary">
                            {b.guestName}
                          </span>
                          <span className="text-body-2-regular text-text-secondary">
                            {b.guestEmail}
                          </span>
                        </div>
                      </div>

                      <div className="flex flex-col sm:items-end">
                        <div className="flex items-center gap-2">
                          <span className="text-body-medium font-medium text-text-primary">
                            {b.date} at {b.time}
                          </span>
                          {b.isGroup && (
                            <Chip color="purple" variant="bold">
                              {b.attendeeCount}/{b.maxAttendees} spots
                            </Chip>
                          )}
                        </div>
                        <span className="text-body-2-regular text-text-secondary">
                          {b.eventTitle}
                        </span>
                      </div>

                      <div className="flex items-center justify-between sm:justify-end gap-2 sm:gap-3 w-full sm:w-auto pt-2 sm:pt-0 border-t sm:border-t-0 border-border-button-default/40">
                        <Badge color={b.status === "Cancelled" ? "neutral" : "primary"}>
                          {b.status}
                        </Badge>

                        <div className="flex items-center gap-2">
                          {b.meetLink && b.status !== "Cancelled" && (
                            <Button
                              variant="primary"
                              size="xs"
                              leadingIcon={HugeVideo}
                              onClick={() => window.open(b.meetLink, "_blank")}
                            >
                              {b.meetLink.includes("zoom.us")
                                ? "Join Zoom"
                                : b.meetLink.includes("teams.live.com") || b.meetLink.includes("teams.microsoft.com")
                                ? "Join Teams"
                                : "Join Meet"}
                            </Button>
                          )}

                          {!b.meetLink && b.status !== "Cancelled" && (
                            <Button
                              variant="primary"
                              size="xs"
                              leadingIcon={HugeVideo}
                              onClick={() => {
                                const targetUrl = user?.zoomMeetingUrl || "https://meet.google.com";
                                window.open(targetUrl, "_blank");
                              }}
                            >
                              Join Call
                            </Button>
                          )}

                          {b.status !== "Cancelled" && (
                            <Button
                              variant="secondary"
                              size="xs"
                              onClick={() => {
                                setActiveBooking(b);
                                setIsRescheduleOpen(true);
                              }}
                            >
                              Manage
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ========================================================================= */}
        {/* VIEW 4: CONTACTS */}
        {/* ========================================================================= */}
        {activeTab === "contacts" && (
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-1 pb-6 border-b border-border-button-default">
              <h1 className="text-title-1-medium text-text-primary">Contacts</h1>
              <p className="text-body-regular text-text-secondary">
                Guest directory built automatically as people book meetings with you.
              </p>
            </div>

            {contacts.length === 0 ? (
              <div className="rounded-3xl border border-dashed border-border-button-default p-12 text-center flex flex-col items-center gap-3 bg-background-primary-default">
                <HugeContacts className="size-8 text-text-tertiary" />
                <h3 className="text-title-3-semibold text-text-primary">No contacts yet</h3>
                <p className="text-body-regular text-text-secondary">
                  Guests will appear here automatically after booking their first meeting.
                </p>
              </div>
            ) : (
              <div className="rounded-3xl border border-border-button-default bg-background-primary-default overflow-hidden shadow-2xs">
                <div className="divide-y divide-border-button-default">
                  {contacts.map((c) => (
                    <div
                      key={c.id}
                      className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-background-secondary-default/50 transition-colors"
                    >
                      <div className="flex items-center gap-3 sm:gap-4">
                        <Avatar size="md" initials={c.name.charAt(0)} color="blue" />
                        <div className="flex flex-col min-w-0">
                          <span className="text-body-medium font-semibold text-text-primary truncate">
                            {c.name}
                          </span>
                          <span className="text-body-2-regular text-text-secondary truncate">
                            {c.email}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center justify-between sm:justify-end gap-3 w-full sm:w-auto pt-2 sm:pt-0 border-t sm:border-t-0 border-border-button-default/40">
                        <span className="text-body-2-regular text-text-secondary text-caption-1-medium">
                          Last booked: {c.lastBookingAt}
                        </span>
                        <Chip color="soft" variant="caption">
                          {c.totalBookings} {c.totalBookings === 1 ? "booking" : "bookings"}
                        </Chip>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ========================================================================= */}
        {/* VIEW 5: ANALYTICS */}
        {/* ========================================================================= */}
        {activeTab === "analytics" && (
          <DashboardAnalyticsView
            bookings={bookings}
            eventTypes={eventTypes}
            officeKnocks={officeKnocks}
            userTimezone={user.timezone}
            defaultSpeedChatMins={user.officeSpeedChatMins || 10}
          />
        )}

        {/* ========================================================================= */}
        {/* VIEW: UNIFIED SETTINGS HUB */}
        {/* ========================================================================= */}
        {(activeTab === "settings" || activeTab === "availability" || activeTab === "integrations") && (
          <UnifiedSettingsView
            user={user}
            defaultTab={
              activeTab === "availability"
                ? "availability"
                : activeTab === "integrations"
                ? "integrations"
                : settingsTab
            }
            workingDays={workingDays}
            onUpdateUser={async (patch) => {
              const res = await fetch("/api/user/me", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(patch),
              });
              if (!res.ok) throw new Error("Failed to update profile");
              const data = await res.json();
              if (data.user) {
                setUser((prev) => (prev ? { ...prev, ...data.user } : null));
              }
            }}
            onUpdateWorkingDays={async (newDays) => {
              setWorkingDays(newDays);
              const res = await fetch("/api/availability", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  days: newDays.map((d) => ({
                    dayOfWeek: d.dayOfWeek,
                    startTime: d.startTime,
                    endTime: d.endTime,
                    isEnabled: d.isEnabled,
                  })),
                  timezone: user.timezone,
                }),
              });
              if (!res.ok) throw new Error("Failed to save working hours");
            }}
            onShowNotification={showNotification}
            onRefreshData={() => {
              loadUserData();
              loadAvailability();
            }}
          />
        )}

        {/* ========================================================================= */}
        {/* VIEW 7: VIRTUAL OFFICE HOURS */}
        {/* ========================================================================= */}
        {activeTab === "office" && (
          <HostOfficeView
            user={{
              id: user.id,
              name: user.name,
              email: user.email,
              slug: user.slug,
              officeStatus: user.officeStatus || "closed",
              officeTopic: user.officeTopic,
              officeSpeedChatMins: user.officeSpeedChatMins || 10,
              officeNotifyEmail: user.officeNotifyEmail !== false,
              officeAutoSchedule: user.officeAutoSchedule,
              officeScheduleDays: user.officeScheduleDays,
              officeScheduleStart: user.officeScheduleStart,
              officeScheduleEnd: user.officeScheduleEnd,
              defaultLocationType: user.defaultLocationType,
              zoomMeetingUrl: user.zoomMeetingUrl,
              teamsMeetingUrl: user.teamsMeetingUrl,
            }}
            knocks={officeKnocks}
            onUpdateSettings={handleUpdateOfficeSettings}
            onAdmitKnock={handleAdmitKnock}
            onDeclineKnock={handleDeclineKnock}
          />
        )}
      </div>

      {/* MODALS */}
      <NewEventModal
        isOpen={isNewEventOpen}
        onClose={() => {
          setIsNewEventOpen(false);
          setEditingEvent(null);
        }}
        event={editingEvent}
        userSlug={user.slug}
        defaultLocation={isZoomActive ? "Zoom Meetings" : isTeamsActive ? "Microsoft Teams" : "Google Meet"}
        onSave={handleSaveEvent}
        onDelete={handleDeleteEvent}
      />

      <RescheduleModal
        isOpen={isRescheduleOpen}
        onClose={() => {
          setIsRescheduleOpen(false);
          setActiveBooking(null);
        }}
        booking={activeBooking}
        onConfirmCancel={handleCancelBooking}
      />

      <ZoomModal
        isOpen={isZoomModalOpen}
        onClose={() => setIsZoomModalOpen(false)}
        currentZoomUrl={user.zoomMeetingUrl}
        zoomEmail={user.zoomEmail}
        hasZoomOAuth={user.hasZoomOAuth}
        isZoomActive={isZoomActive}
        onSaveZoom={handleSaveZoom}
        onDisableZoom={handleSwitchToGoogleMeet}
        onDisconnectOAuth={handleDisconnectZoomOAuth}
      />

      <TeamsModal
        isOpen={isTeamsModalOpen}
        onClose={() => setIsTeamsModalOpen(false)}
        currentTeamsUrl={user.teamsMeetingUrl}
        isTeamsActive={isTeamsActive}
        onSaveTeams={handleSaveTeams}
        onDisableTeams={handleSwitchToGoogleMeet}
      />

      <GCalModal
        isOpen={isGCalModalOpen}
        onClose={() => setIsGCalModalOpen(false)}
        userEmail={user.email}
        isConnected={user.hasGoogleCalendar}
      />

      {/* Interactive Onboarding Walkthrough Tour */}
      <ProductTour
        isOpen={tourOpen}
        onClose={() => setTourOpen(false)}
      />

      {/* Persistent Virtual Office Doorbell & Active Speed-Chat Timer HUD */}
      <DoorbellAlertModal
        knocks={officeKnocks}
        hostSpeedChatMins={user.officeSpeedChatMins || 10}
        onAdmit={handleAdmitKnock}
        onDecline={handleDeclineKnock}
        onConclude={handleConcludeKnock}
      />

      {/* Mobile-First Persistent Bottom Navigation Bar */}
      <DashboardBottomNav
        activeTab={activeTab}
        onSelectTab={(tab) => {
          if (tab === "settings") {
            setSettingsTab("profile");
            setActiveTab("settings");
          } else {
            setActiveTab(tab);
          }
        }}
        bookingsCount={bookings.filter((b) => b.status === "Confirmed").length}
        ringingKnocksCount={activeRingingCount}
        isOfficeOpen={user.officeStatus === "open"}
      />
    </div>
  );
}
