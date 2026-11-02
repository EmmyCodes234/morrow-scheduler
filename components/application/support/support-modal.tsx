"use client";

import { useState } from "react";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/base/modal/modal";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { Textarea } from "@/components/base/textarea/textarea";
import { Chip } from "@/components/base/badges/chip";
import {
  HugeSupport,
  HugeMail,
  HugeCopy,
  HugeCheck,
  HugeLink,
  HugeCalendar,
  HugeVideo,
  HugeGlobe,
} from "@/components/icons/hugeicons";

export interface SupportModalProps {
  isOpen: boolean;
  onClose: () => void;
  user?: {
    name?: string;
    email?: string;
  } | null;
}

const FAQS = [
  {
    q: "How does Google Calendar synchronization work?",
    a: "Morrow queries your primary calendar's real-time busy slots. When you have an event or meeting on Google Calendar, that slot is automatically hidden from guests to prevent double-booking.",
    icon: HugeCalendar,
  },
  {
    q: "Can I use Zoom instead of Google Meet?",
    a: "Yes! In your Integrations tab, enable Zoom Meetings and paste your Personal Meeting Link. Morrow will automatically attach your Zoom room to all confirmed bookings.",
    icon: HugeVideo,
  },
  {
    q: "How do timezone conversions work for guests?",
    a: "Morrow detects each guest's local browser timezone automatically and converts all your available slots in real time. Meetings are booked seamlessly regardless of where your guests are located.",
    icon: HugeGlobe,
  },
  {
    q: "How do I change my public booking link?",
    a: "Go to Settings → Profile → Morrow Public Link. You can customize your unique username handle (e.g. usemorrow.xyz/yourname).",
    icon: HugeLink,
  },
];

