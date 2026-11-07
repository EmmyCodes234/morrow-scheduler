"use client";

import type { ComponentType } from "react";
import {
  HugeLink,
  HugeCalendar,
  HugeCheckIn,
  HugeAnalytics,
  HugeSettings,
} from "@/components/icons/hugeicons";
import { cx } from "@/utils/cx";

export type DashboardBottomNavTab = "events" | "bookings" | "office" | "analytics" | "settings";

interface DashboardBottomNavProps {
  activeTab: string;
  onSelectTab: (tab: DashboardBottomNavTab) => void;
  bookingsCount?: number;
  ringingKnocksCount?: number;
  isOfficeOpen?: boolean;
}

interface NavItemDef {
  key: DashboardBottomNavTab;
  label: string;
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" | "false" }>;
  badge?: number | string | null;
  hasPulseBadge?: boolean;
  pulseColor?: "lime" | "rose";
}

export function DashboardBottomNav({
  activeTab,
  onSelectTab,
  bookingsCount = 0,
  ringingKnocksCount = 0,
  isOfficeOpen = false,
}: DashboardBottomNavProps) {
  // Map settings sub-tabs to "settings"
  const resolvedActiveTab: DashboardBottomNavTab =
    activeTab === "availability" || activeTab === "integrations"
      ? "settings"
      : (activeTab as DashboardBottomNavTab);

  const items: NavItemDef[] = [
    {
      key: "events",
      label: "Events",
      icon: HugeLink,
    },
    {
      key: "bookings",
      label: "Bookings",
      icon: HugeCalendar,
      badge: bookingsCount > 0 ? bookingsCount : null,
    },
    {
      key: "office",
      label: "Office",
      icon: HugeCheckIn,
      badge: ringingKnocksCount > 0 ? ringingKnocksCount : null,
      hasPulseBadge: ringingKnocksCount > 0 || isOfficeOpen,
      pulseColor: ringingKnocksCount > 0 ? "rose" : "lime",
    },
    {
      key: "analytics",
      label: "Analytics",
      icon: HugeAnalytics,
    },
    {
      key: "settings",
      label: "Settings",
      icon: HugeSettings,
    },
  ];

  return (
    <nav
      aria-label="Mobile Bottom Navigation"
      className="fixed bottom-0 inset-x-0 z-40 bg-background-primary-default/95 backdrop-blur-md border-t border-border-button-default pb-[env(safe-area-inset-bottom,0px)] lg:hidden select-none shadow-lg transition-colors"
    >
      <div className="flex items-center justify-around h-16 px-1 max-w-lg mx-auto">
        {items.map((item) => {
          const isSelected = resolvedActiveTab === item.key;
          const Icon = item.icon;

          return (
            <button
              key={item.key}
              type="button"
              onClick={() => onSelectTab(item.key)}
              aria-current={isSelected ? "page" : undefined}
              aria-label={item.label}
              className={cx(
                "relative flex-1 flex flex-col items-center justify-center py-1.5 px-1 min-h-[48px] rounded-2xl cursor-pointer transition-all duration-150 touch-manipulation",
                isSelected
                  ? "text-accent-600 dark:text-accent-400"
                  : "text-text-secondary hover:text-text-primary active:scale-95"
              )}
            >
              <div
                className={cx(
                  "relative flex items-center justify-center px-3 py-1 rounded-full transition-all duration-150",
                  isSelected
                    ? "bg-accent-50 dark:bg-accent-950/40"
                    : "bg-transparent"
                )}
              >
                <Icon
                  className={cx(
                    "size-5 transition-transform duration-150",
                    isSelected
                      ? "text-accent-600 dark:text-accent-400 scale-105"
                      : "text-foreground-icon-secondary"
                  )}
                  aria-hidden
                />

                {/* Number Badge (e.g. bookings count or knock count) */}
                {typeof item.badge === "number" && item.badge > 0 && (
                  <span
                    className={cx(
                      "absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full text-[10px] font-bold flex items-center justify-center text-white shadow-xs",
                      item.key === "office" ? "bg-status-rose-text animate-pulse" : "bg-accent-600"
                    )}
                  >
                    {item.badge > 99 ? "99+" : item.badge}
                  </span>
                )}

                {/* Pulse Dot Badge (for live open office or knock when no number) */}
                {!item.badge && item.hasPulseBadge && (
                  <span className="absolute top-0.5 right-1.5 flex size-2">
                    <span
                      className={cx(
                        "animate-ping absolute inline-flex h-full w-full rounded-full opacity-75",
                        item.pulseColor === "rose" ? "bg-status-rose-text" : "bg-status-lime-text"
                      )}
                    />
                    <span
                      className={cx(
                        "relative inline-flex rounded-full size-2",
                        item.pulseColor === "rose" ? "bg-status-rose-text" : "bg-status-lime-text"
                      )}
                    />
                  </span>
                )}
              </div>

              <span
                className={cx(
                  "text-caption-2-medium leading-tight mt-0.5 whitespace-nowrap transition-colors",
                  isSelected
                    ? "font-semibold text-accent-600 dark:text-accent-400"
                    : "text-text-secondary"
                )}
              >
                {item.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
