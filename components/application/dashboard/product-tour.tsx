"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/base/buttons/button";
import { Chip } from "@/components/base/badges/chip";
import { Kbd } from "@/components/base/kbd/kbd";
import {
  HugeArrowRight,
  HugeArrowLeft,
  HugeClose,
  HugeCheck,
  HugeSparkles,
} from "@/components/icons/hugeicons";
import { cx } from "@/utils/cx";

export interface TourStep {
  id: string;
  targetSelector: string;
  title: string;
  description: string;
  tip?: string;
  badge?: string;
  preferredPlacement?: "bottom" | "top" | "left" | "right";
}

export const DASHBOARD_TOUR_STEPS: TourStep[] = [
  {
    id: "event-types",
    targetSelector: '[data-tour="event-types-card"]',
    title: "Active Event Types",
    description:
      "These are your shareable meeting types. Each one connects to Google Meet, respects your buffer rules, and generates custom booking links.",
    tip: "Use the toggle switch on any card to pause or activate it instantly.",
    badge: "Step 1 of 4",
    preferredPlacement: "bottom",
  },
  {
    id: "share-link",
    targetSelector: '[data-tour="copy-link-btn"]',
    title: "Share Your Public Booking Link",
    description:
      "Copy your master booking link in one click. Add it to your email signature or message it directly to clients and guests.",
    tip: "Morrow automatically translates slots into your guest's local timezone.",
    badge: "Step 2 of 4",
    preferredPlacement: "bottom",
  },
  {
    id: "working-hours",
    targetSelector: '[data-tour="nav-working-hours"]',
    title: "Working Hours & Availability",
    description:
      "Define standard days and time windows when you're open for calls. Morrow cross-checks your Google Calendar so you're never double-booked.",
    tip: "Buffer times automatically cushion meetings to prevent back-to-backs.",
    badge: "Step 3 of 4",
    preferredPlacement: "right",
  },
  {
    id: "new-event",
    targetSelector: '[data-tour="new-event-btn"]',
    title: "Create Custom Event Types",
    description:
      "Need a 15-minute quick catchup, a 45-minute demo, or a 1-hour coaching session? Create unlimited customized meeting types in seconds.",
    tip: "You can set custom locations, questions, and approval rules.",
    badge: "Step 4 of 4",
    preferredPlacement: "bottom",
  },
];

interface ProductTourProps {
  isOpen: boolean;
  onClose: () => void;
  steps?: TourStep[];
}

