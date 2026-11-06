import { Suspense } from "react";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { getMeetingByInvitationToken, getAttendeeBySessionToken } from "@/lib/meetings/meeting-service";
import { getOrCreateRoomForMeeting } from "@/lib/room/room-service";
import { InvitationView } from "./invitation-view";
import { Spinner } from "@/components/base/spinner/spinner";

async function InvitationContent({ invitationToken }: { invitationToken: string }) {
  const meeting = await getMeetingByInvitationToken(invitationToken);

  if (!meeting) {
    notFound();
  }

  // Ensure room exists
  let room = meeting.room;
  if (!room) {
    room = await getOrCreateRoomForMeeting(meeting.id);
  }

  // Inspect existing attendee session cookie
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get("morrow_attendee_session")?.value;

  let initialAttendee = null;
  if (sessionToken) {
    const existingAttendee = await getAttendeeBySessionToken(sessionToken, meeting.id);
    if (existingAttendee) {
      initialAttendee = {
        id: existingAttendee.id,
        name: existingAttendee.name,
        email: existingAttendee.email,
        status: existingAttendee.status,
      };
    }
  }

  return (
    <InvitationView
      meeting={{
        id: meeting.id,
        title: meeting.title,
        description: meeting.description,
        startTime: meeting.startTime.toISOString(),
        endTime: meeting.endTime.toISOString(),
        timezone: meeting.timezone,
        invitationToken: meeting.invitationToken,
        preparationMaterial: meeting.preparationMaterial,
        status: meeting.status,
        openedEarlyAt: meeting.openedEarlyAt?.toISOString() || null,
        host: {
          id: meeting.host.id,
          name: meeting.host.name,
          slug: meeting.host.slug,
          avatarUrl: meeting.host.avatarUrl,
          timezone: meeting.host.timezone,
        },
      }}
      initialAttendee={initialAttendee}
      roomAccessToken={room.accessToken}
    />
  );
}

export default async function InvitationPage({
  params,
}: {
  params: Promise<{ invitationToken: string }>;
}) {
  const { invitationToken } = await params;

  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-background-full flex items-center justify-center p-6">
          <div className="flex flex-col items-center gap-3">
            <Spinner size="lg" className="text-accent-500" />
            <span className="text-body-medium text-text-secondary">
              Opening meeting invitation...
            </span>
          </div>
        </div>
      }
    >
      <InvitationContent invitationToken={invitationToken} />
    </Suspense>
  );
}
