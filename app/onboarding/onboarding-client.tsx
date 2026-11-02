"use client";

import { useRouter } from "next/navigation";
import { OnboardingView } from "@/components/scheduling/onboarding-view";

export function OnboardingPageClient({
  userEmail,
  userName,
  userImage,
}: {
  userEmail?: string;
  userName?: string;
  userImage?: string;
}) {
  const router = useRouter();

  return (
    <OnboardingView
      userEmail={userEmail}
      userName={userName}
      onComplete={() => router.push("/dashboard")}
    />
  );
}
