import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { connection } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { OnboardingPageClient } from "./onboarding-client";

export const instant = false;

export default async function OnboardingPage() {
  await connection();
  const session = await auth();

  if (!session?.user?.email) {
    redirect("/login");
  }

  const host = await db.query.users.findFirst({
    where: eq(users.email, session.user.email),
  });

  // If user already completed onboarding, go directly to dashboard
  if (host?.onboardedAt) {
    redirect("/dashboard");
  }

  return (
    <div className="min-h-screen bg-background-full flex items-center justify-center p-4 sm:p-8">
      <Suspense fallback={<div className="text-body-medium text-text-secondary">Loading Morrow setup...</div>}>
        <OnboardingPageClient
          userEmail={session.user.email}
          userName={session.user.name || host?.name || ""}
          userImage={session.user.image || host?.avatarUrl || ""}
        />
      </Suspense>
    </div>
  );
}
