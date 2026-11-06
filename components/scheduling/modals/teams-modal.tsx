"use client";

import { useState, useEffect } from "react";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/base/modal/modal";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { HugeVideo, HugeLink } from "@/components/icons/hugeicons";
import { MicrosoftTeamsIcon } from "@/components/icons/microsoft-teams";

export interface TeamsModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentTeamsUrl?: string;
  isTeamsActive?: boolean;
  onSaveTeams: (url: string, setActive: boolean) => Promise<void>;
  onDisableTeams?: () => Promise<void>;
}

export function TeamsModal({
  isOpen,
  onClose,
  currentTeamsUrl = "",
  isTeamsActive = false,
  onSaveTeams,
  onDisableTeams,
}: TeamsModalProps) {
  const [teamsUrl, setTeamsUrl] = useState(currentTeamsUrl);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTeamsUrl(currentTeamsUrl);
    setError(null);
  }, [currentTeamsUrl, isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = teamsUrl.trim();
    if (!trimmed) {
      setError("Please enter your Microsoft Teams meeting URL.");
      return;
    }
    if (!trimmed.startsWith("https://") && !trimmed.startsWith("http://")) {
      setError("Please enter a valid URL starting with https:// (e.g. https://teams.microsoft.com/...)");
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      await onSaveTeams(trimmed, true);
      onClose();
    } catch (err: any) {
      setError(err?.message || "Failed to save Microsoft Teams settings.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDisable = async () => {
    setIsSubmitting(true);
    try {
      if (onDisableTeams) {
        await onDisableTeams();
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
            title="Connect Microsoft Teams"
            description="Use your Microsoft Teams meeting link for video calls scheduled through Morrow."
          />

          <ModalBody>
            <form id="teams-form" onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="p-3.5 rounded-2xl border border-border-button-default bg-background-secondary-default flex items-start gap-3">
                <MicrosoftTeamsIcon className="size-8 shrink-0 mt-0.5" />
                <div className="flex flex-col gap-0.5 text-body-2-regular text-text-secondary">
                  <span className="font-medium text-text-primary">How it works</span>
                  <span>
                    When a guest books an event configured for Teams, Morrow automatically includes your Microsoft Teams meeting link in the confirmation email, calendar invites, and join page.
                  </span>
                </div>
              </div>

              <Input
                label="Microsoft Teams Meeting Link"
                value={teamsUrl}
                onChange={(val) => {
                  setTeamsUrl(val);
                  if (error) setError(null);
                }}
                placeholder="https://teams.microsoft.com/l/meetup-join/..."
                leadingIcon={HugeLink}
                isRequired
                hint="In Teams: Click Calendar → Meet now → Copy meeting link, or paste a recurring team meeting link."
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
              {isTeamsActive && onDisableTeams ? (
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
                  form="teams-form"
                  variant="primary"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? "Saving..." : "Save & Enable Teams"}
                </Button>
              </div>
            </div>
          </ModalFooter>
        </>
      )}
    </Modal>
  );
}
