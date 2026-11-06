"use client";

import { useState, useMemo } from "react";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/base/modal/modal";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { Textarea } from "@/components/base/textarea/textarea";
import { Chip } from "@/components/base/badges/chip";
import {
  RiCalendarLine,
  RiTimeLine,
  RiFileCopyLine,
  RiCheckLine,
  RiWhatsappLine,
  RiArrowRightLine,
  RiVideoOnLine,
  RiShareLine,
  RiGlobalLine,
} from "@remixicon/react";

export interface NewMeetingModalProps {
  isOpen: boolean;
  onClose: () => void;
  userTimezone?: string;
  onSuccess?: () => void;
}

function getDefaultDateTime() {
  const now = new Date();
  const date = now.toISOString().split("T")[0];
  const minutes = now.getMinutes();
  const roundedMinutes = minutes < 30 ? 30 : 0;
  const roundedHours = (now.getHours() + (minutes < 30 ? 0 : 1)) % 24;
  const time = `${String(roundedHours).padStart(2, "0")}:${String(roundedMinutes).padStart(2, "0")}`;
  return { date, time };
}

const COMMON_TIMEZONES = [
  "Africa/Lagos",
  "Africa/Johannesburg",
  "Africa/Nairobi",
  "Africa/Cairo",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Toronto",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Asia/Dubai",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
  "UTC",
];

