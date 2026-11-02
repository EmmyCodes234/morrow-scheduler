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
  onConfirmReschedule?: (id: string, reason: string) => void;
  onConfirmCancel?: (id: string) => void;
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

  if (!booking) return null;

  return (
    <Modal isOpen={isOpen} onOpenChange={onClose} size="md">
      {({ close }) => (
        <>
          <ModalHeader
            title={mode === "cancelConfirm" ? "Cancel meeting" : "Manage booking"}
            description={
              mode === "cancelConfirm"
                ? "This will cancel the meeting and notify the guest."
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
                    className="w-full rounded-xl border border-border-button-default bg-background-secondary-default px-3 py-2 text-body-medium text-text-primary outline-none focus:border-accent-500"
                  />
                </div>
              ) : (
                <p className="text-body-regular text-text-secondary">
                  Would you like to send a reschedule link to {booking.guestName} or cancel this event?
                </p>
              )}
            </div>
          </ModalBody>

          <ModalFooter>
            {mode === "cancelConfirm" ? (
              <>
                <Button variant="secondary" onClick={() => setMode("choose")}>
                  Back
                </Button>
                <Button
                  variant="danger"
                  onClick={() => {
                    onConfirmCancel?.(booking.id);
                    setMode("choose");
                    close();
                  }}
                >
                  Confirm cancellation
                </Button>
              </>
            ) : (
              <>
                <Button variant="secondary" onClick={close}>
                  Keep meeting
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => setMode("cancelConfirm")}
                >
                  Cancel event
                </Button>
                <Button
                  variant="primary"
                  onClick={() => {
                    onConfirmReschedule?.(booking.id, "Reschedule requested");
                    close();
                  }}
                >
                  Send reschedule link
                </Button>
              </>
            )}
          </ModalFooter>
        </>
      )}
    </Modal>
  );
}
