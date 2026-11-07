"use client";

import { useState, useMemo } from "react";
import { Avatar } from "@/components/base/avatar/avatar";
import { Chip } from "@/components/base/badges/chip";
import {
  RiCalendarCheckLine,
  RiTimeLine,
  RiDoorOpenLine,
  RiPercentLine,
} from "@remixicon/react";
import { cx } from "@/utils/cx";

export interface AnalyticsBookingItem {
  id: string;
  guestName: string;
  guestEmail: string;
  eventTitle: string;
  date: string;
  time: string;
  status: "Confirmed" | "Completed" | "Cancelled" | string;
  isGroup?: boolean;
  maxAttendees?: number;
  attendeeCount?: number;
  duration?: number;
  createdAt?: string;
}

export interface AnalyticsKnockItem {
  id: string;
  guestName: string;
  guestEmail: string;
  topic: string;
  status: "ringing" | "admitted" | "declined" | "missed" | "cancelled" | "concluded" | "queued";
  createdAt: string;
  admittedAt?: string | null;
}

export interface AnalyticsEventTypeItem {
  id: string;
  title: string;
  duration: number;
  slug: string;
  active: boolean;
  maxAttendees?: number;
}

export interface DashboardAnalyticsViewProps {
  bookings: AnalyticsBookingItem[];
  eventTypes: AnalyticsEventTypeItem[];
  officeKnocks: AnalyticsKnockItem[];
  userTimezone?: string;
  defaultSpeedChatMins?: number;
}

type TimeframeOption = "7d" | "30d" | "90d" | "all";

