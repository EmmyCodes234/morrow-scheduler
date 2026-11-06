import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { connection } from "next/server";
import { LoginView } from "@/components/scheduling/login-view";
import { MorrowIcon } from "@/components/brand/morrow-logo";

export default async function LoginPage() {
  await connection();
  const session = await auth();

  if (session?.user?.email) {
    redirect("/dashboard");
  }

  return (
    <div className="min-h-screen bg-background-full flex items-center justify-center p-4">
      <Suspense
        fallback={
          <div className="flex items-center justify-center">
            <MorrowIcon size={44} showBadge={true} className="animate-pulse" />
          </div>
        }
      >
        <LoginView />
      </Suspense>
    </div>
  );
}
