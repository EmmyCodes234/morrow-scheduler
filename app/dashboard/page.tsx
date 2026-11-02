import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { DashboardPageClient } from "./dashboard-client";

export default async function DashboardPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-background-full flex items-center justify-center text-body-medium text-text-secondary">
          Loading Morrow...
        </div>
      }
    >
      <DashboardPageClient />
    </Suspense>
  );
}
