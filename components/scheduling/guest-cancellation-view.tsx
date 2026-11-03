"use client";

import { useState } from "react";
import Link from "next/link";
import { MorrowIcon } from "@/components/brand/morrow-logo";
import { Button } from "@/components/base/buttons/button";
import { Textarea } from "@/components/base/textarea/textarea";
import {
  RiCalendarLine,
  RiTimeLine,
  RiUserLine,
  RiCloseCircleLine,
  RiCheckboxCircleLine,
  RiAlertLine,
  RiArrowRightLine,
} from "@remixicon/react";
import type { PublicBookingCancellationSummary } from "@/lib/scheduling/cancellation-service";

interface GuestCancellationViewProps {
  token: string;
  initialBooking: PublicBookingCancellationSummary | null;
}

export function GuestCancellationView({
  token,
  initialBooking,
}: GuestCancellationViewProps) {
  const [booking] = useState<PublicBookingCancellationSummary | null>(
    initialBooking
  );
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [cancellationCompleted, setCancellationCompleted] = useState(
    initialBooking?.status === "cancelled"
  );
  const [submittedReason, setSubmittedReason] = useState<string | null>(
    initialBooking?.cancellationReason || null
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // 1. Not Found State
  if (!booking) {
    return (
      <div className="w-full max-w-md mx-auto">
        <div className="bg-background-primary-default border border-border-button-default rounded-3xl p-6 sm:p-8 shadow-sm text-center">
          <div className="w-12 h-12 rounded-full bg-red-50 text-red-600 flex items-center justify-center mx-auto mb-4">
            <RiCloseCircleLine className="w-6 h-6" />
          </div>
          <h1 className="text-title-2-medium text-text-primary mb-2">
            Booking Not Found
          </h1>
          <p className="text-body-regular text-text-secondary mb-6">
            This cancellation link is invalid or has expired. If you need to cancel, please check the link in your confirmation email or contact your host directly.
          </p>
          <Link href="/">
            <Button variant="secondary" className="w-full">
              Go to Morrow
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  // 2. Cancellation Success State (either just completed or previously completed)
  if (cancellationCompleted) {
    return (
      <div className="w-full max-w-md mx-auto">
        <div className="bg-background-primary-default border border-border-button-default rounded-3xl p-6 sm:p-8 shadow-sm">
          <div className="w-12 h-12 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto mb-4">
            <RiCheckboxCircleLine className="w-6 h-6" />
          </div>

          <h1 className="text-title-2-medium text-text-primary text-center mb-1">
            Booking Cancelled
          </h1>
          <p className="text-body-regular text-text-secondary text-center mb-6">
            Your meeting with {booking.hostName} has been cancelled. We’ve released the time slot and notified your host.
          </p>

          <div className="bg-background-secondary-default rounded-2xl p-4 border border-separator-border mb-6 space-y-3">
            <div className="text-caption-1-semibold uppercase tracking-wider text-text-tertiary">
              Meeting Details
            </div>
            <div className="text-body-medium text-text-primary font-semibold">
              {booking.eventTitle}
            </div>

            <div className="space-y-1.5 text-body-2-regular text-text-secondary">
              <div className="flex items-center gap-2">
                <RiUserLine className="w-4 h-4 text-foreground-icon-tertiary shrink-0" />
                <span>Host: {booking.hostName}</span>
              </div>
              <div className="flex items-center gap-2">
                <RiCalendarLine className="w-4 h-4 text-foreground-icon-tertiary shrink-0" />
                <span>{booking.dateStr}</span>
              </div>
              <div className="flex items-center gap-2">
                <RiTimeLine className="w-4 h-4 text-foreground-icon-tertiary shrink-0" />
                <span>
                  {booking.timeStr} ({booking.timezone})
                </span>
              </div>
            </div>

            {(submittedReason || booking.cancellationReason) && (
              <div className="pt-2 border-t border-separator-border text-body-2-regular text-text-secondary">
                <span className="font-medium text-text-primary">Reason: </span>
                {submittedReason || booking.cancellationReason}
              </div>
            )}
          </div>

          {booking.hostSlug ? (
            <Link href={`/${booking.hostSlug}`}>
              <Button
                variant="primary"
                className="w-full"
                trailingIcon={RiArrowRightLine}
              >
                Schedule Another Time
              </Button>
            </Link>
          ) : (
            <Link href="/">
              <Button variant="secondary" className="w-full">
                Go to Morrow
              </Button>
            </Link>
          )}
        </div>
      </div>
    );
  }

  // 3. Ineligible States (Past Meeting, Rejected, Completed)
  if (!booking.canCancel) {
    let title = "Cannot Cancel Booking";
    let message = "This booking cannot be cancelled.";

    if (booking.isPast) {
      title = "Meeting Already Passed";
      message = "This scheduled appointment has already taken place and can no longer be cancelled.";
    } else if (booking.status === "rejected") {
      title = "Request Was Declined";
      message = "This booking request was already declined by the host.";
    } else if (booking.status === "completed") {
      title = "Meeting Completed";
      message = "This booking has been marked as completed.";
    }

    return (
      <div className="w-full max-w-md mx-auto">
        <div className="bg-background-primary-default border border-border-button-default rounded-3xl p-6 sm:p-8 shadow-sm text-center">
          <div className="w-12 h-12 rounded-full bg-amber-50 text-amber-600 flex items-center justify-center mx-auto mb-4">
            <RiAlertLine className="w-6 h-6" />
          </div>
          <h1 className="text-title-2-medium text-text-primary mb-2">
            {title}
          </h1>
          <p className="text-body-regular text-text-secondary mb-6">
            {message}
          </p>

          <div className="bg-background-secondary-default rounded-2xl p-4 border border-separator-border mb-6 text-start space-y-2">
            <div className="text-body-medium text-text-primary font-semibold">
              {booking.eventTitle}
            </div>
            <div className="text-body-2-regular text-text-secondary space-y-1">
              <div>Host: {booking.hostName}</div>
              <div>When: {booking.dateStr} at {booking.timeStr} ({booking.timezone})</div>
            </div>
          </div>

          {booking.hostSlug && (
            <Link href={`/${booking.hostSlug}`}>
              <Button variant="secondary" className="w-full">
                View {booking.hostName}&apos;s Availability
              </Button>
            </Link>
          )}
        </div>
      </div>
    );
  }

  // 4. Eligible Cancellation Form
  const isPending = booking.status === "pending";
  const actionLabel = isPending ? "Cancel Request" : "Cancel Booking";

  const handleConfirmCancel = async () => {
    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const res = await fetch(`/api/cancel/${token}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          reason: reason.trim() || undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        setErrorMessage(data.error || "Failed to cancel booking. Please try again.");
        setIsSubmitting(false);
        return;
      }

      setSubmittedReason(reason.trim() || null);
      setCancellationCompleted(true);
    } catch {
      setErrorMessage("Network error. Please check your connection and try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="w-full max-w-lg mx-auto">
      <div className="bg-background-primary-default border border-border-button-default rounded-3xl p-6 sm:p-8 shadow-sm">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <MorrowIcon size={28} />
            <span className="font-bold text-title-3-semibold text-text-primary">
              Morrow
            </span>
          </div>

          <span
            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-caption-1-semibold ${
              isPending
                ? "bg-amber-50 text-amber-700 border border-amber-200"
                : "bg-blue-50 text-blue-700 border border-blue-200"
            }`}
          >
            {isPending ? "Pending Request" : "Confirmed"}
          </span>
        </div>

        <h1 className="text-title-1-medium text-text-primary mb-2">
          {isPending ? "Cancel your booking request?" : "Cancel your appointment?"}
        </h1>
        <p className="text-body-regular text-text-secondary mb-6">
          Cancelling will free up this time slot and immediately notify {booking.hostName}.
        </p>

        {/* Meeting Details Card */}
        <div className="bg-background-secondary-default rounded-2xl p-4 border border-separator-border mb-6 space-y-3">
          <div className="text-body-medium text-text-primary font-semibold">
            {booking.eventTitle}
          </div>

          <div className="space-y-2 text-body-2-regular text-text-secondary">
            <div className="flex items-center gap-2.5">
              <RiUserLine className="w-4 h-4 text-foreground-icon-tertiary shrink-0" />
              <span>With <strong className="text-text-primary">{booking.hostName}</strong></span>
            </div>
            <div className="flex items-center gap-2.5">
              <RiCalendarLine className="w-4 h-4 text-foreground-icon-tertiary shrink-0" />
              <span>{booking.dateStr}</span>
            </div>
            <div className="flex items-center gap-2.5">
              <RiTimeLine className="w-4 h-4 text-foreground-icon-tertiary shrink-0" />
              <span>{booking.timeStr} ({booking.timezone})</span>
            </div>
          </div>
        </div>

        {/* Optional Reason Input */}
        <div className="mb-6">
          <Textarea
            label={
              <span>
                Reason for cancellation{" "}
                <span className="text-text-tertiary font-normal">(optional)</span>
              </span>
            }
            placeholder="Let the host know why you need to cancel..."
            value={reason}
            onChange={(val) => setReason(val)}
            maxLength={500}
            showCount
            rows={3}
            isDisabled={isSubmitting}
            className="w-full"
          />
        </div>

        {/* Error Alert */}
        {errorMessage && (
          <div className="p-3 mb-6 rounded-xl bg-red-50 border border-red-200 text-text-error-primary text-body-2-regular flex items-start gap-2">
            <RiAlertLine className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Actions */}
        <div className="space-y-3">
          <Button
            variant="danger"
            size="medium"
            className="w-full"
            onClick={handleConfirmCancel}
            disabled={isSubmitting}
          >
            {isSubmitting ? "Cancelling..." : actionLabel}
          </Button>

          {booking.hostSlug ? (
            <Link href={`/${booking.hostSlug}`} className="block">
              <Button
                variant="ghost"
                size="medium"
                className="w-full text-text-secondary"
                disabled={isSubmitting}
              >
                Never mind, keep booking
              </Button>
            </Link>
          ) : (
            <Link href="/" className="block">
              <Button
                variant="ghost"
                size="medium"
                className="w-full text-text-secondary"
                disabled={isSubmitting}
              >
                Never mind, keep booking
              </Button>
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