export function SupportModal({ isOpen, onClose, user }: SupportModalProps) {
  const [tab, setTab] = useState<"contact" | "faq">("contact");
  const [category, setCategory] = useState<string>("question");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCopyEmail = () => {
    navigator.clipboard.writeText("support@usemorrow.xyz");
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subject.trim() || !message.trim()) {
      setError("Please provide both a subject and message.");
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/support", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category,
          subject: subject.trim(),
          message: message.trim(),
          userEmail: user?.email,
          userName: user?.name,
        }),
      });

      if (!res.ok) {
        throw new Error("Failed to send support request. Please try again.");
      }

      setSubmitted(true);
      setSubject("");
      setMessage("");
    } catch (err: any) {
      setError(err?.message || "Something went wrong.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onOpenChange={onClose} size="lg">
      {({ close }) => (
        <>
          <ModalHeader
            title="Morrow Support & Help"
            description="Have a question, feedback, or need assistance? Our team is here to help."
          />

          <ModalBody>
            <div className="flex flex-col gap-5">
              {/* Tabs */}
              <div className="flex items-center gap-2 p-1 rounded-2xl bg-background-secondary-default border border-border-button-default w-fit">
                <button
                  type="button"
                  onClick={() => {
                    setTab("contact");
                    setSubmitted(false);
                  }}
                  className={`px-3.5 py-1.5 rounded-xl text-body-2-medium font-medium transition-colors cursor-pointer ${
                    tab === "contact"
                      ? "bg-background-primary-default text-text-primary shadow-2xs"
                      : "text-text-secondary hover:text-text-primary"
                  }`}
                >
                  Contact Support
                </button>
                <button
                  type="button"
                  onClick={() => setTab("faq")}
                  className={`px-3.5 py-1.5 rounded-xl text-body-2-medium font-medium transition-colors cursor-pointer ${
                    tab === "faq"
                      ? "bg-background-primary-default text-text-primary shadow-2xs"
                      : "text-text-secondary hover:text-text-primary"
                  }`}
                >
                  Frequently Asked
                </button>
              </div>

              {tab === "contact" ? (
                submitted ? (
                  <div className="rounded-2xl border border-border-button-default bg-status-lime-background/25 p-6 flex flex-col items-center text-center gap-3">
                    <div className="size-10 rounded-full bg-status-lime-background flex items-center justify-center text-status-lime-text">
                      <HugeCheck className="size-5" />
                    </div>
                    <div className="flex flex-col gap-1">
                      <h3 className="text-title-3-semibold text-text-primary">
                        Support request received
                      </h3>
                      <p className="text-body-regular text-text-secondary max-w-md">
                        Thank you! We've received your inquiry and our team will get back to you at{" "}
                        <strong className="text-text-primary">{user?.email || "your email"}</strong> shortly.
                      </p>
                    </div>
                    <Button
                      variant="secondary"
                      size="small"
                      onClick={() => setSubmitted(false)}
                      className="mt-2"
                    >
                      Send another message
                    </Button>
                  </div>
                ) : (
                  <form id="support-form" onSubmit={handleSubmit} className="flex flex-col gap-4">
                    {/* Direct Contact Banner */}
                    <div className="p-3.5 rounded-2xl border border-border-button-default bg-background-secondary-default flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <HugeMail className="size-5 text-accent-500 shrink-0" />
                        <div className="flex flex-col">
                          <span className="text-body-2-medium font-semibold text-text-primary">
                            support@usemorrow.xyz
                          </span>
                          <span className="text-caption-1-regular text-text-secondary">
                            Direct email response typically within 2-4 hours.
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          variant="secondary"
                          size="xs"
                          leadingIcon={copied ? HugeCheck : HugeCopy}
                          onClick={handleCopyEmail}
                        >
                          {copied ? "Copied" : "Copy"}
                        </Button>
                        <a
                          href="mailto:support@usemorrow.xyz?subject=Morrow%20Support%20Inquiry"
                          className="inline-flex items-center justify-center px-2.5 py-1.5 rounded-lg border border-border-button-default text-caption-1-semibold text-text-primary bg-background-primary-default hover:bg-background-secondary-hover"
                        >
                          Open Mail
                        </a>
                      </div>
                    </div>

                    {/* Category Buttons */}
                    <div className="flex flex-col gap-1.5">
                      <label className="text-body-medium font-medium text-text-primary">
                        Topic Category
                      </label>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {[
                          { id: "question", label: "Question" },
                          { id: "bug", label: "Bug Report" },
                          { id: "feature", label: "Feature Idea" },
                          { id: "account", label: "Account" },
                        ].map((cat) => (
                          <button
                            key={cat.id}
                            type="button"
                            onClick={() => setCategory(cat.id)}
                            className={`py-2 px-3 rounded-xl text-body-2-medium font-medium transition-colors cursor-pointer text-center ${
                              category === cat.id
                                ? "bg-accent-500 text-white shadow-2xs"
                                : "border border-border-button-default bg-background-secondary-default text-text-secondary hover:text-text-primary"
                            }`}
                          >
                            {cat.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <Input
                      label="Subject"
                      value={subject}
                      onChange={setSubject}
                      placeholder="Summary of what you need help with"
                      isRequired
                    />

                    <Textarea
                      label="Message details"
                      value={message}
                      onChange={setMessage}
                      placeholder="Please explain the question or steps to reproduce the issue..."
                      rows={4}
                      isRequired
                    />

                    {error && (
                      <div className="p-3 rounded-xl border border-border-error-default bg-background-secondary-default text-body-2-regular text-text-error-primary">
                        {error}
                      </div>
                    )}
                  </form>
                )
              ) : (
                /* FAQ Tab */
                <div className="flex flex-col gap-3">
                  {FAQS.map((faq, i) => {
                    const Icon = faq.icon;
                    return (
                      <div
                        key={i}
                        className="p-4 rounded-2xl border border-border-button-default bg-background-primary-default flex flex-col gap-1.5 shadow-2xs"
                      >
                        <div className="flex items-center gap-2.5">
                          <Icon className="size-4 text-accent-500 shrink-0" />
                          <h4 className="text-body-medium font-semibold text-text-primary">
                            {faq.q}
                          </h4>
                        </div>
                        <p className="text-body-2-regular text-text-secondary leading-relaxed ps-6.5">
                          {faq.a}
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </ModalBody>

          <ModalFooter>
            <div className="w-full flex items-center justify-between">
              <span className="text-caption-1-regular text-text-tertiary">
                Morrow Helpdesk &bull; usemorrow.xyz
              </span>

              <div className="flex items-center gap-2">
                <Button variant="secondary" onClick={close} disabled={isSubmitting}>
                  Close
                </Button>
                {tab === "contact" && !submitted && (
                  <Button
                    type="submit"
                    form="support-form"
                    variant="primary"
                    disabled={isSubmitting}
                  >
                    {isSubmitting ? "Sending..." : "Send support request"}
                  </Button>
                )}
              </div>
            </div>
          </ModalFooter>
        </>
      )}
    </Modal>
  );
}
