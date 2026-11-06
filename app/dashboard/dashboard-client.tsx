"use client";

import { DashboardView, type HostUser } from "@/components/scheduling/dashboard-view";

export function DashboardPageClient({ initialUser }: { initialUser?: HostUser }) {
  return (
    <div className="min-h-screen bg-background-full flex flex-col p-4 sm:p-6 lg:p-8 max-w-[1500px] mx-auto w-full">
      <DashboardView initialUser={initialUser} />
    </div>
  );
}
