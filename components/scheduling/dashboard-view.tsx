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
} from "@/components/icons/hugeicons";

interface EventTypeItem {
  id: string;
  title: string;
  slug: string;
  duration: number;
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
  status: "Confirmed" | "Completed" | "Cancelled";
}

interface ContactItem {
  id: string;
  name: string;
  email: string;
  totalBookings: number;
  lastBookingAt: string;
  notes?: string;
}

export interface DashboardViewProps {
  onOpenNewEventModal?: () => void;
  onOpenRescheduleModal?: (booking: BookingItem) => void;
  onPreviewPublicBooking?: () => void;
}

interface HostUser {
  id: string;
  name: string;
  email: string;
  slug: string;
  initials: string;
  timezone: string;
  avatarUrl?: string | null;
  brandColor?: string | null;
  welcomeMessage?: string | null;
}

export function DashboardView({
  onOpenNewEventModal,
  onOpenRescheduleModal,
  onPreviewPublicBooking,
}: DashboardViewProps) {
  const [activeTab, setActiveTab] = useState<string>("events");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Dynamic user profile from Neon
  const [user, setUser] = useState<HostUser | null>(null);

  // Event types from Neon
  const [eventTypes, setEventTypes] = useState<EventTypeItem[]>([]);

  // Bookings from Neon
  const [bookings, setBookings] = useState<BookingItem[]>([]);
  const [contacts, setContacts] = useState<ContactItem[]>([]);

  useEffect(() => {
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
          });
        }
        setIsLoading(false);
      })
      .catch((err) => {
        console.error("Error loading user profile:", err);
        setIsLoading(false);
      });

    // 2. Fetch live event types
    fetch("/api/event-types")
      .then((res) => res.json())
      .then((data) => {
        if (data.eventTypes && Array.isArray(data.eventTypes)) {
          setEventTypes(
            data.eventTypes.map((et: any) => ({
              id: et.id,
              title: et.title,
              slug: et.slug,
              duration: et.durationMins || 30,
              location: "Google Meet",
              active: et.isActive ?? true,
            }))
          );
        }
      })
      .catch((err) => console.error("Error loading event types:", err));

    // 3. Fetch live bookings
    fetch("/api/bookings")
      .then((res) => res.json())
      .then((data) => {
        if (data.bookings && Array.isArray(data.bookings)) {
          setBookings(data.bookings);
        }
      })
      .catch((err) => console.error("Error loading bookings:", err));

    // 4. Fetch live contacts
    fetch("/api/contacts")
      .then((res) => res.json())
      .then((data) => {
        if (data.contacts && Array.isArray(data.contacts)) {
          setContacts(data.contacts);
        }
      })
      .catch((err) => console.error("Error loading contacts:", err));
  }, []);

  const handleCopy = (id: string, path: string) => {
    if (!user) return;
    const url = path ? `https://usemorrow.xyz/${user.slug}/${path}` : `https://usemorrow.xyz/${user.slug}`;
    navigator.clipboard.writeText(url);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const toggleEventActive = (id: string) => {
    setEventTypes((prev) =>
      prev.map((e) => (e.id === id ? { ...e, active: !e.active } : e))
    );
  };

  const handleOpenPublicPage = () => {
    if (!user) return;
    window.open(`/${user.slug}`, "_blank");
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
      key: "availability",
      label: "Working hours",
      icon: HugeClock,
      onClick: () => setActiveTab("availability"),
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
      <div className="min-h-[70vh] flex flex-col items-center justify-center gap-3 text-text-secondary">
        <div className="size-8 rounded-full border-2 border-accent-500 border-t-transparent animate-spin" />
        <span className="text-body-medium">Loading your Morrow calendar...</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col lg:flex-row w-full gap-6 lg:gap-8 items-start">
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
          <div className="size-8 rounded-xl bg-accent-500 text-white flex items-center justify-center font-bold text-headline-medium shadow-2xs">
            M
          </div>
          <span className="text-headline-semibold text-text-primary">Morrow</span>
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
                  <Chip color="soft" variant="caption">{eventTypes.length} active</Chip>
                </div>
                <p className="text-body-regular text-text-secondary">
                  Create and manage links for guests to book time on your calendar.
                </p>
              </div>

              <div className="flex items-center gap-3">
                <Button
                  variant="secondary"
                  leadingIcon={copiedId === "profile" ? HugeCheck : HugeCopy}
                  onClick={() => handleCopy("profile", "")}
                >
                  {copiedId === "profile" ? "Link copied" : "Copy profile link"}
                </Button>

                <Button
                  variant="primary"
                  leadingIcon={HugeAdd}
                  onClick={onOpenNewEventModal}
                >
                  New event type
                </Button>
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
              {eventTypes.map((event) => (
                <div
                  key={event.id}
                  className="rounded-3xl border border-border-button-default bg-background-primary-default p-6 flex flex-col justify-between gap-6 hover:border-accent-500/50 transition-all shadow-2xs"
                >
                  <div className="flex flex-col gap-3.5">
                    <div className="flex items-center justify-between">
                      <Chip color="blue" variant="bold">{event.duration} mins</Chip>
                      <Switch
                        isSelected={event.active}
                        onChange={() => toggleEventActive(event.id)}
                        aria-label={`Toggle ${event.title}`}
                      />
                    </div>

                    <div className="flex flex-col gap-1">
                      <h3 className="text-title-3-semibold text-text-primary">{event.title}</h3>
                      <span className="text-body-2-regular text-text-secondary">
                        usemorrow.xyz/{user.slug}/{event.slug}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 text-body-2-regular text-text-secondary">
                      <HugeVideo className="size-4 shrink-0 text-foreground-icon-secondary" />
                      <span>{event.location}</span>
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
                      onClick={onOpenNewEventModal}
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
                        <span className="text-body-medium font-medium text-text-primary">
                          {b.date} at {b.time}
                        </span>
                        <span className="text-body-2-regular text-text-secondary">
                          {b.eventTitle}
                        </span>
                      </div>

                      <div className="flex items-center gap-3">
                        <Badge color="primary">{b.status}</Badge>

                        {b.meetLink && (
                          <a
                            href={b.meetLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-body-2-regular font-medium bg-accent-50 text-accent-700 hover:bg-accent-100 transition-colors"
                          >
                            <HugeVideo className="size-3.5" />
                            <span>Join</span>
                          </a>
                        )}

                        <Button
                          variant="secondary"
                          size="xs"
                          onClick={() => onOpenRescheduleModal?.(b)}
                        >
                          Manage
                        </Button>
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
              <div className="flex flex-col gap-3 divide-y divide-border-button-default">
                {["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map(
                  (day, i) => (
                    <div key={day} className="pt-3 first:pt-0 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Switch defaultSelected={i < 5} aria-label={day} />
                        <span className="text-body-medium text-text-primary font-medium w-28">
                          {day}
                        </span>
                      </div>

                      {i < 5 ? (
                        <div className="flex items-center gap-2 text-body-medium text-text-secondary">
                          <span className="px-3 py-1 rounded-lg border border-border-button-default bg-background-secondary-default text-text-primary font-mono text-body-2-regular">
                            09:00 AM
                          </span>
                          <span>–</span>
                          <span className="px-3 py-1 rounded-lg border border-border-button-default bg-background-secondary-default text-text-primary font-mono text-body-2-regular">
                            05:00 PM
                          </span>
                        </div>
                      ) : (
                        <span className="text-body-2-regular text-text-tertiary italic">
                          Unavailable
                        </span>
                      )}
                    </div>
                  )
                )}
              </div>

              <div className="pt-4 border-t border-border-button-default flex items-center justify-between">
                <div className="flex items-center gap-2 text-body-2-regular text-text-secondary">
                  <HugeGlobe className="size-4 text-accent-500" />
                  <span>Timezone: {user.timezone}</span>
                </div>
                <Button variant="primary" size="small">
                  Save hours
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

                <Button variant="secondary" size="small">
                  Configure
                </Button>
              </div>

              <SwitchCard
                title="Google Meet"
                description="Automatically generate unique Google Meet video links for all scheduled bookings"
                defaultSelected={true}
              />

              <SwitchCard
                title="Zoom Meetings"
                description="Connect your Zoom account as an alternate video conference provider"
                defaultSelected={false}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
