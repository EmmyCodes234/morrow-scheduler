"use client";

import { useState } from "react";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/base/modal/modal";
import { Button } from "@/components/base/buttons/button";
import { HugeCalendar } from "@/components/icons/hugeicons";
import { RiAlertLine } from "@remixicon/react";

export interface RescheduleModalProps {
  isOpen: boolean;
  onClose: () => void;
  booking?: {
    id: string;
    guestName: string;
    guestEmail: string;
    eventTitle: string;
    date: string;
    time: string;
  } | null;
  onConfirmReschedule?: (id: string, reason: string) => Promise<void> | void;
  onConfirmCancel?: (id: string, reason?: string) => Promise<void | boolean> | void;
}

export function RescheduleModal({
  isOpen,
  onClose,
  booking,
  onConfirmCancel,
}: RescheduleModalProps) {
  const [mode, setMode] = useState<"choose" | "cancelConfirm">("choose");
  const [reason, setReason] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!booking) return null;

  const handleModalClose = () => {
    setMode("choose");
    setReason("");
    setError(null);
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onOpenChange={handleModalClose} size="md">
      {({ close }) => (
        <>
          <ModalHeader
            title={mode === "cancelConfirm" ? "Cancel meeting" : "Manage booking"}
            description={
              mode === "cancelConfirm"
                ? "This will cancel the meeting and update your schedule."
                : `Booking with ${booking.guestName}`
            }
          />

          <ModalBody>
            <div className="flex flex-col gap-4">
              {/* SUMMARY BOX */}
              <div className="rounded-2xl border border-border-button-default bg-background-secondary-default p-4 flex flex-col gap-2">
                <span className="text-body-medium font-medium text-text-primary">
                  {booking.eventTitle}
                </span>
                <div className="flex items-center gap-2 text-body-2-regular text-text-secondary">
                  <HugeCalendar className="size-4" />
                  <span>{booking.date} at {booking.time}</span>
                </div>
                <div className="flex items-center gap-2 text-body-2-regular text-text-secondary">
                  <span>Guest: {booking.guestName} ({booking.guestEmail})</span>
                </div>
              </div>

              {error && (
                <div className="p-3 rounded-xl bg-background-secondary-default border border-border-error-default text-text-error-primary text-body-2-regular flex items-start gap-2">
                  <RiAlertLine className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              {mode === "cancelConfirm" ? (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span className="text-body-medium text-text-primary font-medium">
                      Reason for cancellation (optional)
                    </span>
                    <span className="text-caption-1-regular text-text-tertiary">
                      {reason.length}/500
                    </span>
                  </div>
                  <input
                    type="text"
                    value={reason}
                    maxLength={500}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="e.g. Schedule conflict"
                    disabled={isProcessing}
                    className="w-full rounded-xl border border-border-button-default bg-background-secondary-default px-3 py-2 text-body-medium text-text-primary outline-none focus:ring-2 focus:ring-border-focus-ring"
                  />
                </div>
              ) : (
                <p className="text-body-regular text-text-secondary">
                  Would you like to cancel this scheduled meeting?
                </p>
              )}
            </div>
          </ModalBody>

          <ModalFooter>
            {mode === "cancelConfirm" ? (
              <>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setError(null);
                    setMode("choose");
                  }}
                  disabled={isProcessing}
                >
                  Back
                </Button>
                <Button
                  variant="danger"
                  disabled={isProcessing}
                  onClick={async () => {
                    setIsProcessing(true);
                    setError(null);
                    try {
                      await onConfirmCancel?.(booking.id, reason.trim() || undefined);
                      setMode("choose");
                      setReason("");
                      close();
                    } catch (err) {
                      setError(err instanceof Error ? err.message : "Failed to cancel meeting.");
                    } finally {
                      setIsProcessing(false);
                    }
                  }}
                >
                  {isProcessing ? "Cancelling..." : "Confirm cancellation"}
                </Button>
              </>
            ) : (
              <>
                <Button variant="secondary" onClick={close} disabled={isProcessing}>
                  Keep meeting
                </Button>
                <Button
                  variant="danger"
                  disabled={isProcessing}
                  onClick={() => {
                    setError(null);
                    setMode("cancelConfirm");
                  }}
                >
                  Cancel event
                </Button>
              </>
            )}
          </ModalFooter>
        </>
      )}
    </Modal>
  );
}
