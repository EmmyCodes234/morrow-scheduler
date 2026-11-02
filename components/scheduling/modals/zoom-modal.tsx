"use client";

import { useState, useEffect } from "react";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/base/modal/modal";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { HugeVideo, HugeCheck, HugeLink } from "@/components/icons/hugeicons";

export interface ZoomModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentZoomUrl?: string;
  isZoomActive?: boolean;
  onSaveZoom: (url: string, setActive: boolean) => Promise<void>;
  onDisableZoom?: () => Promise<void>;
}

export function ZoomModal({
  isOpen,
  onClose,
  currentZoomUrl = "",
  isZoomActive = false,
  onSaveZoom,
  onDisableZoom,
}: ZoomModalProps) {
  const [zoomUrl, setZoomUrl] = useState(currentZoomUrl);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setZoomUrl(currentZoomUrl);
    setError(null);
  }, [currentZoomUrl, isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = zoomUrl.trim();
    if (!trimmed) {
      setError("Please enter your Zoom Personal Meeting URL or vanity link.");
      return;
    }
    if (!trimmed.startsWith("https://") && !trimmed.startsWith("http://")) {
      setError("Please enter a valid URL starting with https:// (e.g. https://zoom.us/j/...)");
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      await onSaveZoom(trimmed, true);
      onClose();
    } catch (err: any) {
      setError(err?.message || "Failed to save Zoom settings.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDisable = async () => {
    setIsSubmitting(true);
    try {
      if (onDisableZoom) {
        await onDisableZoom();
      }
      onClose();
    } catch (err: any) {
      setError(err?.message || "Failed to switch provider.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onOpenChange={onClose} size="md">
      {({ close }) => (
        <>
          <ModalHeader
            title="Connect Zoom Meetings"
            description="Use your personal Zoom meeting room for video calls scheduled through Morrow."
          />

          <ModalBody>
            <form id="zoom-form" onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="p-3.5 rounded-2xl border border-border-button-default bg-background-secondary-default flex items-start gap-3">
                <div className="size-8 rounded-xl bg-accent-50 text-accent-600 flex items-center justify-center shrink-0 mt-0.5">
                  <HugeVideo className="size-4" />
                </div>
                <div className="flex flex-col gap-0.5 text-body-2-regular text-text-secondary">
                  <span className="font-medium text-text-primary">How it works</span>
                  <span>
                    When a guest books time with you, Morrow automatically includes your Zoom meeting room link in the confirmation email and calendar invites.
                  </span>
                </div>
              </div>

              <Input
                label="Personal Meeting Link"
                value={zoomUrl}
                onChange={(val) => {
                  setZoomUrl(val);
                  if (error) setError(null);
                }}
                placeholder="https://zoom.us/j/1234567890"
                leadingIcon={HugeLink}
                isRequired
                hint="Found in your Zoom Profile under Personal Meeting ID (PMI)."
              />

              {error && (
                <div className="text-body-2-regular text-text-error-primary p-2.5 rounded-xl border border-border-error-default bg-background-secondary-default">
                  {error}
                </div>
              )}
            </form>
          </ModalBody>

          <ModalFooter>
            <div className="w-full flex items-center justify-between">
              {isZoomActive && onDisableZoom ? (
                <Button
                  variant="danger"
                  size="small"
                  disabled={isSubmitting}
                  onClick={handleDisable}
                >
                  Switch to Google Meet
                </Button>
              ) : (
                <div />
              )}

              <div className="flex items-center gap-2">
                <Button variant="secondary" onClick={close} disabled={isSubmitting}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  form="zoom-form"
                  variant="primary"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? "Saving..." : "Save & Enable Zoom"}
                </Button>
              </div>
            </div>
          </ModalFooter>
        </>
      )}
    </Modal>
  );
}
