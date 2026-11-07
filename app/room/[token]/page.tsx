import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { getRoomByAccessToken } from "@/lib/room/room-service";
import { MorrowIcon } from "@/components/brand/morrow-logo";
import { Spinner } from "@/components/base/spinner/spinner";
import { Button } from "@/components/base/buttons/button";
import { HugeVideo, HugeArrowRight } from "@/components/icons/hugeicons";

async function RoomContent({ token }: { token: string }) {
  const room = await getRoomByAccessToken(token);

  if (!room) {
    notFound();
  }

  const meetLink =
    (room as any).meetLink ||
    (room as any).meeting?.locationUrl ||
    room.booking?.meetLink ||
    (room.booking?.host as any)?.zoomMeetingUrl ||
    (room.booking?.host as any)?.teamsMeetingUrl ||
    (room as any).meeting?.host?.zoomMeetingUrl ||
    (room as any).meeting?.host?.teamsMeetingUrl ||
    "https://meet.google.com/new";

  // Seamlessly redirect if conference URL is already known
  if (meetLink) {
    redirect(meetLink);
  }

  return (
    <div className="min-h-screen bg-background-full flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-3xl border border-border-button-default bg-background-primary-default p-8 shadow-2xs flex flex-col items-center text-center gap-6">
        <MorrowIcon size={44} showBadge={true} />

        <div className="flex flex-col gap-1.5">
          <h1 className="text-title-2-semibold text-text-primary">
            {room.booking?.eventTitle || "Scheduled Meeting"}
          </h1>
          <p className="text-body-regular text-text-secondary">
            with {room.booking?.host?.name || "Host"}
          </p>
        </div>

        <p className="text-body-2-regular text-text-secondary">
          Morrow video calls now connect directly through Google Meet, Zoom, or Microsoft Teams for carrier-grade audio and video.
        </p>

        <a href="/dashboard" className="w-full">
          <Button variant="primary" size="medium" leadingIcon={HugeArrowRight} className="w-full justify-center">
            Go to Dashboard
          </Button>
        </a>
      </div>
    </div>
  );
}

export default async function RoomPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-background-full flex items-center justify-center p-6">
          <div className="flex flex-col items-center gap-3">
            <Spinner size="lg" className="text-accent-500" />
            <span className="text-body-medium text-text-secondary">
              Connecting to meeting...
            </span>
          </div>
        </div>
      }
    >
      <RoomContent token={token} />
    </Suspense>
  );
}
