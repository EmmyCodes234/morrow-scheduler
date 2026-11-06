"use client";

import { useState, useEffect } from "react";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/base/modal/modal";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { Textarea } from "@/components/base/textarea/textarea";
import { HugeVideo, HugeClock, HugeCheck, HugeDelete, HugeGlobe } from "@/components/icons/hugeicons";

export interface EventFormData {
  id?: string;
  title: string;
  duration: number;
  slug: string;
  description?: string;
  location?: string;
  locationType?: "google_meet" | "zoom" | "phone" | "in_person";
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
  const [locationType, setLocationType] = useState<"google_meet" | "zoom" | "phone" | "in_person">(
    event?.locationType || (defaultLocation.toLowerCase().includes("zoom") ? "zoom" : "google_meet")
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    if (event) {
      setTitle(event.title);
      setDuration(event.duration);
      setSlug(event.slug);
      setDescription(event.description || "");
      setLocationType(event.locationType || (defaultLocation.toLowerCase().includes("zoom") ? "zoom" : "google_meet"));
    } else {
      setTitle("30 Min Strategy Call");
      setDuration(30);
      setSlug("30min");
      setDescription("");
    }
  }, [event, isOpen]);

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
                    <HugeVideo className="size-4 shrink-0 text-accent-500" />
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
                    <HugeVideo className="size-4 shrink-0 text-[#2D8CFF]" />
                    <div className="flex flex-col min-w-0">
                      <span className="text-body-2-medium font-semibold truncate">Zoom</span>
                      <span className="text-caption-2-medium text-text-tertiary truncate">Personal meeting room</span>
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
