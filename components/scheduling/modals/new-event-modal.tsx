"use client";

import { useState } from "react";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/base/modal/modal";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { HugeVideo, HugeClock, HugeCheck } from "@/components/icons/hugeicons";

export interface NewEventModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave?: (event: { title: string; duration: number; slug: string }) => void;
}

export function NewEventModal({ isOpen, onClose, onSave }: NewEventModalProps) {
  const [title, setTitle] = useState("30 Min Strategy Call");
  const [duration, setDuration] = useState<number>(30);
  const [slug, setSlug] = useState("30min");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !slug) return;
    onSave?.({ title, duration, slug });
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onOpenChange={onClose} size="md">
      {({ close }) => (
        <>
          <ModalHeader
            title="Create event type"
            description="Configure a new scheduling link for your profile."
          />

          <ModalBody>
            <form id="new-event-form" onSubmit={handleSubmit} className="flex flex-col gap-4">
              <Input
                label="Event title"
                value={title}
                onChange={(val) => {
                  setTitle(val);
                  setSlug(val.toLowerCase().replace(/[^a-z0-9]/g, "-"));
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
                  <span className="text-text-tertiary select-none">usemorrow.xyz/alex/</span>
                  <input
                    type="text"
                    value={slug}
                    onChange={(e) => setSlug(e.target.value)}
                    className="w-full bg-transparent text-text-primary outline-none font-medium ps-0.5"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2.5 p-3.5 rounded-xl border border-border-button-default bg-background-secondary-default text-body-medium text-text-secondary">
                <HugeVideo className="size-4 shrink-0 text-accent-500" />
                <span>Location: Google Meet (link added automatically)</span>
              </div>
            </form>
          </ModalBody>

          <ModalFooter>
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" form="new-event-form" variant="primary">
              Save event type
            </Button>
          </ModalFooter>
        </>
      )}
    </Modal>
  );
}