export function NewMeetingModal({
  isOpen,
  onClose,
  userTimezone,
  onSuccess,
}: NewMeetingModalProps) {
  const initialTimezone = useMemo(() => {
    if (userTimezone) return userTimezone;
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    } catch {
      return "UTC";
    }
  }, [userTimezone]);

  const initialDateTime = useMemo(() => getDefaultDateTime(), []);

  // Form fields
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(initialDateTime.date);
  const [time, setTime] = useState(initialDateTime.time);
  const [durationMins, setDurationMins] = useState(45);
  const [timezone, setTimezone] = useState(initialTimezone);
  const [preparationMaterial, setPreparationMaterial] = useState("");

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdResult, setCreatedResult] = useState<{
    meeting: any;
    invitationUrl: string;
    roomAccessToken: string;
  } | null>(null);

  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedWhatsApp, setCopiedWhatsApp] = useState(false);

  // Timezones list (Common first, then full IANA deduplicated)
  const allTimezones = useMemo(() => {
    try {
      const iana = Intl.supportedValuesOf("timeZone");
      const set = new Set([initialTimezone, ...COMMON_TIMEZONES, ...iana]);
      return Array.from(set);
    } catch {
      const set = new Set([initialTimezone, ...COMMON_TIMEZONES]);
      return Array.from(set);
    }
  }, [initialTimezone]);

  const handleReset = () => {
    const next = getDefaultDateTime();
    setTitle("");
    setDate(next.date);
    setTime(next.time);
    setDurationMins(45);
    setTimezone(initialTimezone);
    setPreparationMaterial("");
    setCreatedResult(null);
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError("Please enter a meeting title.");
      return;
    }

    if (!date || !time) {
      setError("Please select both a date and start time.");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/meetings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          date,
          startTime: time,
          durationMins,
          timezone,
          description: preparationMaterial.trim() ? preparationMaterial.trim().slice(0, 200) : undefined,
          preparationMaterial: preparationMaterial.trim() || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to create meeting.");
      }

      const roomAccessToken = data.roomAccessToken || data.room?.accessToken;
      if (!roomAccessToken) {
        throw new Error("Server failed to return a valid room access token.");
      }

      setCreatedResult({
        meeting: data.meeting,
        invitationUrl: data.invitationUrl,
        roomAccessToken,
      });

      onSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const fullInvitationUrl = createdResult
    ? typeof window !== "undefined"
      ? `${window.location.origin}${createdResult.invitationUrl}`
      : `https://usemorrow.xyz${createdResult.invitationUrl}`
    : "";

  const formattedStartTime = createdResult
    ? new Intl.DateTimeFormat("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZone: createdResult.meeting.timezone,
        timeZoneName: "short",
      }).format(new Date(createdResult.meeting.startTime))
    : "";

  const whatsappMessage = createdResult
    ? `You're invited to ${createdResult.meeting.title} on Morrow.\nDate & Time: ${formattedStartTime}\nJoin link & agenda: ${fullInvitationUrl}\nNo account needed. Open on your phone to enter the room.`
    : "";

  const handleCopyLink = () => {
    if (!fullInvitationUrl) return;
    navigator.clipboard.writeText(fullInvitationUrl);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2500);
  };

  const handleWhatsAppAction = () => {
    if (!whatsappMessage) return;
    if (typeof navigator !== "undefined" && navigator.share) {
      navigator
        .share({
          title: createdResult?.meeting.title,
          text: whatsappMessage,
          url: fullInvitationUrl,
        })
        .catch(() => {
          window.open(
            `https://wa.me/?text=${encodeURIComponent(whatsappMessage)}`,
            "_blank"
          );
        });
    } else {
      window.open(
        `https://wa.me/?text=${encodeURIComponent(whatsappMessage)}`,
        "_blank"
      );
    }
    setCopiedWhatsApp(true);
    setTimeout(() => setCopiedWhatsApp(false), 2500);
  };

  return (
    <Modal
      isOpen={isOpen}
      onOpenChange={() => {
        handleReset();
        onClose();
      }}
      size="md"
    >
      {({ close }) => (
        <>
          <ModalHeader
            title={createdResult ? "Meeting Invitation Ready" : "New Group Meeting"}
            description={
              createdResult
                ? "Your shareable invitation link has been generated and the Morrow Room is provisioned."
                : "Schedule a group meeting with a persistent room, shareable invite link, and preparation materials."
            }
          />

          <ModalBody className="max-h-[75vh] overflow-y-auto">
            {createdResult ? (
              /* SUCCESS STATE */
              <div className="flex flex-col gap-5 py-1">
                <div className="flex items-center justify-between p-4 rounded-2xl bg-accent-50/60 dark:bg-accent-950/20 border border-accent-200 dark:border-accent-900">
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <span className="text-caption-2-medium text-accent-600 uppercase font-semibold">
                      Room Ready
                    </span>
                    <h3 className="text-body-medium font-semibold text-text-primary truncate">
                      {createdResult.meeting.title}
                    </h3>
                    <span className="text-caption-1-medium text-text-secondary">
                      {formattedStartTime}
                    </span>
                  </div>
                  <Chip color="lime" variant="bold" className="shrink-0">
                    Active
                  </Chip>
                </div>

                {/* Shareable Link Box */}
                <div className="flex flex-col gap-1.5">
                  <span className="text-caption-1-semibold text-text-primary">
                    Shareable Invitation Link (No account required for attendees)
                  </span>
                  <div className="flex items-center gap-2 p-1.5 rounded-xl border border-border-button-default bg-background-secondary-default">
                    <input
                      type="text"
                      readOnly
                      value={fullInvitationUrl}
                      className="w-full bg-transparent text-text-primary text-body-2-medium font-mono ps-2 outline-none select-all truncate"
                    />
                    <Button
                      variant="secondary"
                      size="xs"
                      leadingIcon={copiedLink ? RiCheckLine : RiFileCopyLine}
                      onClick={handleCopyLink}
                    >
                      {copiedLink ? "Copied" : "Copy"}
                    </Button>
                  </div>
                </div>

                {/* 1-Click WhatsApp Share Pre-formatted message */}
                <div className="flex flex-col gap-2 p-3.5 rounded-2xl bg-background-secondary-default/50 border border-border-button-default">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-text-primary font-semibold text-caption-1-semibold">
                      <RiWhatsappLine className="size-4 text-emerald-600" />
                      <span>WhatsApp Invite</span>
                    </div>
                    <Button
                      variant="secondary"
                      size="xs"
                      onClick={handleWhatsAppAction}
                      leadingIcon={RiShareLine}
                    >
                      {copiedWhatsApp ? "Sent!" : "Share / Copy"}
                    </Button>
                  </div>
                  <div className="p-2.5 rounded-xl bg-background-primary-default border border-border-button-default text-caption-2-medium text-text-secondary font-mono whitespace-pre-wrap leading-relaxed select-all">
                    {whatsappMessage}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center justify-between pt-2">
                  <Button
                    variant="primary"
                    size="small"
                    leadingIcon={RiVideoOnLine}
                    trailingIcon={RiArrowRightLine}
                    onClick={() => {
                      window.open(`/room/${createdResult.roomAccessToken}`, "_blank");
                    }}
                  >
                    Enter Room as Host
                  </Button>
                  <Button
                    variant="secondary"
                    size="small"
                    onClick={() => {
                      handleReset();
                      close();
                    }}
                  >
                    Done
                  </Button>
                </div>
              </div>
            ) : (
              /* STREAMLINED CREATION FORM */
              <form onSubmit={handleSubmit} className="flex flex-col gap-4 py-1">
                {error && (
                  <div className="p-3 rounded-xl bg-background-error-default/10 border border-border-error-default text-text-error-primary text-body-2-medium">
                    {error}
                  </div>
                )}

                <Input
                  label="Meeting Title"
                  value={title}
                  onChange={setTitle}
                  placeholder="e.g. Product Review & Planning"
                  isRequired
                />

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-caption-1-semibold text-text-primary">
                      Date <span className="text-text-error-primary">*</span>
                    </label>
                    <div className="relative">
                      <input
                        type="date"
                        required
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-border-button-default bg-background-secondary-default text-text-primary text-body-2-medium outline-none focus:border-border-focus-ring"
                      />
                    </div>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="text-caption-1-semibold text-text-primary">
                      Start Time <span className="text-text-error-primary">*</span>
                    </label>
                    <div className="relative">
                      <input
                        type="time"
                        required
                        value={time}
                        onChange={(e) => setTime(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-border-button-default bg-background-secondary-default text-text-primary text-body-2-medium outline-none focus:border-border-focus-ring"
                      />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-caption-1-semibold text-text-primary">
                      Duration
                    </label>
                    <div className="grid grid-cols-4 gap-1.5">
                      {[30, 45, 60, 90].map((mins) => (
                        <button
                          key={mins}
                          type="button"
                          onClick={() => setDurationMins(mins)}
                          className={`py-1.5 rounded-lg text-caption-1-semibold transition-all cursor-pointer text-center ${
                            durationMins === mins
                              ? "bg-accent-500 text-white shadow-xs font-semibold"
                              : "border border-border-button-default bg-background-secondary-default text-text-secondary hover:text-text-primary hover:bg-background-secondary-hover"
                          }`}
                        >
                          {mins}m
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="text-caption-1-semibold text-text-primary flex items-center gap-1">
                      <RiGlobalLine className="size-3.5 text-text-tertiary" />
                      <span>Timezone</span>
                    </label>
                    <select
                      value={timezone}
                      onChange={(e) => setTimezone(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-border-button-default bg-background-secondary-default text-text-primary text-caption-1-medium outline-none focus:border-border-focus-ring truncate cursor-pointer"
                    >
                      {allTimezones.map((tz) => (
                        <option key={tz} value={tz}>
                          {tz.replace(/_/g, " ")}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-caption-1-semibold text-text-primary">
                      Agenda & Preparation Notes (Optional)
                    </label>
                    <span className="text-caption-2-medium text-text-tertiary">
                      Markdown supported
                    </span>
                  </div>
                  <Textarea
                    value={preparationMaterial}
                    onChange={setPreparationMaterial}
                    placeholder="Key discussion points, topics, or background context for attendees..."
                    rows={4}
                  />
                </div>
              </form>
            )}
          </ModalBody>

          {!createdResult && (
            <ModalFooter>
              <div className="w-full flex items-center justify-between">
                <Button variant="ghost" size="small" onClick={close}>
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  size="small"
                  onClick={handleSubmit}
                  disabled={isSubmitting}
                >
                  {isSubmitting ? "Creating Meeting..." : "Create Meeting & Get Link"}
                </Button>
              </div>
            </ModalFooter>
          )}
        </>
      )}
    </Modal>
  );
}
