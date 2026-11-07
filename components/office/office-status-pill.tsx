"use client";

import { useState } from "react";
import {
  Dropdown,
  DropdownTrigger,
  DropdownPopover,
  DropdownGroup,
  DropdownItem,
  DropdownDivider,
} from "@/components/base/dropdown/dropdown";
import { Chip } from "@/components/base/badges/chip";
import {
  HugeCheck,
  HugeCopy,
  HugeLink,
  HugeVideo,
  HugeClock,
} from "@/components/icons/hugeicons";
import { cx } from "@/utils/cx";

interface OfficeStatusPillProps {
  status: "open" | "busy" | "closed";
  slug: string;
  speedChatMins?: number;
  onUpdateStatus: (newStatus: "open" | "busy" | "closed") => Promise<void>;
  onUpdateSpeedChatMins?: (mins: number) => Promise<void>;
  compact?: boolean;
}

export function OfficeStatusPill({
  status,
  slug,
  speedChatMins = 10,
  onUpdateStatus,
  onUpdateSpeedChatMins,
  compact = false,
}: OfficeStatusPillProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopyLink = () => {
    const url = `https://usemorrow.xyz/${slug}/office`;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const statusConfig = {
    open: {
      label: "Office Open",
      dotClass: "bg-status-lime-text",
      chipColor: "lime" as const,
      pulse: true,
    },
    busy: {
      label: "In Meeting",
      dotClass: "bg-status-yellow-text",
      chipColor: "yellow" as const,
      pulse: false,
    },
    closed: {
      label: "Office Closed",
      dotClass: "bg-text-tertiary",
      chipColor: "soft" as const,
      pulse: false,
    },
  }[status];

  return (
    <Dropdown isOpen={isOpen} onOpenChange={setIsOpen}>
      <DropdownTrigger
        aria-label="Change office hours status"
        className={cx(
          "inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-border-button-default",
          "bg-background-primary-default hover:bg-background-secondary-hover transition-colors text-body-medium"
        )}
      >
        <span className="relative flex size-2.5">
          {statusConfig.pulse && (
            <span className={cx("animate-ping absolute inline-flex h-full w-full rounded-full opacity-75", statusConfig.dotClass)} />
          )}
          <span className={cx("relative inline-flex rounded-full size-2.5", statusConfig.dotClass)} />
        </span>
        <span className="text-body-medium font-medium text-text-primary">
          {compact ? (status === "open" ? "Open" : status === "busy" ? "Busy" : "Closed") : statusConfig.label}
        </span>
        {!compact && (
          <Chip color={statusConfig.chipColor} variant="caption">
            {speedChatMins}m chat
          </Chip>
        )}
      </DropdownTrigger>

      <DropdownPopover aria-label="Office status menu" placement="bottom end" className="w-[280px]">
        <DropdownGroup label="Office Door Status">
          <DropdownItem
            selected={status === "open"}
            onSelect={() => {
              onUpdateStatus("open");
              setIsOpen(false);
            }}
          >
            <div className="flex items-center justify-between w-full">
              <div className="flex items-center gap-2">
                <span className="size-2 rounded-full bg-status-lime-text" />
                <span className="text-body-medium text-text-primary">Open for Knocks</span>
              </div>
              {status === "open" && <HugeCheck className="size-4 text-accent-600" />}
            </div>
          </DropdownItem>

          <DropdownItem
            selected={status === "busy"}
            onSelect={() => {
              onUpdateStatus("busy");
              setIsOpen(false);
            }}
          >
            <div className="flex items-center justify-between w-full">
              <div className="flex items-center gap-2">
                <span className="size-2 rounded-full bg-status-yellow-text" />
                <span className="text-body-medium text-text-primary">Busy (Hold knocks)</span>
              </div>
              {status === "busy" && <HugeCheck className="size-4 text-accent-600" />}
            </div>
          </DropdownItem>

          <DropdownItem
            selected={status === "closed"}
            onSelect={() => {
              onUpdateStatus("closed");
              setIsOpen(false);
            }}
          >
            <div className="flex items-center justify-between w-full">
              <div className="flex items-center gap-2">
                <span className="size-2 rounded-full bg-text-tertiary" />
                <span className="text-body-medium text-text-primary">Closed (To Calendar)</span>
              </div>
              {status === "closed" && <HugeCheck className="size-4 text-accent-600" />}
            </div>
          </DropdownItem>
        </DropdownGroup>

        <DropdownDivider />

        <DropdownGroup label="Speed-Chat Limit">
          <div className="flex items-center gap-1.5 px-2 py-1">
            {[5, 10, 15, 20].map((mins) => (
              <button
                key={mins}
                type="button"
                onClick={() => {
                  onUpdateSpeedChatMins?.(mins);
                  setIsOpen(false);
                }}
                className={cx(
                  "flex-1 py-1 rounded-lg text-caption-1-semibold border transition-colors cursor-pointer",
                  speedChatMins === mins
                    ? "bg-accent-600 text-white border-transparent"
                    : "bg-background-secondary-default text-text-secondary border-border-button-default hover:bg-background-secondary-hover"
                )}
              >
                {mins}m
              </button>
            ))}
          </div>
        </DropdownGroup>

        <DropdownDivider />

        <DropdownGroup>
          <DropdownItem onSelect={handleCopyLink}>
            <div className="flex items-center gap-2 text-body-medium text-text-primary">
              {copied ? <HugeCheck className="size-4 text-status-lime-text" /> : <HugeCopy className="size-4 text-text-secondary" />}
              <span>{copied ? "Office link copied" : "Copy office link"}</span>
            </div>
          </DropdownItem>

          <DropdownItem onSelect={() => window.open(`/${slug}/office`, "_blank")}>
            <div className="flex items-center gap-2 text-body-medium text-text-primary">
              <HugeLink className="size-4 text-text-secondary" />
              <span>Preview office door</span>
            </div>
          </DropdownItem>
        </DropdownGroup>
      </DropdownPopover>
    </Dropdown>
  );
}
