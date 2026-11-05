"use client";

import { useState } from "react";
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
  RiSparklingLine,
  RiVideoOnLine,
  RiShareLine,
} from "@remixicon/react";

export interface NewMeetingModalProps {
  isOpen: boolean;
  onClose: () => void;
  userTimezone?: string;
  onSuccess?: () => void;
}

const FOF_CLEANED_MINUTES = `# FESTUS OSIFO FOUNDATION (FOF)
## SCRABBLE TOURNAMENT — MINUTES OF MEETING

**Meeting date:** Monday, 2 November 2026  
**Venue:** WhatsApp Voice Call / Online  
**Scheduled time:** 11:00 a.m. – 1:45 p.m.  
**Actual commencement:** 11:04 a.m.  
**Duration:** 2 hours 41 minutes

### 1. Attendance

The following members were present:

1. Mr. Bright Idahosa — President
2. Favour Nwabuzor
3. Enyi Emmanuel
4. Abasido
5. Comr. Nelson
6. Wealth
7. Catherine — Event Planner
8. Kingsley
9. Samuel Ohihon

### 2. Opening

The meeting commenced at 11:04 a.m. with pleasantries and introductions.

### 3. President's Address and Strategic Direction

The President outlined the ambition for the tournament, emphasising that it should deliver an exceptional and memorable experience capable of setting a new benchmark for Scrabble events in Nigeria.

The key priorities were:

- **Exceptional experience:** The tournament should be distinctive, memorable and well organised.
- **Time management:** Strict adherence to the tournament schedule is essential.
- **Player satisfaction:** Players' happiness and overall experience must remain central to planning and execution.
- **Long-term sustainability:** The sponsor is considering organising the tournament twice yearly, subject to the success of the first edition.

### 4. Tournament Operations and Competition Structure

**Game flow**

All games in a round must be completed before the next round begins. This was emphasised as an important operational requirement.

**Tournament format**

A 22-game structure, benchmarked against WESPA standards, was proposed. The final number of games remains to be confirmed.

**Expected participation and registration**

- Expected participation: 250–300 players.
- Registration closing date: 14 November 2026.

**Screens and visual presentation**

The number and dimensions of screens are yet to be determined. Screen requirements will be finalised after confirming the number of screens required.

The screens are also expected to display sponsor videos.

**Proposed innovations**

The following concepts were discussed:

- **Scrabble Bee:** An interactive word challenge incorporating AI-generated or AI-assisted word selection. All words must strictly comply with CSW24, the official tournament lexicon. AI must not introduce or validate words outside the scope of CSW24.
- **Quiz segment:** A proposed interactive quiz for participants and/or attendees.
- **12-letter word showcase:** A showcase of 12-letter words during each round.

These concepts require further development and confirmation.

**Venue and logistics**

- The operational team is expected to be on ground one week before the tournament.
- A site visit to Benin was planned for the following weekend.
- The alternative hall is intended for the opening and Day 1.
- The main hall is intended to be opened for use from Day 2.

### 5. Hospitality and Guest Experience

The meeting emphasised the importance of delivering a distinctive hospitality experience.

Areas discussed included:

- Airport reception for invited guests.
- Hotel arrangements and confirmation of international guests.
- Efficient feeding arrangements.
- Goody bags, with particular attention to children.
- Red-carpet arrivals and guest reception.

### 6. Entertainment and Media

**Media coverage**

The aspiration is to secure distinctive, high-quality media coverage, including live coverage by major television stations such as Channels TV and TVC.

The President confirmed that leading television stations are being targeted.

**Entertainment**

The following activities were discussed for the tournament's dinner and entertainment programme:

- Interviews with prominent personalities and superstars.
- Fashion runway.
- Comedy performances.

Catherine is responsible for developing the entertainment plan.

**Prizes**

- Per-round cash prizes, to be presented in envelopes, were discussed.
- Prizes for veterans remain to be determined.

### 7. Questions and Contributions

Comr. Nelson sought clarification on the prospects for national television coverage.

The President reiterated that major television stations are being targeted.

The importance of reliable internet connectivity was also emphasised. Backup internet arrangements were identified as critical to uninterrupted tournament operations.

### 8. Action Register

| Action | Responsible party | Status |
|---|---|---|
| Develop the entertainment plan | Catherine | Outstanding |
| Prepare the media coverage plan | Media crew | Outstanding |
| Conduct the Benin site visit | Organising team; lead to be assigned | Planned |
| Confirm number and dimensions of screens | To be assigned | Outstanding |
| Finalise the proposed 22-game structure | To be assigned | Outstanding |
| Confirm international guests | To be assigned | Outstanding |
| Confirm hotel arrangements | To be assigned | Outstanding |
| Finalise prize structure, including veteran prizes | To be assigned | Outstanding |
| Confirm sponsor video requirements | To be assigned | Outstanding |
| Establish primary and backup internet arrangements | To be assigned | Outstanding |
| Monitor registration and communicate the closing date | To be assigned | Pending |

### 9. Closing

The meeting was adjourned at 1:45 p.m.

The next meeting was scheduled to hold via WhatsApp.

---

### 10. Matters Requiring Follow-up

The following items remain open for consideration and resolution at subsequent meetings:

1. Finalise the proposed 22-game tournament structure.
2. Develop the Scrabble Bee concept, ensuring strict compliance with CSW24.
3. Clarify the format and execution of the quiz and 12-letter word showcase.
4. Assign individual owners and deadlines to outstanding operational actions.
5. Confirm screen requirements, venue logistics and backup internet arrangements.
6. Finalise hospitality, media, entertainment and prize arrangements.

**Document status:** Cleaned-up record of the previous meeting. Proposals and outstanding matters have deliberately not been presented as final decisions.`;

