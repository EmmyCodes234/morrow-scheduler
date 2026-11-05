import { Suspense } from "react";
import { notFound } from "next/navigation";
import { getRoomByAccessToken } from "@/lib/room/room-service";
import { RoomView } from "@/components/room/room-view";
import { Spinner } from "@/components/base/spinner/spinner";

export const instant = false;

async function RoomContent({ token }: { token: string }) {
  const room = await getRoomByAccessToken(token);

  if (!room) {
    notFound();
  }

  return <RoomView initialRoom={room} />;
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
