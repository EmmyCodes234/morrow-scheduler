"use client";

import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/base/modal/modal";
import { Button } from "@/components/base/buttons/button";
import { Badge } from "@/components/base/badges/badge";
import { Chip } from "@/components/base/badges/chip";
import { GoogleCalendarIcon } from "@/components/icons/google-calendar";
import { HugeCheck, HugeClock, HugeCalendar } from "@/components/icons/hugeicons";
import { signIn } from "next-auth/react";

export interface GCalModalProps {
  isOpen: boolean;
  onClose: () => void;
  userEmail?: string;
  isConnected?: boolean;
}

export function GCalModal({
  isOpen,
  onClose,
  userEmail = "",
  isConnected = true,
}: GCalModalProps) {
  return (
    <Modal isOpen={isOpen} onOpenChange={onClose} size="md">
      {({ close }) => (
        <>
          <ModalHeader
            title="Google Calendar Integration"
            description="Manage your calendar synchronization and event scheduling permissions."
          />

          <ModalBody>
            <div className="flex flex-col gap-4">
              <div className="p-4 rounded-2xl border border-border-button-default bg-background-primary-default flex items-center justify-between shadow-2xs">
                <div className="flex items-center gap-3">
                  <GoogleCalendarIcon className="size-9 shrink-0" />
                  <div className="flex flex-col">
                    <span className="text-body-medium font-semibold text-text-primary">
                      {userEmail}
                    </span>
                    <span className="text-body-2-regular text-text-secondary">
                      Primary Google Calendar
                    </span>
                  </div>
                </div>

                <Chip color="lime" variant="bold">
                  Synchronized
                </Chip>
              </div>

              <div className="p-4 rounded-2xl border border-border-button-default bg-background-secondary-default flex flex-col gap-3">
                <span className="text-body-medium font-medium text-text-primary">
                  Active Permissions
                </span>

                <div className="flex flex-col gap-2.5">
                  <div className="flex items-start gap-2.5 text-body-2-regular text-text-secondary">
                    <HugeCheck className="size-4 shrink-0 text-status-lime-text mt-0.5" />
                    <span>
                      <strong className="text-text-primary font-medium">Free/Busy Availability:</strong>{" "}
                      Morrow queries busy blocks to automatically prevent double-bookings.
                    </span>
                  </div>

                  <div className="flex items-start gap-2.5 text-body-2-regular text-text-secondary">
                    <HugeCheck className="size-4 shrink-0 text-status-lime-text mt-0.5" />
                    <span>
                      <strong className="text-text-primary font-medium">Meeting Invitations:</strong>{" "}
                      Confirmed bookings are added directly to your calendar with Google Meet details.
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </ModalBody>

          <ModalFooter>
            <Button variant="secondary" onClick={close}>
              Close
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                signIn("google", { callbackUrl: "/dashboard", redirectTo: "/dashboard" });
              }}
            >
              Re-authenticate Calendar
            </Button>
          </ModalFooter>
        </>
      )}
    </Modal>
  );
}