export function ProductTour({
  isOpen,
  onClose,
  steps = DASHBOARD_TOUR_STEPS,
}: ProductTourProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number }>({
    top: 0,
    left: 0,
  });
  const [isVisible, setIsVisible] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  const step = steps[currentStep];

  // Measure target and calculate card placement
  const updateTargetPosition = useCallback(() => {
    if (!isOpen || !step) return false;

    const el = document.querySelector(step.targetSelector);
    if (!el) {
      // If target isn't found immediately, fallback to viewport center
      setTargetRect(null);
      setPopoverPos({
        top: window.innerHeight / 2 - 130,
        left: window.innerWidth / 2 - Math.min(380, window.innerWidth - 32) / 2,
      });
      return false;
    }

    // Scroll into view smoothly if not visible
    el.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });

    const rect = el.getBoundingClientRect();
    setTargetRect(rect);

    const cardWidth = Math.min(380, window.innerWidth - 32);
    const cardHeight = 260; // Estimated height
    const padding = 16;
    const offset = 14;

    let top = 0;
    let left = 0;
    const placement = step.preferredPlacement || "bottom";

    if (placement === "bottom") {
      top = rect.bottom + offset;
      left = rect.left + rect.width / 2 - cardWidth / 2;
    } else if (placement === "top") {
      top = rect.top - cardHeight - offset;
      left = rect.left + rect.width / 2 - cardWidth / 2;
    } else if (placement === "right") {
      left = rect.right + offset;
      top = rect.top + rect.height / 2 - cardHeight / 2;
    } else if (placement === "left") {
      left = rect.left - cardWidth - offset;
      top = rect.top + rect.height / 2 - cardHeight / 2;
    }

    // Screen edge boundary clamping
    left = Math.max(padding, Math.min(window.innerWidth - cardWidth - padding, left));
    top = Math.max(padding, Math.min(window.innerHeight - cardHeight - padding, top));

    setPopoverPos({ top, left });
    return true;
  }, [isOpen, step]);

  // Recalculate on step change, resize, and scroll
  useEffect(() => {
    if (!isOpen) {
      setIsVisible(false);
      return;
    }

    // Initial attempt
    const found = updateTargetPosition();
    setIsVisible(true);

    // If target not in DOM yet (e.g. data fetching), poll briefly until it renders
    let pollInterval: NodeJS.Timeout | null = null;
    if (!found) {
      let attempts = 0;
      pollInterval = setInterval(() => {
        attempts++;
        if (updateTargetPosition() || attempts > 20) {
          if (pollInterval) clearInterval(pollInterval);
        }
      }, 100);
    }

    const handleResize = () => updateTargetPosition();
    const handleScroll = () => updateTargetPosition();

    window.addEventListener("resize", handleResize);
    window.addEventListener("scroll", handleScroll, true);

    return () => {
      if (pollInterval) clearInterval(pollInterval);
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [isOpen, currentStep, updateTargetPosition]);

  // Keyboard navigation (Arrow keys and Escape)
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleComplete();
      } else if (e.key === "ArrowRight") {
        if (currentStep < steps.length - 1) {
          setCurrentStep((prev) => prev + 1);
        } else {
          handleComplete();
        }
      } else if (e.key === "ArrowLeft") {
        if (currentStep > 0) {
          setCurrentStep((prev) => prev - 1);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, currentStep, steps.length]);

  const handleNext = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep((prev) => prev + 1);
    } else {
      handleComplete();
    }
  };

  const handlePrev = () => {
    if (currentStep > 0) {
      setCurrentStep((prev) => prev - 1);
    }
  };

  const handleComplete = () => {
    try {
      localStorage.setItem("morrow_tour_completed_v1", "true");
    } catch {}
    setIsVisible(false);
    onClose();
  };

  if (!isOpen) return null;

  const targetPad = 6;
  const isLast = currentStep === steps.length - 1;

  return (
    <div
      className={cx(
        "fixed inset-0 z-50 transition-opacity duration-300",
        isVisible ? "opacity-100" : "opacity-0 pointer-events-none"
      )}
      role="dialog"
      aria-label="Morrow Product Tour"
      aria-modal="true"
    >
      {/* SVG Spotlight Cutout Backdrop */}
      <svg
        className="fixed inset-0 size-full pointer-events-auto"
        style={{ fillRule: "evenodd" }}
      >
        <defs>
          <mask id="tour-spotlight-mask">
            {/* White covers all (opaque mask) */}
            <rect width="100%" height="100%" fill="white" />
            {/* Black cutout over target element */}
            {targetRect && (
              <rect
                x={targetRect.left - targetPad}
                y={targetRect.top - targetPad}
                width={targetRect.width + targetPad * 2}
                height={targetRect.height + targetPad * 2}
                rx={16}
                ry={16}
                fill="black"
              />
            )}
          </mask>
        </defs>
        {/* Shaded backdrop rectangle with mask applied */}
        <rect
          width="100%"
          height="100%"
          fill="rgba(15, 23, 42, 0.65)"
          mask="url(#tour-spotlight-mask)"
          onClick={handleComplete}
        />
      </svg>

      {/* Target Focus Ring / Glow Frame */}
      {targetRect && (
        <div
          style={{
            top: targetRect.top - targetPad,
            left: targetRect.left - targetPad,
            width: targetRect.width + targetPad * 2,
            height: targetRect.height + targetPad * 2,
          }}
          className="fixed pointer-events-none rounded-2xl ring-2 ring-accent-500 shadow-[0_0_28px_rgba(59,130,246,0.45)] transition-all duration-300 ease-out"
        />
      )}

      {/* Floating Tour Popover Card */}
      <div
        ref={cardRef}
        style={{
          top: popoverPos.top,
          left: popoverPos.left,
          width: "min(380px, calc(100vw - 32px))",
        }}
        className={cx(
          "fixed z-50 rounded-3xl border border-border-button-default bg-background-primary-default p-5 shadow-2xl",
          "flex flex-col gap-4 text-text-primary backdrop-blur-md transition-all duration-300 ease-out",
          "animate-in fade-in zoom-in-95 duration-200"
        )}
      >
        {/* Top Header: Badge + Step Indicator Dots + Close Button */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Chip color="blue" variant="bold">
              {step.badge || `Step ${currentStep + 1} of ${steps.length}`}
            </Chip>
            {/* Progress Pill Bar */}
            <div className="flex items-center gap-1.5 ms-1">
              {steps.map((_, i) => (
                <div
                  key={i}
                  className={cx(
                    "h-1.5 rounded-full transition-all duration-300",
                    i === currentStep
                      ? "w-5 bg-accent-500"
                      : i < currentStep
                      ? "w-2 bg-accent-500/50"
                      : "w-2 bg-background-tertiary-default"
                  )}
                />
              ))}
            </div>
          </div>

          <button
            type="button"
            onClick={handleComplete}
            aria-label="Close tour"
            className="flex size-7 items-center justify-center rounded-lg text-text-tertiary hover:bg-background-secondary-hover hover:text-text-primary transition-colors"
          >
            <HugeClose className="size-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex flex-col gap-2">
          <h4 className="text-title-3-semibold text-text-primary flex items-center gap-2">
            <span>{step.title}</span>
          </h4>
          <p className="text-body-2-regular text-text-secondary leading-relaxed">
            {step.description}
          </p>

          {step.tip && (
            <div className="flex items-start gap-2 rounded-xl border border-border-button-default bg-background-secondary-default p-3 mt-1">
              <HugeSparkles className="size-4 shrink-0 text-accent-500 mt-0.5" />
              <p className="text-caption-1-semibold text-text-tertiary leading-normal">
                {step.tip}
              </p>
            </div>
          )}
        </div>

        {/* Bottom Actions Row */}
        <div className="flex items-center justify-between pt-1 border-t border-separator-border">
          <button
            type="button"
            onClick={handleComplete}
            className="text-caption-1-semibold text-text-tertiary hover:text-text-primary transition-colors"
          >
            Skip tour
          </button>

          <div className="flex items-center gap-2">
            {currentStep > 0 && (
              <Button
                variant="secondary"
                size="small"
                leadingIcon={HugeArrowLeft}
                onClick={handlePrev}
              >
                Back
              </Button>
            )}

            <Button
              variant="primary"
              size="small"
              trailingIcon={isLast ? HugeCheck : HugeArrowRight}
              onClick={handleNext}
            >
              {isLast ? "Get Started" : "Next"}
            </Button>
          </div>
        </div>

        {/* Keyboard shortcut footnote */}
        <div className="flex items-center justify-center gap-1.5 text-caption-1-semibold text-text-placeholder pt-0.5">
          <span>Use</span>
          <Kbd>←</Kbd>
          <Kbd>→</Kbd>
          <span>to navigate</span>
          <span>•</span>
          <Kbd>Esc</Kbd>
          <span>to exit</span>
        </div>
      </div>
    </div>
  );
}
