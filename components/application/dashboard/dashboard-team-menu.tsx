"use client";

import { useState, useEffect, type ReactNode } from "react";
import {
  Button as AriaButton,
  Dialog as AriaDialog,
  DialogTrigger as AriaDialogTrigger,
  Popover as AriaPopover,
} from "react-aria-components";
import { useDirection } from "@/components/foundations/direction/direction";
import { Avatar } from "@/components/base/avatar/avatar";
import { ThemeToggle } from "@/components/application/theme/theme-toggle";
import { ChevronDownSmall } from "@/components/foundations/icons/chevrons";
import {
  HugeSettings,
  HugeLogout,
  HugeUser,
} from "@/components/icons/hugeicons";
import { cx } from "@/utils/cx";

function Collapsible({ collapsed, children }: { collapsed: boolean; children: ReactNode }) {
  return (
    <span
      className={cx(
        "flex min-w-0 items-center overflow-hidden transition-[max-width,opacity,filter] duration-300 ease-in-out",
        collapsed ? "max-w-0 opacity-0 blur-[3px]" : "max-w-40 opacity-100 blur-0",
      )}
    >
      {children}
    </span>
  );
}

export function DashboardTeamMenu({
  collapsed = false,
  className,
  userName = "Account",
  userEmail = "",
  initials = "U",
  onOpenSettings,
  onSignOut,
}: {
  collapsed?: boolean;
  className?: string;
  userName?: string;
  userEmail?: string;
  initials?: string;
  onOpenSettings?: () => void;
  onSignOut?: () => void;
}) {
  const direction = useDirection();
  const [isOpen, setIsOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    setIsMobile(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return (
    <AriaDialogTrigger isOpen={isOpen} onOpenChange={setIsOpen}>
      <AriaButton
        aria-label={`${userName}'s account`}
        className={cx(
          "flex cursor-pointer items-center overflow-hidden outline-none",
          "border-2 border-transparent hover:border-border-button-hover",
          "transition-[width,background-color,border-color,padding] duration-300 ease-in-out",
          "focus-visible:ring-2 focus-visible:ring-border-focus-ring focus-visible:ring-offset-2",
          collapsed
            ? "size-9 justify-start rounded-full bg-transparent p-0"
            : "w-full justify-between rounded-xl bg-background-tertiary-default py-2 pe-3 ps-2.5",
          className,
        )}
      >
        <span className="flex min-w-0 items-center gap-2">
          <Avatar size="md" color="blue" initials={initials} />
          <Collapsible collapsed={collapsed}>
            <span className="flex min-w-0 flex-col items-start justify-center">
              <span className="text-body-medium font-medium whitespace-nowrap text-text-primary">
                {userName}
              </span>
              <span className="text-body-2-regular whitespace-nowrap text-text-secondary truncate max-w-[140px]">
                {userEmail}
              </span>
            </span>
          </Collapsible>
        </span>
        <Collapsible collapsed={collapsed}>
          <span className="flex size-4 shrink-0 items-center justify-center rounded-[3px] bg-background-tertiary-hover">
            <ChevronDownSmall
              className={cx(
                "size-4 text-text-secondary transition-transform duration-200 ease",
                isOpen && "rotate-180"
              )}
            />
          </span>
        </Collapsible>
      </AriaButton>

      <AriaPopover
        placement={isMobile ? "bottom start" : direction === "rtl" ? "left bottom" : "right bottom"}
        offset={8}
        className={cx(
          "w-[265px] max-w-[calc(100vw-32px)] origin-bottom-left overflow-y-auto",
          "rounded-2xl border border-border-button-default bg-background-primary-default p-2.5 shadow-dropdown",
          "transition duration-150 ease-out",
          "data-[entering]:opacity-0 data-[entering]:scale-95 data-[entering]:blur-[2px]",
          "data-[exiting]:opacity-0 data-[exiting]:scale-95 data-[exiting]:blur-[2px]",
        )}
      >
        <AriaDialog aria-label="Account details" className="flex flex-col gap-2 outline-none">
          {/* Header */}
          <div className="flex w-full items-center gap-2.5 px-2 py-1.5 border-b border-border-button-default">
            <Avatar size="md" color="blue" initials={initials} />
            <div className="flex min-w-0 flex-col items-start justify-center">
              <span className="text-body-medium font-medium whitespace-nowrap text-text-primary">
                {userName}
              </span>
              <span className="text-body-2-regular whitespace-nowrap text-text-secondary truncate max-w-[160px]">
                {userEmail}
              </span>
            </div>
          </div>

          {/* Menu rows */}
          <div className="flex w-full flex-col gap-1 pt-1">
            <button
              type="button"
              onClick={() => {
                setIsOpen(false);
                onOpenSettings?.();
              }}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-body-medium text-text-primary hover:bg-background-secondary-hover cursor-pointer transition-colors"
            >
              <HugeSettings className="size-4 text-foreground-icon-secondary" />
              <span>Settings</span>
            </button>

            {/* Theme Toggle row */}
            <div className="flex w-full items-center justify-between px-2.5 py-1.5">
              <span className="text-body-medium text-text-secondary">Theme</span>
              <ThemeToggle appearance="segmented" size="small" />
            </div>

            <div className="-mx-2.5 my-1 h-px bg-border-button-default" />

            <button
              type="button"
              onClick={() => {
                setIsOpen(false);
                onSignOut?.();
              }}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-body-medium text-text-error-primary hover:bg-status-red-background/30 cursor-pointer transition-colors"
            >
              <HugeLogout className="size-4 text-text-error-primary" />
              <span>Sign out</span>
            </button>
          </div>
        </AriaDialog>
      </AriaPopover>
    </AriaDialogTrigger>
  );
}
