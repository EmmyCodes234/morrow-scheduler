import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { OnboardingPageClient } from "./onboarding-client";

export default async function OnboardingPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  return (
    <div className="min-h-screen bg-background-full flex items-center justify-center p-4 sm:p-8">
      <Suspense fallback={<div className="text-body-medium text-text-secondary">Loading...</div>}>
        <OnboardingPageClient
          userEmail={session.user.email || ""}
          userName={session.user.name || ""}
          userImage={session.user.image || ""}
        />
      </Suspense>
    </div>
  );
}
