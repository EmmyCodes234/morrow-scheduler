"useclient";

import { useState, useEffect, type ReactNode } from "react";
import {
  Button as AriaButton,
  Dialog as AriaDialog,
  DialogTrigger as AriaDialogTrigger,
  Popover as AriaPopover,
} from "react-aria-components";
import { useDirection } from "@/components/foundations/direction/direction";
import { Avatar } from "@/components/base/avatar/avatar";
import { Button } from "@/components/base/buttons/button";
import { ChevronUpDownSmall } from "@/components/foundations/icons/chevrons";
import {
  HugeLink,
  HugeCopy,
  HugeCheck,
  HugeArrowRight,
} from "@/components/icons/hugeicons";
import { MorrowIcon } from "@/components/brand/morrow-logo";
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

export function DashboardUserMenu({
  collapsed = false,
  suppressHover = false,
  onHoverSuppressionEnd,
  avatarClassName,
  workspaceName = "My Workspace",
  slug = "",
  initials = "M",
}: {
  collapsed?: boolean;
  suppressHover?: boolean;
  onHoverSuppressionEnd?: () => void;
  avatarClassName?: string;
  workspaceName?: string;
  slug?: string;
  initials?: string;
}) {
  const direction = useDirection();
  const [isOpen, setIsOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    setIsMobile(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const handleCopyLink = () => {
    navigator.clipboard.writeText(`https://usemorrow.xyz/${slug}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <AriaDialogTrigger isOpen={isOpen} onOpenChange={setIsOpen}>
      <AriaButton
        aria-label={`${workspaceName}'s workspace`}
        onPointerLeave={() => {
          if (suppressHover) onHoverSuppressionEnd?.();
        }}
        className={cx(
          "relative flex min-w-0 cursor-pointer items-center gap-2 rounded-full outline-none",
          "focus-visible:ring-2 focus-visible:ring-border-focus-ring focus-visible:ring-offset-2",
          "before:pointer-events-none before:absolute before:-inset-x-1.5 before:-inset-y-[5px] before:rounded-full before:border-2 before:border-transparent before:transition-colors before:duration-150",
          !suppressHover && "hover:before:border-border-sidebar-profile-hover",
          collapsed && "w-9 justify-center gap-0 before:-inset-x-[3px]",
        )}
      >
        <MorrowIcon size={32} className={avatarClassName} />
        <Collapsible collapsed={collapsed}>
          <span className="flex items-center gap-0.5">
            <span className="text-body-medium font-medium whitespace-nowrap text-text-primary">
              {workspaceName}
            </span>
            <ChevronUpDownSmall className="size-4 shrink-0 text-foreground-icon-tertiary" />
          </span>
        </Collapsible>
      </AriaButton>

      <AriaPopover
        placement={isMobile ? "bottom start" : direction === "rtl" ? "left top" : "right top"}
        offset={8}
        className={cx(
          "w-[265px] max-w-[calc(100vw-32px)] origin-top-left overflow-y-auto",
          "rounded-2xl border border-border-button-default bg-background-primary-default p-3 shadow-dropdown",
          "transition duration-150 ease-out",
          "data-[entering]:opacity-0 data-[entering]:scale-95 data-[entering]:blur-[2px]",
          "data-[exiting]:opacity-0 data-[exiting]:scale-95 data-[exiting]:blur-[2px]",
        )}
      >
        <AriaDialog aria-label="Workspace details" className="flex flex-col gap-3 outline-none">
          <div className="flex flex-col gap-1 px-1">
            <span className="text-caption-1-semibold uppercase tracking-wider text-text-tertiary">
              Workspace
            </span>
            <div className="flex items-center gap-2 pt-1">
              <Avatar size="sm" initials={initials} color="blue" />
              <div className="flex flex-col min-w-0">
                <span className="text-body-medium font-medium text-text-primary truncate">
                  {workspaceName}
                </span>
                <span className="text-body-2-regular text-text-secondary truncate">
                  usemorrow.xyz/{slug}
                </span>
              </div>
            </div>
          </div>

          <div className="-mx-3 h-px bg-border-button-default" />

          <div className="flex flex-col gap-1">
            <button
              type="button"
              onClick={handleCopyLink}
              className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-body-medium text-text-primary hover:bg-background-secondary-hover cursor-pointer transition-colors"
            >
              <span className="flex items-center gap-2">
                {copied ? <HugeCheck className="size-4 text-status-lime-text" /> : <HugeCopy className="size-4 text-foreground-icon-secondary" />}
                <span>{copied ? "Link copied" : "Copy link"}</span>
              </span>
              <span className="text-caption-1-semibold text-text-tertiary">Public</span>
            </button>

            <a
              href={`/${slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-body-medium text-text-primary hover:bg-background-secondary-hover cursor-pointer transition-colors"
            >
              <span className="flex items-center gap-2">
                <HugeLink className="size-4 text-foreground-icon-secondary" />
                <span>View booking page</span>
              </span>
              <HugeArrowRight className="size-3.5 text-text-tertiary" />
            </a>
          </div>
        </AriaDialog>
      </AriaPopover>
    </AriaDialogTrigger>
  );
}