export function NewMeetingModal({
  isOpen,
  onClose,
  userTimezone = "Africa/Lagos",
  onSuccess,
}: NewMeetingModalProps) {
  // Form fields
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("2026-11-05");
  const [time, setTime] = useState("21:00");
  const [durationMins, setDurationMins] = useState(120);
  const [timezone, setTimezone] = useState(userTimezone || "Africa/Lagos");
  const [description, setDescription] = useState("");
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

  const handleLoadFOFTemplate = () => {
    setTitle("FOF Scrabble Tournament Planning");
    setDate("2026-11-05");
    setTime("21:00");
    setDurationMins(120);
    setTimezone("Africa/Lagos");
    setDescription(
      "Organising committee meeting for the 2026 Festus Osifo Foundation Scrabble Tournament, competition structure, and operational logistics."
    );
    setPreparationMaterial(FOF_CLEANED_MINUTES);
    setError(null);
  };

  const handleReset = () => {
    setTitle("");
    setDate("2026-11-05");
    setTime("21:00");
    setDurationMins(120);
    setTimezone(userTimezone || "Africa/Lagos");
    setDescription("");
    setPreparationMaterial("");
    setCreatedResult(null);
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError("Meeting title is required.");
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
          description: description.trim() || undefined,
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
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZone: createdResult.meeting.timezone,
        timeZoneName: "short",
      }).format(new Date(createdResult.meeting.startTime))
    : "";

  const whatsappMessage = createdResult
    ? `You're invited to ${createdResult.meeting.title} on Morrow.\nDate & Time: ${formattedStartTime}\nJoin link & preparation materials: ${fullInvitationUrl}\nNo account needed. Open on your phone to review minutes and enter the room.`
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
      size="lg"
    >
      {({ close }) => (
        <>
          <ModalHeader
            title={createdResult ? "Meeting Invitation Ready" : "Create Group Meeting"}
            description={
              createdResult
                ? "Your shareable invitation link has been generated and the Morrow Room is provisioned."
                : "Create an independent group meeting, load previous minutes, and generate a shareable WhatsApp link."
            }
          />

          <ModalBody className="max-h-[75vh] overflow-y-auto">
            {createdResult ? (
              /* SUCCESS STATE */
              <div className="flex flex-col gap-6 py-2">
                <div className="flex items-center justify-between p-4 rounded-2xl bg-accent-50/60 dark:bg-accent-950/20 border border-accent-200 dark:border-accent-900">
                  <div className="flex flex-col gap-1">
                    <span className="text-caption-1-semibold text-accent-600 uppercase font-semibold">
                      Persistent Room Provisioned
                    </span>
                    <h3 className="text-title-3-semibold text-text-primary">
                      {createdResult.meeting.title}
                    </h3>
                    <span className="text-body-2-regular text-text-secondary">
                      {formattedStartTime}
                    </span>
                  </div>
                  <Chip color="lime" variant="bold">
                    Active
                  </Chip>
                </div>

                {/* Shareable Link Box */}
                <div className="flex flex-col gap-2">
                  <span className="text-caption-1-semibold text-text-primary font-medium">
                    Shareable Invitation Link (Guests require no account)
                  </span>
                  <div className="flex items-center gap-2 p-2 rounded-xl border border-border-button-default bg-background-secondary-default">
                    <input
                      type="text"
                      readOnly
                      value={fullInvitationUrl}
                      className="w-full bg-transparent text-text-primary text-body-medium font-mono ps-1 outline-none select-all"
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
                  <span className="text-caption-2-medium text-text-tertiary">
                    Send this link to the WhatsApp group. Invitees open it on their phones, register in 5 seconds, read previous minutes, and enter the call.
                  </span>
                </div>

                {/* 1-Click WhatsApp Share Pre-formatted message */}
                <div className="flex flex-col gap-2 p-4 rounded-2xl bg-background-secondary-default/50 border border-border-button-default">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-text-primary font-semibold text-caption-1-semibold">
                      <RiWhatsappLine className="size-4.5 text-emerald-600" />
                      <span>1-Click WhatsApp Invite Message</span>
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
                  <div className="p-3 rounded-xl bg-background-primary-default border border-border-button-default text-caption-1-medium text-text-secondary font-mono whitespace-pre-wrap leading-relaxed select-all">
                    {whatsappMessage}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center justify-between pt-2">
                  <Button
                    variant="primary"
                    size="medium"
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
                    size="medium"
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
              /* MEETING CREATION FORM */
              <form onSubmit={handleSubmit} className="flex flex-col gap-5 py-2">
                {/* Quick Pilot Template CTA */}
                <div className="flex items-center justify-between p-3.5 rounded-2xl bg-accent-50/50 dark:bg-accent-950/20 border border-accent-200 dark:border-accent-900">
                  <div className="flex items-center gap-2.5">
                    <RiSparklingLine className="size-5 text-accent-600 shrink-0" />
                    <div className="flex flex-col">
                      <span className="text-caption-1-semibold text-text-primary font-semibold">
                        FOF Scrabble Tournament Pilot
                      </span>
                      <span className="text-caption-2-medium text-text-secondary">
                        Prefill 5 Nov 2026, 9:00 PM Africa/Lagos & cleaned 2 Nov minutes
                      </span>
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    size="xs"
                    onClick={handleLoadFOFTemplate}
                  >
                    Load Pilot Template
                  </Button>
                </div>

                {error && (
                  <div className="p-3 rounded-xl bg-background-error-default/10 border border-border-error-default text-text-error-primary text-body-2-medium">
                    {error}
                  </div>
                )}

                <Input
                  label="Meeting title"
                  value={title}
                  onChange={setTitle}
                  placeholder="e.g. FOF Scrabble Tournament Planning"
                  isRequired
                />

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-body-medium text-text-primary font-medium">
                      Date <span className="text-text-error-primary">*</span>
                    </label>
                    <input
                      type="date"
                      required
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                      className="w-full px-3.5 py-2 rounded-xl border border-border-button-default bg-background-secondary-default text-text-primary text-body-medium outline-none"
                    />
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="text-body-medium text-text-primary font-medium">
                      Start Time <span className="text-text-error-primary">*</span>
                    </label>
                    <input
                      type="time"
                      required
                      value={time}
                      onChange={(e) => setTime(e.target.value)}
                      className="w-full px-3.5 py-2 rounded-xl border border-border-button-default bg-background-secondary-default text-text-primary text-body-medium outline-none"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-body-medium text-text-primary font-medium">
                      Duration
                    </label>
                    <div className="grid grid-cols-4 gap-2">
                      {[30, 60, 90, 120].map((mins) => (
                        <button
                          key={mins}
                          type="button"
                          onClick={() => setDurationMins(mins)}
                          className={`py-2 px-1 rounded-lg text-body-2-medium font-medium transition-all cursor-pointer text-center ${
                            durationMins === mins
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
                    <label className="text-body-medium text-text-primary font-medium">
                      Timezone
                    </label>
                    <input
                      type="text"
                      value={timezone}
                      onChange={(e) => setTimezone(e.target.value)}
                      className="w-full px-3.5 py-2 rounded-xl border border-border-button-default bg-background-secondary-default text-text-primary text-body-medium outline-none"
                      placeholder="e.g. Africa/Lagos"
                    />
                  </div>
                </div>

                <Textarea
                  label="Description / Purpose (optional)"
                  value={description}
                  onChange={setDescription}
                  placeholder="Context shown in the meeting invitation lobby."
                  rows={2}
                />

                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-body-medium text-text-primary font-medium">
                      Preparation Material & Previous Minutes (Markdown)
                    </label>
                    <span className="text-caption-2-medium text-text-tertiary">
                      Read-only for invitees in lobby & room
                    </span>
                  </div>
                  <textarea
                    rows={8}
                    value={preparationMaterial}
                    onChange={(e) => setPreparationMaterial(e.target.value)}
                    placeholder="Paste previous meeting minutes, agenda notes, or background context (supports Markdown headings, lists, tables)."
                    className="w-full px-3.5 py-2.5 rounded-xl border border-border-button-default bg-background-secondary-default text-text-primary text-body-2-regular font-mono leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring"
                  />
                </div>
              </form>
            )}
          </ModalBody>

          {!createdResult && (
            <ModalFooter>
              <div className="w-full flex items-center justify-between">
                <Button variant="ghost" onClick={close}>
                  Cancel
                </Button>
                <Button
                  variant="primary"
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
