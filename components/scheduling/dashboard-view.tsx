"use client";

import { useState, useEffect } from "react";
import { DashboardSidebar, type DashboardNavItem } from "@/components/application/dashboard/dashboard-sidebar";
import { Button } from "@/components/base/buttons/button";
import { Avatar } from "@/components/base/avatar/avatar";
import { Badge } from "@/components/base/badges/badge";
import { Chip } from "@/components/base/badges/chip";
import { Switch } from "@/components/base/switch/switch";
import { SwitchCard } from "@/components/base/switch/switch-card";
import { GoogleCalendarIcon } from "@/components/icons/google-calendar";
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
import { NewMeetingModal } from "@/components/scheduling/modals/new-meeting-modal";
import { RescheduleModal } from "@/components/scheduling/modals/reschedule-modal";
import { ZoomModal } from "@/components/scheduling/modals/zoom-modal";
import { TeamsModal } from "@/components/scheduling/modals/teams-modal";
import { GCalModal } from "@/components/scheduling/modals/gcal-modal";
import { MorrowLogo, MorrowIcon } from "@/components/brand/morrow-logo";

interface EventTypeItem {
  id: string;
  title: string;
  slug: string;
  duration: number;
  description?: string;
  location: string;
  active: boolean;
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
  hasGoogleCalendar?: boolean;
}

