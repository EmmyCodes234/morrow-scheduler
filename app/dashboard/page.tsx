import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { connection } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { DashboardPageClient } from "./dashboard-client";

export const instant = false;

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
