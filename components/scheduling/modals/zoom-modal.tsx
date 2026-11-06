"use client";

import { useState, useEffect } from "react";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/base/modal/modal";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { Chip } from "@/components/base/badges/chip";
import { HugeVideo, HugeCheck, HugeLink } from "@/components/icons/hugeicons";

export interface ZoomModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentZoomUrl?: string;
  zoomEmail?: string | null;
  isZoomActive?: boolean;
  onSaveZoom: (url: string, setActive: boolean) => Promise<void>;
  onDisableZoom?: () => Promise<void>;
  onDisconnectOAuth?: () => Promise<void>;
}

export function ZoomModal({
  isOpen,
  onClose,
  currentZoomUrl = "",
  zoomEmail = null,
  isZoomActive = false,
  onSaveZoom,
  onDisableZoom,
  onDisconnectOAuth,
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

  const handleDisconnect = async () => {
    setIsSubmitting(true);
    try {
      if (onDisconnectOAuth) {
        await onDisconnectOAuth();
      }
      onClose();
    } catch (err: any) {
      setError(err?.message || "Failed to disconnect Zoom account.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onOpenChange={onClose} size="md">
      {({ close }) => (
        <>
          <ModalHeader
            title="Zoom Video Integration"
            description="Connect your Zoom account to auto-generate unique video links, or use your personal meeting room."
          />

          <ModalBody>
            <div className="flex flex-col gap-4">
              {/* OAUTH 1-CLICK CONNECTION */}
              {zoomEmail ? (
                <div className="p-4 rounded-2xl border border-border-button-default bg-background-secondary-default flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="size-8 rounded-xl bg-[#2D8CFF]/15 text-[#2D8CFF] flex items-center justify-center shrink-0">
                        <HugeVideo className="size-4" />
                      </div>
                      <span className="text-body-medium font-semibold text-text-primary">
                        Zoom Connected
                      </span>
                    </div>
                    <Chip color="lime" variant="bold">OAuth Active</Chip>
                  </div>
                  <p className="text-body-2-regular text-text-secondary">
                    Connected as <span className="font-semibold text-text-primary">{zoomEmail}</span>. Dedicated meeting links and passcodes are created automatically for every booking.
                  </p>
                  <div className="flex justify-end pt-1">
                    <Button
                      variant="danger"
                      size="xs"
                      disabled={isSubmitting}
                      onClick={handleDisconnect}
                    >
                      {isSubmitting ? "Disconnecting..." : "Disconnect Zoom Account"}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="p-4 rounded-2xl border border-border-button-default bg-background-secondary-default flex flex-col gap-3">
                  <div className="flex items-start gap-3">
                    <div className="size-8 rounded-xl bg-[#2D8CFF]/15 text-[#2D8CFF] flex items-center justify-center shrink-0 mt-0.5">
                      <HugeVideo className="size-4" />
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-body-2-medium font-semibold text-text-primary">
                        Dynamic Per-Booking Rooms (Recommended)
                      </span>
                      <span className="text-caption-1-medium text-text-secondary">
                        Generates a fresh, private Zoom meeting ID and passcode for every guest so back-to-back calls never collide.
                      </span>
                    </div>
                  </div>

                  <Button
                    variant="primary"
                    size="medium"
                    leadingIcon={HugeVideo}
                    onClick={() => {
                      window.location.href = "/api/integrations/zoom/connect";
                    }}
                    className="w-full justify-center bg-[#2D8CFF] hover:bg-[#1E74E0] border-transparent text-white font-semibold shadow-xs"
                  >
                    Connect Zoom Account (1-Click OAuth)
                  </Button>
                </div>
              )}

              {/* DIVIDER */}
              <div className="flex items-center gap-3 my-1">
                <div className="flex-1 h-px bg-border-button-default" />
                <span className="text-caption-2-medium uppercase tracking-wider text-text-tertiary font-semibold">
                  Or use personal link (PMI)
                </span>
                <div className="flex-1 h-px bg-border-button-default" />
              </div>

              {/* PERSONAL MEETING LINK FORM */}
              <form id="zoom-form" onSubmit={handleSubmit} className="flex flex-col gap-3">
                <Input
                  label="Personal Meeting Link (Optional Fallback)"
                  value={zoomUrl}
                  onChange={(val) => {
                    setZoomUrl(val);
                    if (error) setError(null);
                  }}
                  placeholder="https://zoom.us/j/1234567890"
                  leadingIcon={HugeLink}
                  hint="Used as fallback when guests book through personal link."
                />

                {error && (
                  <div className="text-body-2-regular text-text-error-primary p-2.5 rounded-xl border border-border-error-default bg-background-secondary-default">
                    {error}
                  </div>
                )}
              </form>
            </div>
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
                  {isSubmitting ? "Saving..." : "Save Link"}
                </Button>
              </div>
            </div>
          </ModalFooter>
        </>
      )}
    </Modal>
  );
}
