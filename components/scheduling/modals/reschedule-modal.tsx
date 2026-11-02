"use client";

import { useState } from "react";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/base/modal/modal";
import { Button } from "@/components/base/buttons/button";
import { HugeCalendar, HugeClock, HugeClose, HugeCheck } from "@/components/icons/hugeicons";

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
  onConfirmCancel?: (id: string) => Promise<void> | void;
}

export function RescheduleModal({
  isOpen,
  onClose,
  booking,
  onConfirmReschedule,
  onConfirmCancel,
}: RescheduleModalProps) {
  const [mode, setMode] = useState<"choose" | "cancelConfirm">("choose");
  const [reason, setReason] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);

  if (!booking) return null;

  return (
    <Modal isOpen={isOpen} onOpenChange={onClose} size="md">
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

              {mode === "cancelConfirm" ? (
                <div className="flex flex-col gap-2">
                  <span className="text-body-medium text-text-primary font-medium">
                    Reason for cancellation (optional)
                  </span>
                  <input
                    type="text"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="e.g. Schedule conflict"
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
                <Button variant="secondary" onClick={() => setMode("choose")} disabled={isProcessing}>
                  Back
                </Button>
                <Button
                  variant="destructive"
                  disabled={isProcessing}
                  onClick={async () => {
                    setIsProcessing(true);
                    try {
                      await onConfirmCancel?.(booking.id);
                      setMode("choose");
                      close();
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
                  variant="destructive"
                  disabled={isProcessing}
                  onClick={() => setMode("cancelConfirm")}
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
