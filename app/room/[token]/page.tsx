import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getRoomByAccessToken } from "@/lib/room/room-service";
import { getAttendeeBySessionToken } from "@/lib/meetings/meeting-service";
import { RoomView } from "@/components/room/room-view";
import { Spinner } from "@/components/base/spinner/spinner";
import { auth } from "@/auth";

export const instant = false;

async function RoomContent({ token }: { token: string }) {
  const room = await getRoomByAccessToken(token);

  if (!room) {
    notFound();
  }

  const session = await auth();
  const hostId = room.meeting?.host?.id || room.booking.host.id;
  const isHost = Boolean(session?.user?.id && session.user.id === hostId);

  let attendeeProfile: { id: string; name: string; email: string } | null = null;

  if (room.type === "group_meeting" && !isHost) {
    const cookieStore = await cookies();
    const sessionToken = cookieStore.get("morrow_attendee_session")?.value;

    if (sessionToken) {
      const attendee = await getAttendeeBySessionToken(sessionToken, room.meeting?.id);
      if (attendee) {
        attendeeProfile = {
          id: attendee.id,
          name: attendee.name,
          email: attendee.email,
        };
      }
    }

    // If an unregistered visitor enters a group meeting room without registration cookie, redirect to public lobby
    if (!attendeeProfile && room.meeting?.invitationToken) {
      redirect(`/j/${room.meeting.invitationToken}`);
    }
  }

  return (
    <RoomView
      initialRoom={room}
      isHost={isHost}
      attendeeProfile={attendeeProfile}
    />
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
              Entering Morrow room...
            </span>
          </div>
        </div>
      }
    >
      <RoomContent token={token} />
    </Suspense>
  );
}
