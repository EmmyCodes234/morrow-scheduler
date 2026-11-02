"use client";

import { useState } from "react";
import { DashboardView } from "@/components/scheduling/dashboard-view";
import { NewEventModal } from "@/components/scheduling/modals/new-event-modal";
import { RescheduleModal } from "@/components/scheduling/modals/reschedule-modal";

export function DashboardPageClient() {
  const [isNewEventOpen, setIsNewEventOpen] = useState(false);
  const [isRescheduleOpen, setIsRescheduleOpen] = useState(false);
  const [activeBooking, setActiveBooking] = useState<any>(null);

  const handleOpenReschedule = (booking: any) => {
    setActiveBooking(booking);
    setIsRescheduleOpen(true);
  };

  const handleSaveNewEvent = async (data: { title: string; slug: string; duration: number }) => {
    try {
      await fetch("/api/event-types", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: data.title,
          slug: data.slug,
          durationMins: data.duration,
          locationType: "google_meet",
        }),
      });
      // Refresh window
      window.location.reload();
    } catch (err) {
      console.error("Failed to create event type:", err);
    }
  };

  return (
    <div className="min-h-screen bg-background-full flex flex-col p-4 sm:p-6 lg:p-8 max-w-[1500px] mx-auto w-full">
      <DashboardView
        onOpenNewEventModal={() => setIsNewEventOpen(true)}
        onOpenRescheduleModal={handleOpenReschedule}
      />

      <NewEventModal
        isOpen={isNewEventOpen}
        onClose={() => setIsNewEventOpen(false)}
        onSave={handleSaveNewEvent}
      />

      <RescheduleModal
        isOpen={isRescheduleOpen}
        onClose={() => setIsRescheduleOpen(false)}
        booking={activeBooking}
        onConfirmReschedule={() => alert("Reschedule link sent to guest.")}
        onConfirmCancel={() => alert("Meeting cancelled.")}
      />
    </div>
  );
}