export function DashboardAnalyticsView({
  bookings,
  eventTypes,
  officeKnocks,
  userTimezone = "UTC",
  defaultSpeedChatMins = 10,
}: DashboardAnalyticsViewProps) {
  const [timeframe, setTimeframe] = useState<TimeframeOption>("30d");

  // Filter items by selected timeframe
  const { filteredBookings, filteredKnocks } = useMemo(() => {
    if (timeframe === "all") {
      return { filteredBookings: bookings, filteredKnocks: officeKnocks };
    }

    const days = timeframe === "7d" ? 7 : timeframe === "30d" ? 30 : 90;
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const b = bookings.filter((item) => {
      const d = new Date(item.date);
      return !isNaN(d.getTime()) && d >= cutoff;
    });

    const k = officeKnocks.filter((item) => {
      const d = new Date(item.createdAt);
      return !isNaN(d.getTime()) && d >= cutoff;
    });

    return { filteredBookings: b, filteredKnocks: k };
  }, [bookings, officeKnocks, timeframe]);

  // Aggregate Metrics
  const totalBookings = filteredBookings.length;
  const confirmedCount = filteredBookings.filter((b) => b.status === "Confirmed").length;
  const completedCount = filteredBookings.filter((b) => b.status === "Completed").length;
  const cancelledCount = filteredBookings.filter((b) => b.status === "Cancelled").length;

  const cancellationRate = totalBookings > 0 ? Math.round((cancelledCount / totalBookings) * 100) : 0;
  const attendanceRate = totalBookings > 0 ? 100 - cancellationRate : 100;

  // Calculate meeting hours
  const totalMinutes = filteredBookings.reduce((acc, curr) => {
    if (curr.status === "Cancelled") return acc;
    const et = eventTypes.find((e) => e.title === curr.eventTitle);
    const duration = curr.duration || et?.duration || 30;
    return acc + duration;
  }, 0);
  const totalHours = (totalMinutes / 60).toFixed(1);

  // Office Hours Metrics
  const totalKnocks = filteredKnocks.length;
  const admittedKnocks = filteredKnocks.filter(
    (k) => k.status === "admitted" || k.status === "concluded"
  ).length;
  const admissionRate = totalKnocks > 0 ? Math.round((admittedKnocks / totalKnocks) * 100) : 0;

  // Day of Week Distribution
  const dayDistribution = useMemo(() => {
    const days = [
      { day: "Mon", count: 0 },
      { day: "Tue", count: 0 },
      { day: "Wed", count: 0 },
      { day: "Thu", count: 0 },
      { day: "Fri", count: 0 },
      { day: "Sat", count: 0 },
      { day: "Sun", count: 0 },
    ];

    filteredBookings.forEach((b) => {
      const d = new Date(b.date);
      if (!isNaN(d.getTime())) {
        const dayIdx = (d.getDay() + 6) % 7; // Convert Sun=0..Sat=6 to Mon=0..Sun=6
        days[dayIdx].count += 1;
      }
    });

    const maxCount = Math.max(1, ...days.map((d) => d.count));
    return days.map((d) => ({
      ...d,
      percent: Math.round((d.count / (totalBookings || 1)) * 100),
      relativeHeight: Math.max(12, Math.round((d.count / maxCount) * 100)),
    }));
  }, [filteredBookings, totalBookings]);

  // Event Type Popularity
  const eventPopularity = useMemo(() => {
    const map = new Map<string, { title: string; count: number; minutes: number }>();

    filteredBookings.forEach((b) => {
      const et = eventTypes.find((e) => e.title === b.eventTitle);
      const duration = b.duration || et?.duration || 30;
      const key = b.eventTitle || "General Meeting";

      const existing = map.get(key) || { title: key, count: 0, minutes: 0 };
      existing.count += 1;
      if (b.status !== "Cancelled") {
        existing.minutes += duration;
      }
      map.set(key, existing);
    });

    return Array.from(map.values())
      .sort((a, b) => b.count - a.count)
      .map((item) => ({
        ...item,
        hours: (item.minutes / 60).toFixed(1),
        sharePercent: Math.round((item.count / (totalBookings || 1)) * 100),
      }));
  }, [filteredBookings, eventTypes, totalBookings]);

  return (
    <div className="flex flex-col gap-5 sm:gap-8 w-full max-w-6xl">
      {/* Header & Timeframe Selector */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 pb-4 sm:pb-6 border-b border-border-button-default">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <h1 className="text-title-1-medium text-text-primary tracking-tight">Analytics</h1>
            <Chip color="blue" variant="bold">Real-Time</Chip>
          </div>
          <p className="text-body-regular text-text-secondary">
            Performance metrics across scheduled bookings, group events, and virtual office hours.
          </p>
        </div>

        {/* Timeframe Filter Segmented Control */}
        <div className="grid grid-cols-4 sm:flex items-center gap-1 p-1 rounded-2xl bg-background-secondary-default border border-border-button-default w-full sm:w-auto select-none">
          {(
            [
              { id: "7d", label: "Last 7 days", shortLabel: "7d" },
              { id: "30d", label: "Last 30 days", shortLabel: "30d" },
              { id: "90d", label: "Last 90 days", shortLabel: "90d" },
              { id: "all", label: "All time", shortLabel: "All" },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTimeframe(item.id)}
              className={cx(
                "py-2 sm:py-1.5 sm:px-3 rounded-xl text-caption-1-semibold transition-all cursor-pointer text-center min-h-[40px] sm:min-h-[36px] flex items-center justify-center",
                timeframe === item.id
                  ? "bg-background-primary-default text-text-primary shadow-2xs font-bold ring-1 ring-border-button-default"
                  : "text-text-secondary hover:text-text-primary"
              )}
            >
              <span className="hidden sm:inline">{item.label}</span>
              <span className="sm:hidden">{item.shortLabel}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Primary KPI Grid (4 Pillars) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-4">
        {/* KPI 1: Total Scheduled Bookings */}
        <div className="rounded-2xl sm:rounded-3xl border border-border-button-default bg-background-primary-default p-3.5 sm:p-5 flex flex-col justify-between shadow-2xs gap-2 sm:gap-3">
          <div className="flex items-center justify-between">
            <span className="text-caption-1-semibold text-text-secondary truncate">Bookings</span>
            <div className="size-7 sm:size-8 rounded-xl bg-accent-50 dark:bg-accent-950/40 text-accent-600 flex items-center justify-center shrink-0">
              <RiCalendarCheckLine className="size-4" />
            </div>
          </div>
          <div className="flex flex-col gap-0.5 min-w-0">
            <span className="text-title-1-medium text-text-primary leading-none">{totalBookings}</span>
            <p className="text-caption-2-medium text-text-secondary truncate pt-1">
              {confirmedCount} conf &bull; {completedCount} done
            </p>
          </div>
        </div>

        {/* KPI 2: Meeting Hours Hosted */}
        <div className="rounded-2xl sm:rounded-3xl border border-border-button-default bg-background-primary-default p-3.5 sm:p-5 flex flex-col justify-between shadow-2xs gap-2 sm:gap-3">
          <div className="flex items-center justify-between">
            <span className="text-caption-1-semibold text-text-secondary truncate">Meeting Time</span>
            <div className="size-7 sm:size-8 rounded-xl bg-accent-50 dark:bg-accent-950/40 text-accent-600 flex items-center justify-center shrink-0">
              <RiTimeLine className="size-4" />
            </div>
          </div>
          <div className="flex flex-col gap-0.5 min-w-0">
            <div className="flex items-baseline gap-1 leading-none">
              <span className="text-title-1-medium text-text-primary leading-none">{totalHours}</span>
              <span className="text-body-2-medium text-text-tertiary">hrs</span>
            </div>
            <p className="text-caption-2-medium text-text-secondary truncate pt-1">
              Across all calls
            </p>
          </div>
        </div>

        {/* KPI 3: Attendance & Reliability Rate */}
        <div className="rounded-2xl sm:rounded-3xl border border-border-button-default bg-background-primary-default p-3.5 sm:p-5 flex flex-col justify-between shadow-2xs gap-2 sm:gap-3">
          <div className="flex items-center justify-between">
            <span className="text-caption-1-semibold text-text-secondary truncate">Reliability</span>
            <div className="size-7 sm:size-8 rounded-xl bg-accent-50 dark:bg-accent-950/40 text-accent-600 flex items-center justify-center shrink-0">
              <RiPercentLine className="size-4" />
            </div>
          </div>
          <div className="flex flex-col gap-0.5 min-w-0">
            <div className="flex items-baseline gap-1 leading-none">
              <span className="text-title-1-medium text-text-primary leading-none">{attendanceRate}%</span>
            </div>
            <p className="text-caption-2-medium text-text-secondary truncate pt-1">
              {cancellationRate === 0 ? "100% attended" : `${cancelledCount} cancelled`}
            </p>
          </div>
        </div>

        {/* KPI 4: Office Hours Admitted */}
        <div className="rounded-2xl sm:rounded-3xl border border-border-button-default bg-background-primary-default p-3.5 sm:p-5 flex flex-col justify-between shadow-2xs gap-2 sm:gap-3">
          <div className="flex items-center justify-between">
            <span className="text-caption-1-semibold text-text-secondary truncate">Speed-Chats</span>
            <div className="size-7 sm:size-8 rounded-xl bg-accent-50 dark:bg-accent-950/40 text-accent-600 flex items-center justify-center shrink-0">
              <RiDoorOpenLine className="size-4" />
            </div>
          </div>
          <div className="flex flex-col gap-0.5 min-w-0">
            <div className="flex items-baseline gap-1 leading-none">
              <span className="text-title-1-medium text-text-primary leading-none">{admittedKnocks}</span>
            </div>
            <p className="text-caption-2-medium text-text-secondary truncate pt-1">
              {admissionRate}% admitted
            </p>
          </div>
        </div>
      </div>

      {/* Two Column Section: Peak Day Distribution & Event Type Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        {/* Left Card: Weekly Demand Distribution */}
        <div className="rounded-3xl border border-border-button-default bg-background-primary-default p-4 sm:p-6 flex flex-col gap-4 sm:gap-6 shadow-2xs">
          <div className="flex flex-col gap-0.5">
            <span className="text-title-3-semibold text-text-primary">Weekly Booking Distribution</span>
            <span className="text-caption-1-medium text-text-secondary">
              Number of appointments scheduled per day of the week
            </span>
          </div>

          <div className="flex flex-col gap-3">
            {dayDistribution.map((item) => (
              <div key={item.day} className="flex items-center gap-2.5 sm:gap-3">
                <span className="w-8 sm:w-9 text-caption-1-semibold text-text-secondary text-start shrink-0">
                  {item.day}
                </span>

                <div className="flex-1 h-2.5 sm:h-3 rounded-full bg-background-secondary-default overflow-hidden relative">
                  <div
                    className="h-full rounded-full bg-accent-500 transition-all duration-500"
                    style={{ width: `${item.percent}%` }}
                  />
                </div>

                <div className="w-14 sm:w-16 flex items-center justify-end gap-1 text-caption-2-medium sm:text-caption-1-medium text-text-primary shrink-0">
                  <span className="font-semibold">{item.count}</span>
                  <span className="text-text-tertiary">({item.percent}%)</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right Card: Event Type Popularity */}
        <div className="rounded-3xl border border-border-button-default bg-background-primary-default p-4 sm:p-6 flex flex-col gap-4 sm:gap-6 shadow-2xs">
          <div className="flex flex-col gap-0.5">
            <span className="text-title-3-semibold text-text-primary">Event Type Performance</span>
            <span className="text-caption-1-medium text-text-secondary">
              Bookings volume and total hours delivered per event type
            </span>
          </div>

          {eventPopularity.length === 0 ? (
            <div className="p-8 text-center text-text-tertiary text-body-2-regular">
              No bookings recorded yet in this timeframe.
            </div>
          ) : (
            <div className="flex flex-col divide-y divide-border-button-default">
              {eventPopularity.map((item) => (
                <div
                  key={item.title}
                  className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 sm:gap-4 first:pt-0 last:pb-0"
                >
                  <div className="flex flex-col min-w-0">
                    <div className="flex items-center justify-between sm:justify-start gap-2">
                      <span className="text-body-2-medium font-semibold text-text-primary truncate">
                        {item.title}
                      </span>
                      <div className="sm:hidden shrink-0">
                        <Chip color="neutral" variant="bold">
                          {item.count} {item.count === 1 ? "booking" : "bookings"}
                        </Chip>
                      </div>
                    </div>
                    <span className="text-caption-2-medium text-text-secondary truncate">
                      {item.hours} hrs total &bull; {item.sharePercent}% share
                    </span>
                  </div>

                  <div className="hidden sm:flex items-center gap-2 shrink-0">
                    <Chip color="neutral" variant="bold">
                      {item.count} {item.count === 1 ? "booking" : "bookings"}
                    </Chip>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Virtual Office Hours Recent Topics & Activity Section */}
      <div className="rounded-3xl border border-border-button-default bg-background-primary-default p-4 sm:p-6 flex flex-col gap-4 sm:gap-5 shadow-2xs">
        <div className="flex flex-col sm:flex-row sm:items-start sm:items-center justify-between gap-2 pb-2 sm:pb-0 border-b sm:border-b-0 border-border-button-default">
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-title-3-semibold text-text-primary">Virtual Office Drop-in Feed</span>
              <Chip color="lime" variant="bold">Doorbell Telemetry</Chip>
            </div>
            <span className="text-caption-1-medium text-text-secondary">
              Recent visitor topics and spontaneous walk-in conversations
            </span>
          </div>

          <div className="text-caption-1-medium text-text-secondary shrink-0">
            {admittedKnocks} admitted of {totalKnocks} total knocks
          </div>
        </div>

        {filteredKnocks.length === 0 ? (
          <div className="p-6 text-center text-text-tertiary text-body-2-regular rounded-2xl bg-background-secondary-default/40 border border-border-button-default">
            No virtual office knocks recorded during this timeframe. When visitors knock on your door at your public office link, their topics and session history will appear here.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {filteredKnocks.slice(0, 6).map((knock) => (
              <div
                key={knock.id}
                className="p-3.5 sm:p-4 rounded-2xl bg-background-secondary-default/50 border border-border-button-default flex flex-col justify-between gap-3 shadow-2xs"
              >
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Avatar
                        size="sm"
                        initials={knock.guestName.slice(0, 2).toUpperCase()}
                        color="blue"
                      />
                      <span className="text-body-2-medium font-semibold text-text-primary truncate">
                        {knock.guestName}
                      </span>
                    </div>

                    <Chip
                      color={
                        knock.status === "admitted" || knock.status === "concluded"
                          ? "lime"
                          : knock.status === "ringing"
                          ? "yellow"
                          : "neutral"
                      }
                      variant="caption"
                    >
                      {knock.status}
                    </Chip>
                  </div>

                  <p className="text-body-2-regular text-text-secondary italic line-clamp-2">
                    &ldquo;{knock.topic}&rdquo;
                  </p>
                </div>

                <div className="pt-2 border-t border-border-button-default/50 text-caption-2-medium text-text-tertiary flex items-center justify-between">
                  <span>{new Date(knock.createdAt).toLocaleDateString()}</span>
                  <span>{new Date(knock.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
