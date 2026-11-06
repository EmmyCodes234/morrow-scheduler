import { notFound } from "next/navigation";
import { db } from "@/db";
import { users, eventTypes } from "@/db/schema";
import { eq } from "drizzle-orm";
import { PublicBookingView } from "@/components/scheduling/public-booking";



export default async function PublicBookingPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  // Dynamically load host from Neon DB
  const host = await db.query.users.findFirst({
    where: eq(users.slug, slug),
  });

  if (!host) {
    notFound();
  }

  // Dynamically load host's event types from Neon DB
  const hostEventTypes = await db.query.eventTypes.findMany({
    where: eq(eventTypes.userId, host.id),
  });

  return (
    <div className="min-h-screen bg-background-full flex items-center justify-center p-3 sm:p-6 lg:p-8">
      <PublicBookingView
        host={{
          id: host.id,
          name: host.name,
          email: host.email,
          slug: host.slug,
          timezone: host.timezone,
          avatarUrl: host.avatarUrl,
          brandColor: host.brandColor || "#2563EB",
          welcomeMessage: host.welcomeMessage || "Pick a time that works for you.",
        }}
        initialEventTypes={hostEventTypes.map((et) => ({
          id: et.id,
          title: et.title,
          slug: et.slug,
          duration: et.durationMins,
          description: et.description || "",
          location: "Google Meet",
          active: et.isActive,
        }))}
      />
    </div>
  );
}