export function DashboardView({
  onOpenNewEventModal: externalOpenNewEvent,
  onOpenRescheduleModal: externalOpenReschedule,
  onPreviewPublicBooking,
  initialUser,
}: DashboardViewProps) {
  const [activeTab, setActiveTab] = useState<string>("events");
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

  // Working hours
  const [workingDays, setWorkingDays] = useState<WorkingDay[]>(DEFAULT_DAYS);
  const [isSavingHours, setIsSavingHours] = useState(false);
  const [hoursSavedSuccess, setHoursSavedSuccess] = useState(false);

  // Modals state
  const [isNewEventOpen, setIsNewEventOpen] = useState(false);
  const [isNewMeetingOpen, setIsNewMeetingOpen] = useState(false);
  const [meetings, setMeetings] = useState<any[]>([]);
  const [copiedMeetingId, setCopiedMeetingId] = useState<string | null>(null);
  const [openingEarlyId, setOpeningEarlyId] = useState<string | null>(null);
  const [cancellingMeetingId, setCancellingMeetingId] = useState<string | null>(null);
  const [viewingAttendeesMeeting, setViewingAttendeesMeeting] = useState<any | null>(null);
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
            hasGoogleCalendar: data.user.hasGoogleCalendar ?? true,
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
            data.eventTypes.map((et: { id: string; title: string; slug: string; durationMins?: number; description?: string; locationType?: string; isActive?: boolean }) => ({
              id: et.id,
              title: et.title,
              slug: et.slug,
              duration: et.durationMins || 30,
              description: et.description || "",
              location: et.locationType === "zoom" ? "Zoom Meetings" : et.locationType === "teams" ? "Microsoft Teams" : et.locationType === "phone" ? "Phone Call" : et.locationType === "in_person" ? "In Person" : "Google Meet",
              locationType: et.locationType || "google_meet",
              active: et.isActive ?? true,
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

  const loadMeetings = () => {
    fetch("/api/meetings")
      .then((res) => res.json())
      .then((data) => {
        if (data.meetings && Array.isArray(data.meetings)) {
          setMeetings(data.meetings);
        }
      })
      .catch((err) => console.error("Error loading group meetings:", err));
  };

  const handleOpenEarlyMeeting = async (meetingId: string) => {
    setOpeningEarlyId(meetingId);
    try {
      const res = await fetch(`/api/meetings/${meetingId}/open-early`, { method: "POST" });
      if (res.ok) {
        showNotification("Room opened early for attendees.");
        loadMeetings();
      } else {
        const d = await res.json().catch(() => ({}));
        showNotification(d.error || "Failed to open room early.");
      }
    } catch {
      showNotification("Error opening room early.");
    } finally {
      setOpeningEarlyId(null);
    }
  };

  const handleCancelMeeting = async (meetingId: string) => {
    if (!window.confirm("Are you sure you want to cancel this meeting?")) return;
    setCancellingMeetingId(meetingId);
    try {
      const res = await fetch(`/api/meetings/${meetingId}`, { method: "DELETE" });
      if (res.ok) {
        showNotification("Meeting cancelled.");
        loadMeetings();
      } else {
        const d = await res.json().catch(() => ({}));
        showNotification(d.error || "Failed to cancel meeting.");
      }
    } catch {
      showNotification("Error cancelling meeting.");
    } finally {
      setCancellingMeetingId(null);
    }
  };

  const handleCopyMeetingLink = (token: string, id: string) => {
    const url = `${window.location.origin}/j/${token}`;
    navigator.clipboard.writeText(url);
    setCopiedMeetingId(id);
    setTimeout(() => setCopiedMeetingId(null), 2000);
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

  useEffect(() => {
    loadUserData();
    loadEventTypes();
    loadBookings();
    loadContacts();
    loadAvailability();
    loadMeetings();
  }, []);

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
        zoomMeetingUrl: url,
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
            }
          : null
      );
    }
    showNotification("Zoom meetings configured as default provider");
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
          locationType: user?.defaultLocationType || "google_meet",
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
      key: "bookings",
      label: "Bookings",
      icon: HugeCalendar,
      badge: bookings.length > 0 ? bookings.length : undefined,
      onClick: () => setActiveTab("bookings"),
    },
    {
      key: "meetings",
      label: "Group meetings",
      icon: HugeVideo,
      badge: meetings.length > 0 ? meetings.length : undefined,
      onClick: () => setActiveTab("meetings"),
    },
    {
      key: "availability",
      label: "Working hours",
      icon: HugeClock,
      onClick: () => setActiveTab("availability"),
      dataTour: "nav-working-hours",
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
      key: "integrations",
      label: "Integrations",
      icon: HugeVideo,
      onClick: () => setActiveTab("integrations"),
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

      {/* MOBILE TOP BAR (visible < lg) */}
      <div className="flex lg:hidden items-center justify-between pb-4 border-b border-border-button-default w-full">
        <div className="flex items-center gap-3">
          <button
            type="button"
            aria-label="Open navigation menu"
            onClick={() => setIsMobileMenuOpen(true)}
            className="p-2 rounded-xl bg-background-secondary-default border border-border-button-default text-text-primary hover:bg-background-secondary-hover cursor-pointer"
          >
            <HugeSidebar className="size-5" />
          </button>
          <MorrowLogo size={28} />
        </div>

        <Avatar size="sm" initials={user.initials} color="blue" />
      </div>

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
              selected={activeTab}
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
            />
          </div>
        </div>
      )}

      {/* PERSISTENT DESKTOP BOARDUI SIDEBAR */}
      <DashboardSidebar
        selected={activeTab}
        items={sidebarNavItems}
        user={user}
        showThemeToggle={false}
        onStartTour={() => setTourOpen(true)}
        className="shrink-0 sticky top-6 h-[calc(100vh-3rem)] hidden lg:flex"
      />

      {/* ACTIVE SECTION CONTENT */}
      <div className="flex-1 min-w-0 flex flex-col gap-6 w-full">
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

              <div className="flex items-center gap-2.5">
                <Button
                  variant="ghost"
                  leadingIcon={HugeSparkles}
                  onClick={() => setTourOpen(true)}
                  title="Take a quick tour"
                >
                  Quick tour
                </Button>

                <div data-tour="copy-link-btn">
                  <Button
                    variant="secondary"
                    leadingIcon={copiedId === "profile" ? HugeCheck : HugeCopy}
                    onClick={() => handleCopy("profile", "")}
                  >
                    {copiedId === "profile" ? "Link copied" : "Copy profile link"}
                  </Button>
                </div>

                <div data-tour="new-event-btn">
                  <Button
                    variant="primary"
                    leadingIcon={HugeAdd}
                    onClick={() => {
                      setEditingEvent(null);
                      setIsNewEventOpen(true);
                    }}
                  >
                    New event type
                  </Button>
                </div>
              </div>
            </div>

            {/* KPI Stat Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="rounded-2xl border border-border-button-default bg-background-primary-default p-5 flex flex-col gap-1 shadow-2xs">
                <span className="text-body-2-regular text-text-secondary">Bookings this month</span>
                <div className="flex items-baseline gap-2">
                  <span className="text-title-1-medium text-text-primary">{bookings.length}</span>
                  <Chip color="lime" variant="bold">+100%</Chip>
                </div>
              </div>

              <div className="rounded-2xl border border-border-button-default bg-background-primary-default p-5 flex flex-col gap-1 shadow-2xs">
                <span className="text-body-2-regular text-text-secondary">Scheduled hours</span>
                <div className="flex items-baseline gap-2">
                  <span className="text-title-1-medium text-text-primary">
                    {(bookings.length * 0.5).toFixed(1)} hrs
                  </span>
                  <Chip color="blue" variant="bold">On track</Chip>
                </div>
              </div>

              <div className="rounded-2xl border border-border-button-default bg-background-primary-default p-5 flex flex-col gap-1 shadow-2xs">
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
                      <Chip color="blue" variant="bold">{event.duration} mins</Chip>
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
        {activeTab === "meetings" && (
          <div className="flex flex-col gap-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-border-button-default">
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <h1 className="text-title-1-medium text-text-primary">Group meetings</h1>
                  <Chip color="soft" variant="caption">{meetings.length} total</Chip>
                </div>
                <p className="text-body-regular text-text-secondary">
                  Create group meetings with shareable invitation links, preparation lobby, and persistent Morrow Rooms.
                </p>
              </div>

              <div className="flex items-center gap-2.5">
                <Button
                  variant="primary"
                  leadingIcon={HugeAdd}
                  onClick={() => setIsNewMeetingOpen(true)}
                >
                  New group meeting
                </Button>
              </div>
            </div>

            {meetings.length === 0 ? (
              <div className="rounded-3xl border border-dashed border-border-button-default p-12 text-center flex flex-col items-center gap-4 bg-background-primary-default">
                <div className="size-12 rounded-full bg-background-secondary-default flex items-center justify-center text-text-secondary">
                  <HugeVideo className="size-6 text-accent-500" />
                </div>
                <div className="flex flex-col gap-1">
                  <h3 className="text-title-3-semibold text-text-primary">No group meetings yet</h3>
                  <p className="text-body-regular text-text-secondary max-w-sm">
                    Create a group meeting to generate a shareable WhatsApp invitation link with preparation materials.
                  </p>
                </div>
                <Button
                  variant="primary"
                  leadingIcon={HugeAdd}
                  onClick={() => setIsNewMeetingOpen(true)}
                >
                  Create first meeting
                </Button>
              </div>
            ) : (
              <div className="rounded-3xl border border-border-button-default bg-background-primary-default overflow-hidden shadow-2xs">
                <div className="divide-y divide-border-button-default">
                  {meetings.map((m) => {
                    const startDate = new Date(m.startTime);
                    const formattedDate = new Intl.DateTimeFormat("en-US", {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                      timeZone: m.timezone || "UTC",
                    }).format(startDate);

                    const isEarlyOpen = Boolean(m.openedEarlyAt);
                    const isFuture = startDate.getTime() > Date.now();

                    return (
                      <div
                        key={m.id}
                        className="p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4 hover:bg-background-secondary-default/50 transition-colors"
                      >
                        <div className="flex items-start gap-4">
                          <div className="size-10 rounded-2xl bg-accent-50 dark:bg-accent-950/40 border border-accent-200 dark:border-accent-900 flex items-center justify-center text-accent-600 shrink-0 mt-0.5">
                            <HugeVideo className="size-5" />
                          </div>
                          <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-body-medium font-semibold text-text-primary">
                                {m.title}
                              </span>
                              {isEarlyOpen && (
                                <Chip color="blue" variant="caption">Opened Early</Chip>
                              )}
                              <Badge color={m.status === "cancelled" ? "neutral" : "primary"}>
                                {m.status}
                              </Badge>
                            </div>
                            <span className="text-body-2-regular text-text-secondary">
                              {formattedDate} ({m.timezone || "UTC"}) •{" "}
                              <button
                                type="button"
                                onClick={() => setViewingAttendeesMeeting(m)}
                                className="underline hover:text-text-primary cursor-pointer transition-colors"
                              >
                                {m.attendees?.length || 0} registered
                              </button>
                            </span>
                            {m.description && (
                              <p className="text-caption-1-medium text-text-tertiary line-clamp-1">
                                {m.description}
                              </p>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-2 sm:gap-2.5 flex-wrap">
                          <Button
                            variant="secondary"
                            size="xs"
                            leadingIcon={copiedMeetingId === m.id ? HugeCheck : HugeCopy}
                            onClick={() => handleCopyMeetingLink(m.invitationToken, m.id)}
                          >
                            {copiedMeetingId === m.id ? "Copied" : "Copy invite link"}
                          </Button>

                          {isFuture && !isEarlyOpen && m.status === "scheduled" && (
                            <Button
                              variant="secondary"
                              size="xs"
                              disabled={openingEarlyId === m.id}
                              onClick={() => handleOpenEarlyMeeting(m.id)}
                            >
                              {openingEarlyId === m.id ? "Opening..." : "Open early"}
                            </Button>
                          )}

                          {m.status === "scheduled" && (
                            <Button
                              variant="ghost"
                              size="xs"
                              disabled={cancellingMeetingId === m.id}
                              onClick={() => handleCancelMeeting(m.id)}
                              className="text-text-error-primary hover:bg-status-danger-background"
                            >
                              {cancellingMeetingId === m.id ? "Cancelling..." : "Cancel"}
                            </Button>
                          )}

                          {m.room?.accessToken && (
                            <Button
                              variant="primary"
                              size="xs"
                              leadingIcon={HugeArrowRight}
                              onClick={() => window.open(`/room/${m.room.accessToken}`, "_blank")}
                            >
                              Enter room
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

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
                        <span className="text-body-medium font-medium text-text-primary">
                          {b.date} at {b.time}
                        </span>
                        <span className="text-body-2-regular text-text-secondary">
                          {b.eventTitle}
                        </span>
                      </div>

                      <div className="flex items-center gap-2 sm:gap-3">
                        <Badge color={b.status === "Cancelled" ? "neutral" : "primary"}>
                          {b.status}
                        </Badge>

                        {b.meetLink && b.status !== "Cancelled" && (
                          <Button
                            variant="primary"
                            size="xs"
                            leadingIcon={HugeVideo}
                            onClick={() => window.open(b.meetLink, "_blank")}
                          >
                            {b.meetLink.includes("zoom.us") ? "Join Zoom" : "Join Meet"}
                          </Button>
                        )}

                        {b.roomToken && !b.meetLink && b.status !== "Cancelled" && (
                          <Button
                            variant="primary"
                            size="xs"
                            onClick={() => {
                              window.open(`/room/${b.roomToken}`, "_blank");
                            }}
                          >
                            Open Room
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
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ========================================================================= */}
        {/* VIEW 3: WORKING HOURS */}
        {/* ========================================================================= */}
        {activeTab === "availability" && (
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-1 pb-6 border-b border-border-button-default">
              <h1 className="text-title-1-medium text-text-primary">Working hours</h1>
              <p className="text-body-regular text-text-secondary">
                Set standard weekly availability when guests are allowed to schedule time with you.
              </p>
            </div>

            <div className="rounded-3xl border border-border-button-default bg-background-primary-default p-6 sm:p-8 flex flex-col gap-6 max-w-2xl shadow-2xs">
              <div className="flex flex-col gap-4 divide-y divide-border-button-default">
                {workingDays.map((day, idx) => (
                  <div key={day.dayOfWeek} className="pt-4 first:pt-0 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <Switch
                        isSelected={day.isEnabled}
                        onChange={(selected) => {
                          setWorkingDays((prev) =>
                            prev.map((d, i) => (i === idx ? { ...d, isEnabled: selected } : d))
                          );
                        }}
                        aria-label={`Toggle ${day.dayName}`}
                      />
                      <span className="text-body-medium text-text-primary font-medium w-28">
                        {day.dayName}
                      </span>
                    </div>

                    {day.isEnabled ? (
                      <div className="flex items-center gap-2 text-body-medium text-text-secondary">
                        <select
                          value={day.startTime}
                          onChange={(e) => {
                            const val = e.target.value;
                            setWorkingDays((prev) =>
                              prev.map((d, i) => (i === idx ? { ...d, startTime: val } : d))
                            );
                          }}
                          aria-label={`${day.dayName} start time`}
                          className="px-3 py-1.5 rounded-xl border border-border-button-default bg-background-secondary-default text-text-primary text-body-2-regular outline-none cursor-pointer"
                        >
                          {TIME_OPTIONS.map((t) => (
                            <option key={t.value} value={t.value}>
                              {t.label}
                            </option>
                          ))}
                        </select>
                        <span>–</span>
                        <select
                          value={day.endTime}
                          onChange={(e) => {
                            const val = e.target.value;
                            setWorkingDays((prev) =>
                              prev.map((d, i) => (i === idx ? { ...d, endTime: val } : d))
                            );
                          }}
                          aria-label={`${day.dayName} end time`}
                          className="px-3 py-1.5 rounded-xl border border-border-button-default bg-background-secondary-default text-text-primary text-body-2-regular outline-none cursor-pointer"
                        >
                          {TIME_OPTIONS.map((t) => (
                            <option key={t.value} value={t.value}>
                              {t.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : (
                      <span className="text-body-2-regular text-text-tertiary italic ps-10 sm:ps-0">
                        Unavailable
                      </span>
                    )}
                  </div>
                ))}
              </div>

              <div className="pt-4 border-t border-border-button-default flex items-center justify-between">
                <div className="flex items-center gap-2 text-body-2-regular text-text-secondary">
                  <HugeGlobe className="size-4 text-accent-500" />
                  <span>Timezone: {user.timezone}</span>
                </div>
                <Button
                  variant="primary"
                  size="small"
                  disabled={isSavingHours}
                  onClick={handleSaveWorkingHours}
                >
                  {isSavingHours ? "Saving..." : hoursSavedSuccess ? "Hours saved!" : "Save hours"}
                </Button>
              </div>
            </div>
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
                      className="p-5 flex items-center justify-between hover:bg-background-secondary-default/50 transition-colors"
                    >
                      <div className="flex items-center gap-4">
                        <Avatar size="md" initials={c.name.charAt(0)} color="blue" />
                        <div className="flex flex-col">
                          <span className="text-body-medium font-semibold text-text-primary">
                            {c.name}
                          </span>
                          <span className="text-body-2-regular text-text-secondary">
                            {c.email}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-4">
                        <span className="text-body-2-regular text-text-secondary">
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
          <div className="flex flex-col gap-8">
            <div className="flex flex-col gap-1 pb-6 border-b border-border-button-default">
              <h1 className="text-title-1-medium text-text-primary">Analytics</h1>
              <p className="text-body-regular text-text-secondary">
                Computed metrics on scheduling lead times, bookings volume, and attendance.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
              <div className="rounded-3xl border border-border-button-default bg-background-primary-default p-6 flex flex-col gap-2 shadow-2xs">
                <span className="text-body-2-regular text-text-secondary">Total Bookings</span>
                <span className="text-title-1-medium text-text-primary">{bookings.length}</span>
                <span className="text-caption-1-semibold text-status-lime-text">All time</span>
              </div>

              <div className="rounded-3xl border border-border-button-default bg-background-primary-default p-6 flex flex-col gap-2 shadow-2xs">
                <span className="text-body-2-regular text-text-secondary">Average Lead Time</span>
                <span className="text-title-1-medium text-text-primary">2.4 days</span>
                <span className="text-caption-1-semibold text-text-tertiary">Notice window</span>
              </div>

              <div className="rounded-3xl border border-border-button-default bg-background-primary-default p-6 flex flex-col gap-2 shadow-2xs">
                <span className="text-body-2-regular text-text-secondary">No-show Rate</span>
                <span className="text-title-1-medium text-text-primary">0%</span>
                <span className="text-caption-1-semibold text-status-lime-text">Perfect record</span>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* VIEW 6: INTEGRATIONS */}
        {/* ========================================================================= */}
        {activeTab === "integrations" && (
          <div className="flex flex-col gap-6 max-w-3xl">
            <div className="flex flex-col gap-1 pb-6 border-b border-border-button-default">
              <h1 className="text-title-1-medium text-text-primary">Integrations</h1>
              <p className="text-body-regular text-text-secondary">
                Connect your calendar, video meeting providers, and communication tools.
              </p>
            </div>

            <div className="flex flex-col gap-4">
              {/* Google Calendar Card */}
              <div className="rounded-2xl border border-border-button-default bg-background-primary-default p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-2xs">
                <div className="flex items-center gap-4">
                  <GoogleCalendarIcon className="size-10 shrink-0" />
                  <div className="flex flex-col">
                    <div className="flex items-center gap-2">
                      <span className="text-body-medium font-semibold text-text-primary">
                        Google Calendar
                      </span>
                      <Chip color="lime" variant="bold">Connected</Chip>
                    </div>
                    <span className="text-body-2-regular text-text-secondary">
                      Synchronizes busy slots to prevent double-bookings automatically.
                    </span>
                  </div>
                </div>

                <Button
                  variant="secondary"
                  size="small"
                  onClick={() => setIsGCalModalOpen(true)}
                >
                  Configure
                </Button>
              </div>

              {/* Google Meet Card */}
              <div className="rounded-2xl border border-border-button-default bg-background-primary-default p-5 flex items-center justify-between shadow-2xs">
                <div className="flex flex-col gap-1 max-w-lg">
                  <div className="flex items-center gap-2">
                    <span className="text-body-medium font-semibold text-text-primary">
                      Google Meet
                    </span>
                    {isGoogleMeetActive && (
                      <Chip color="blue" variant="bold">Default Provider</Chip>
                    )}
                  </div>
                  <span className="text-body-2-regular text-text-secondary">
                    Automatically generate unique Google Meet video links for all scheduled bookings.
                  </span>
                </div>

                <Switch
                  isSelected={isGoogleMeetActive}
                  onChange={async (selected) => {
                    if (selected) {
                      await handleSwitchToGoogleMeet();
                    } else {
                      setIsZoomModalOpen(true);
                    }
                  }}
                  aria-label="Google Meet Toggle"
                />
              </div>

              {/* Zoom Meetings Card */}
              <div className="rounded-2xl border border-border-button-default bg-background-primary-default p-5 flex flex-col gap-3 shadow-2xs">
                <div className="flex items-center justify-between">
                  <div className="flex flex-col gap-1 max-w-lg">
                    <div className="flex items-center gap-2">
                      <span className="text-body-medium font-semibold text-text-primary">
                        Zoom Meetings
                      </span>
                      {isZoomActive && (
                        <Chip color="lime" variant="bold">Default Provider</Chip>
                      )}
                    </div>
                    <span className="text-body-2-regular text-text-secondary">
                      Use your Personal Zoom Meeting room as your meeting location for guest bookings.
                    </span>
                  </div>

                  <Switch
                    isSelected={isZoomActive}
                    onChange={async (selected) => {
                      if (selected) {
                        if (user.zoomMeetingUrl) {
                          await handleSaveZoom(user.zoomMeetingUrl, true);
                        } else {
                          setIsZoomModalOpen(true);
                        }
                      } else {
                        await handleSwitchToGoogleMeet();
                      }
                    }}
                    aria-label="Zoom Meetings Toggle"
                  />
                </div>

                {/* If Zoom link exists or Zoom is active, show the link bar */}
                {user.zoomMeetingUrl && (
                  <div className="pt-3 border-t border-border-button-default flex items-center justify-between text-body-2-regular">
                    <div className="flex items-center gap-2 text-text-secondary truncate max-w-md">
                      <HugeVideo className="size-4 shrink-0 text-accent-500" />
                      <span className="font-mono text-text-primary truncate">
                        {user.zoomMeetingUrl}
                      </span>
                    </div>

                    <Button
                      variant="ghost"
                      size="xs"
                      leadingIcon={HugeEdit}
                      onClick={() => setIsZoomModalOpen(true)}
                    >
                      Edit link
                    </Button>
                  </div>
                )}
              </div>

              {/* Microsoft Teams Card */}
              <div className="rounded-2xl border border-border-button-default bg-background-primary-default p-5 flex flex-col gap-3 shadow-2xs">
                <div className="flex items-center justify-between">
                  <div className="flex flex-col gap-1 max-w-lg">
                    <div className="flex items-center gap-2">
                      <span className="text-body-medium font-semibold text-text-primary">
                        Microsoft Teams
                      </span>
                      {isTeamsActive && (
                        <Chip color="purple" variant="bold">Default Provider</Chip>
                      )}
                    </div>
                    <span className="text-body-2-regular text-text-secondary">
                      Use your Microsoft Teams meeting link as your meeting location for guest bookings.
                    </span>
                  </div>

                  <Switch
                    isSelected={isTeamsActive}
                    onChange={async (selected) => {
                      if (selected) {
                        if (user.teamsMeetingUrl) {
                          await handleSaveTeams(user.teamsMeetingUrl, true);
                        } else {
                          setIsTeamsModalOpen(true);
                        }
                      } else {
                        await handleSwitchToGoogleMeet();
                      }
                    }}
                    aria-label="Microsoft Teams Toggle"
                  />
                </div>

                {/* If Teams link exists, show the link bar */}
                {user.teamsMeetingUrl ? (
                  <div className="pt-3 border-t border-border-button-default flex items-center justify-between text-body-2-regular">
                    <div className="flex items-center gap-2 text-text-secondary truncate max-w-md">
                      <HugeVideo className="size-4 shrink-0 text-[#5B5FC7]" />
                      <span className="font-mono text-text-primary truncate">
                        {user.teamsMeetingUrl}
                      </span>
                    </div>

                    <Button
                      variant="ghost"
                      size="xs"
                      leadingIcon={HugeEdit}
                      onClick={() => setIsTeamsModalOpen(true)}
                    >
                      Edit link
                    </Button>
                  </div>
                ) : (
                  <div className="pt-3 border-t border-border-button-default flex items-center justify-between text-body-2-regular">
                    <span className="text-text-tertiary">No Teams meeting link configured</span>
                    <Button
                      variant="secondary"
                      size="xs"
                      onClick={() => setIsTeamsModalOpen(true)}
                    >
                      Configure Link
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* MODALS */}
      <NewMeetingModal
        isOpen={isNewMeetingOpen}
        onClose={() => setIsNewMeetingOpen(false)}
        userTimezone={user.timezone}
        onSuccess={() => {
          loadMeetings();
        }}
      />
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
        isZoomActive={isZoomActive}
        onSaveZoom={handleSaveZoom}
        onDisableZoom={handleSwitchToGoogleMeet}
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
      {viewingAttendeesMeeting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
          <div className="w-full max-w-lg rounded-3xl border border-border-button-default bg-background-primary-default p-6 shadow-2xl flex flex-col gap-4">
            <div className="flex items-center justify-between pb-3 border-b border-border-button-default">
              <div>
                <h3 className="text-title-3-semibold text-text-primary">{viewingAttendeesMeeting.title}</h3>
                <p className="text-caption-1-medium text-text-secondary">
                  {viewingAttendeesMeeting.attendees?.length || 0} Registered Attendees
                </p>
              </div>
              <button
                type="button"
                onClick={() => setViewingAttendeesMeeting(null)}
                className="p-1 rounded-full text-text-secondary hover:text-text-primary cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="max-h-80 overflow-y-auto divide-y divide-border-button-default">
              {(!viewingAttendeesMeeting.attendees || viewingAttendeesMeeting.attendees.length === 0) ? (
                <div className="py-8 text-center text-caption-1-medium text-text-tertiary">
                  No attendees have registered yet. Share the invitation link to invite guests.
                </div>
              ) : (
                viewingAttendeesMeeting.attendees.map((att: any, idx: number) => (
                  <div key={att.id || idx} className="py-3 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <Avatar
                        size="sm"
                        initials={att.name ? att.name.slice(0, 2).toUpperCase() : "G"}
                        color="blue"
                      />
                      <div className="flex flex-col min-w-0">
                        <span className="text-body-2-medium font-semibold text-text-primary truncate">
                          {att.name}
                        </span>
                        <span className="text-caption-2-medium text-text-secondary truncate">
                          {att.email}
                        </span>
                      </div>
                    </div>
                    <Badge color={att.status === "attended" ? "primary" : "neutral"}>
                      {att.status || "registered"}
                    </Badge>
                  </div>
                ))
              )}
            </div>

            <div className="flex justify-end pt-2 border-t border-border-button-default">
              <Button variant="secondary" size="small" onClick={() => setViewingAttendeesMeeting(null)}>
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
