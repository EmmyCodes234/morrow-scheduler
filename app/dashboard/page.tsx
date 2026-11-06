import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { connection } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { MorrowIcon } from "@/components/brand/morrow-logo";
import { DashboardPageClient } from "./dashboard-client";

export default async function DashboardPage() {
  await connection();
  const session = await auth();

  if (!session?.user?.email) {
    redirect("/login");
  }

  const host = await db.query.users.findFirst({
    where: eq(users.email, session.user.email),
  });

  if (!host || !host.onboardedAt) {
    redirect("/onboarding");
  }

  const initials = host.name
    ? host.name
        .split(" ")
        .filter(Boolean)
        .map((n: string) => n[0])
        .join("")
        .slice(0, 2)
        .toUpperCase()
    : "U";

  const initialUser = {
    id: host.id,
    name: host.name,
    email: host.email,
    slug: host.slug,
    initials: initials || "U",
    timezone: host.timezone || "UTC",
    avatarUrl: host.avatarUrl,
    brandColor: host.brandColor,
    welcomeMessage: host.welcomeMessage,
    defaultLocationType: host.defaultLocationType || "google_meet",
    zoomMeetingUrl: host.zoomMeetingUrl || "",
    teamsMeetingUrl: host.teamsMeetingUrl || "",
    zoomEmail: host.zoomEmail || null,
    zoomConnectedAt: host.zoomConnectedAt || null,
    hasZoomOAuth: Boolean(host.zoomAccessToken || host.zoomRefreshToken),
    hasGoogleCalendar: Boolean(host.googleAccessToken || host.googleRefreshToken),
  };

  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-background-full flex items-center justify-center">
          <MorrowIcon size={44} showBadge={true} className="animate-pulse" />
        </div>
      }
    >
      <DashboardPageClient initialUser={initialUser} />
    </Suspense>
  );
}
