"use client";

import { useState, useEffect } from "react";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/base/modal/modal";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { Textarea } from "@/components/base/textarea/textarea";
import { HugeVideo, HugeClock, HugeCheck, HugeDelete, HugeGlobe } from "@/components/icons/hugeicons";
import { GoogleMeetIcon } from "@/components/icons/google-meet";
import { ZoomIcon } from "@/components/icons/zoom";
import { MicrosoftTeamsIcon } from "@/components/icons/microsoft-teams";

export interface EventFormData {
  id?: string;
  title: string;
  duration: number;
  slug: string;
  description?: string;
  location?: string;
  locationType?: "google_meet" | "zoom" | "teams" | "phone" | "in_person";
  maxAttendees?: number;
  showRemainingSpots?: boolean;
}

export interface NewEventModalProps {
  isOpen: boolean;
  onClose: () => void;
  event?: EventFormData | null;
  userSlug?: string;
  defaultLocation?: string;
  onSave?: (data: EventFormData) => Promise<void> | void;
  onDelete?: (id: string) => Promise<void> | void;
}

export function NewEventModal({
  isOpen,
  onClose,
  event,
  userSlug = "user",
  defaultLocation = "Google Meet",
  onSave,
  onDelete,
}: NewEventModalProps) {
  const isEditing = Boolean(event?.id);

  const [title, setTitle] = useState(event?.title || "30 Min Strategy Call");
  const [duration, setDuration] = useState<number>(event?.duration || 30);
  const [slug, setSlug] = useState(event?.slug || "30min");
  const [description, setDescription] = useState(event?.description || "");
  const [isGroup, setIsGroup] = useState<boolean>((event?.maxAttendees || 1) > 1);
  const [maxAttendees, setMaxAttendees] = useState<number>(event?.maxAttendees || 10);
  const [showRemainingSpots, setShowRemainingSpots] = useState<boolean>(event?.showRemainingSpots ?? true);
  const [locationType, setLocationType] = useState<"google_meet" | "zoom" | "teams" | "phone" | "in_person">(
    event?.locationType || (
      defaultLocation.toLowerCase().includes("zoom")
        ? "zoom"
        : defaultLocation.toLowerCase().includes("teams")
        ? "teams"
        : "google_meet"
    )
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    if (event) {
      setTitle(event.title);
      setDuration(event.duration);
      setSlug(event.slug);
      setDescription(event.description || "");
      setIsGroup((event.maxAttendees || 1) > 1);
      setMaxAttendees(event.maxAttendees || 10);
      setShowRemainingSpots(event.showRemainingSpots ?? true);
      setLocationType(
        event.locationType || (
          defaultLocation.toLowerCase().includes("zoom")
            ? "zoom"
            : defaultLocation.toLowerCase().includes("teams")
            ? "teams"
            : "google_meet"
        )
      );
    } else {
      setTitle("30 Min Strategy Call");
      setDuration(30);
      setSlug("30min");
      setDescription("");
      setIsGroup(false);
      setMaxAttendees(10);
      setShowRemainingSpots(true);
      setLocationType(
        defaultLocation.toLowerCase().includes("zoom")
          ? "zoom"
          : defaultLocation.toLowerCase().includes("teams")
          ? "teams"
          : "google_meet"
      );
    }
  }, [event, isOpen, defaultLocation]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !slug) return;
    setIsSubmitting(true);
    try {
      await onSave?.({
        id: event?.id,
        title: title.trim(),
        duration,
        slug: slug.trim(),
        description: description.trim(),
        locationType,
        maxAttendees: isGroup ? maxAttendees : 1,
        showRemainingSpots: isGroup ? showRemainingSpots : false,
      });
      onClose();
    } catch (err) {
      console.error("Failed to save event type:", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!event?.id) return;
    if (!confirm("Are you sure you want to delete this event type? This will remove its public booking link.")) return;
    setIsDeleting(true);
    try {
      await onDelete?.(event.id);
      onClose();
    } catch (err) {
      console.error("Failed to delete event type:", err);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onOpenChange={onClose} size="md">
      {({ close }) => (
        <>
          <ModalHeader
            title={isEditing ? "Edit event type" : "Create event type"}
            description={
              isEditing
                ? "Update your meeting duration, title, and public booking link."
                : "Configure a new scheduling link for your profile."
            }
          />

          <ModalBody>
            <form id="new-event-form" onSubmit={handleSubmit} className="flex flex-col gap-4">
              <Input
                label="Event title"
                value={title}
                onChange={(val) => {
                  setTitle(val);
                  if (!isEditing) {
                    setSlug(val.toLowerCase().replace(/[^a-z0-9]/g, "-"));
                  }
                }}
                placeholder="e.g. 30 Min Strategy Call"
                isRequired
              />

              <div className="flex flex-col gap-1.5">
                <span className="text-body-medium text-text-primary font-medium">
                  Duration
                </span>
                <div className="grid grid-cols-4 gap-2">
                  {[15, 30, 45, 60].map((mins) => (
                    <button
                      key={mins}
                      type="button"
                      onClick={() => setDuration(mins)}
                      className={`py-2 px-3 rounded-lg text-body-medium font-medium transition-all cursor-pointer text-center ${
                        duration === mins
                          ? "bg-accent-500 text-white shadow-xs"
                          : "border border-border-button-default bg-background-secondary-default text-text-secondary hover:text-text-primary"
                      }`}
                    >
                      {mins}m
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <span className="text-body-medium text-text-primary font-medium">
                  Format
                </span>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setIsGroup(false)}
                    className={`py-2 px-3 rounded-xl border text-body-medium font-medium transition-all cursor-pointer text-center ${
                      !isGroup
                        ? "border-accent-500 bg-accent-50/20 text-accent-700 font-semibold shadow-2xs"
                        : "border-border-button-default bg-background-secondary-default text-text-secondary hover:text-text-primary"
                    }`}
                  >
                    1-on-1 Meeting
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsGroup(true)}
                    className={`py-2 px-3 rounded-xl border text-body-medium font-medium transition-all cursor-pointer text-center ${
                      isGroup
                        ? "border-accent-500 bg-accent-50/20 text-accent-700 font-semibold shadow-2xs"
                        : "border-border-button-default bg-background-secondary-default text-text-secondary hover:text-text-primary"
                    }`}
                  >
                    Group Event (Webinar / Class)
                  </button>
                </div>
              </div>

              {isGroup && (
                <div className="flex flex-col gap-3 p-3.5 rounded-2xl border border-border-button-default bg-background-secondary-default">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex flex-col">
                      <span className="text-body-2-medium text-text-primary font-semibold">
                        Max Attendees per Slot
                      </span>
                      <span className="text-caption-2-medium text-text-tertiary">
                        Maximum guests who can join the same timeslot
                      </span>
                    </div>
                    <input
                      type="number"
                      min={2}
                      max={100}
                      value={maxAttendees}
                      onChange={(e) => setMaxAttendees(Math.max(2, Math.min(100, parseInt(e.target.value) || 2)))}
                      className="w-20 px-3 py-1.5 rounded-xl border border-border-button-default bg-background-primary-default text-text-primary text-center font-semibold outline-none"
                    />
                  </div>

                  <label className="flex items-center gap-2.5 cursor-pointer select-none pt-1">
                    <input
                      type="checkbox"
                      checked={showRemainingSpots}
                      onChange={(e) => setShowRemainingSpots(e.target.checked)}
                      className="rounded text-accent-500 focus:ring-accent-500"
                    />
                    <span className="text-body-2-regular text-text-secondary">
                      Show remaining spots to guests (e.g. &quot;3 spots left&quot;)
                    </span>
                  </label>
                </div>
              )}

              <div>
                <span className="block text-body-medium text-text-primary mb-1.5 font-medium">
                  Link slug
                </span>
                <div className="flex items-center rounded-xl border border-border-button-default bg-background-secondary-default px-3 py-2 text-body-medium text-text-secondary">
                  <span className="text-text-tertiary select-none">usemorrow.xyz/{userSlug}/</span>
                  <input
                    type="text"
                    value={slug}
                    onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                    className="w-full bg-transparent text-text-primary outline-none font-medium ps-0.5"
                    required
                  />
                </div>
              </div>

              <Textarea
                label="Description (optional)"
                value={description}
                onChange={setDescription}
                placeholder="Brief description shown to guests booking this call."
                rows={2}
              />

              <div className="flex flex-col gap-1.5">
                <span className="text-body-medium text-text-primary font-medium">
                  Meeting Location
                </span>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setLocationType("google_meet")}
                    className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer flex items-center gap-2.5 ${
                      locationType === "google_meet"
                        ? "border-accent-500 bg-accent-50/20 text-text-primary shadow-2xs"
                        : "border-border-button-default bg-background-secondary-default text-text-secondary hover:text-text-primary"
                    }`}
                  >
                    <GoogleMeetIcon className="size-5 shrink-0" />
                    <div className="flex flex-col min-w-0">
                      <span className="text-body-2-medium font-semibold truncate">Google Meet</span>
                      <span className="text-caption-2-medium text-text-tertiary truncate">Auto web conference</span>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setLocationType("zoom")}
                    className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer flex items-center gap-2.5 ${
                      locationType === "zoom"
                        ? "border-[#2D8CFF] bg-[#2D8CFF]/10 text-text-primary shadow-2xs"
                        : "border-border-button-default bg-background-secondary-default text-text-secondary hover:text-text-primary"
                    }`}
                  >
                    <ZoomIcon className="size-5 shrink-0" />
                    <div className="flex flex-col min-w-0">
                      <span className="text-body-2-medium font-semibold truncate">Zoom</span>
                      <span className="text-caption-2-medium text-text-tertiary truncate">Personal meeting room</span>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setLocationType("teams")}
                    className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer flex items-center gap-2.5 ${
                      locationType === "teams"
                        ? "border-[#5B5FC7] bg-[#5B5FC7]/10 text-text-primary shadow-2xs"
                        : "border-border-button-default bg-background-secondary-default text-text-secondary hover:text-text-primary"
                    }`}
                  >
                    <MicrosoftTeamsIcon className="size-5 shrink-0" />
                    <div className="flex flex-col min-w-0">
                      <span className="text-body-2-medium font-semibold truncate">Teams</span>
                      <span className="text-caption-2-medium text-text-tertiary truncate">Microsoft Teams</span>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setLocationType("phone")}
                    className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer flex items-center gap-2.5 ${
                      locationType === "phone"
                        ? "border-accent-500 bg-accent-50/20 text-text-primary shadow-2xs"
                        : "border-border-button-default bg-background-secondary-default text-text-secondary hover:text-text-primary"
                    }`}
                  >
                    <HugeClock className="size-4 shrink-0 text-accent-500" />
                    <div className="flex flex-col min-w-0">
                      <span className="text-body-2-medium font-semibold truncate">Phone Call</span>
                      <span className="text-caption-2-medium text-text-tertiary truncate">Host calls guest</span>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setLocationType("in_person")}
                    className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer flex items-center gap-2.5 ${
                      locationType === "in_person"
                        ? "border-accent-500 bg-accent-50/20 text-text-primary shadow-2xs"
                        : "border-border-button-default bg-background-secondary-default text-text-secondary hover:text-text-primary"
                    }`}
                  >
                    <HugeGlobe className="size-4 shrink-0 text-accent-500" />
                    <div className="flex flex-col min-w-0">
                      <span className="text-body-2-medium font-semibold truncate">In Person</span>
                      <span className="text-caption-2-medium text-text-tertiary truncate">Physical location</span>
                    </div>
                  </button>
                </div>
              </div>
            </form>
          </ModalBody>

          <ModalFooter>
            <div className="w-full flex items-center justify-between">
              {isEditing && onDelete ? (
                <Button
                  variant="danger"
                  size="small"
                  disabled={isDeleting}
                  onClick={handleDelete}
                  leadingIcon={HugeDelete}
                >
                  {isDeleting ? "Deleting..." : "Delete"}
                </Button>
              ) : (
                <div />
              )}

              <div className="flex items-center gap-2">
                <Button variant="secondary" onClick={close} disabled={isSubmitting || isDeleting}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  form="new-event-form"
                  variant="primary"
                  disabled={isSubmitting || isDeleting}
                >
                  {isSubmitting
                    ? "Saving..."
                    : isEditing
                    ? "Save changes"
                    : "Create event type"}
                </Button>
              </div>
            </div>
          </ModalFooter>
        </>
      )}
    </Modal>
  );
}
