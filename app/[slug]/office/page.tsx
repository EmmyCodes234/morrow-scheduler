import { notFound } from "next/navigation";
import { db } from "@/db";
import { users, eventTypes } from "@/db/schema";
import { eq } from "drizzle-orm";
import { PublicOfficeView } from "@/components/office/public-office-view";
import type { Metadata } from "next";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const host = await db.query.users.findFirst({
    where: eq(users.slug, slug),
  });

  if (!host) {
    return {
      title: "Virtual Office | Morrow",
    };
  }

  return {
    title: `${host.name}'s Virtual Office | Morrow`,
    description: `Knock on ${host.name}'s virtual office door for drop-in speed chats and live office hours on Morrow.`,
  };
}

export default async function PublicOfficePage({
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

  // Dynamically load host's event types from Neon DB for fallback scheduler
  const hostEventTypes = await db.query.eventTypes.findMany({
    where: eq(eventTypes.userId, host.id),
  });

  return (
    <div className="min-h-screen bg-background-full flex items-center justify-center p-3 sm:p-6 lg:p-8">
      <PublicOfficeView
        host={{
          id: host.id,
          name: host.name,
          email: host.email,
          slug: host.slug,
          timezone: host.timezone,
          avatarUrl: host.avatarUrl,
          brandColor: host.brandColor || "#2563EB",
          welcomeMessage: host.welcomeMessage || "Knock to drop in for a quick chat.",
          officeStatus: host.officeStatus || "closed",
          officeTopic: host.officeTopic,
          officeSpeedChatMins: host.officeSpeedChatMins || 10,
        }}
        eventTypes={hostEventTypes.map((et) => ({
          id: et.id,
          title: et.title,
          slug: et.slug,
          duration: et.durationMins,
          description: et.description || "",
          location: "Google Meet",
          active: et.isActive,
          maxAttendees: et.maxAttendees ?? 1,
          showRemainingSpots: et.showRemainingSpots ?? true,
        }))}
      />
    </div>
  );
}
