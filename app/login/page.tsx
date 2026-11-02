import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { connection } from "next/server";
import { LoginView } from "@/components/scheduling/login-view";

export const instant = false;

export default async function LoginPage() {
  await connection();
  const session = await auth();

  if (session?.user?.email) {
    redirect("/dashboard");
  }

  return (
    <div className="min-h-screen bg-background-full flex items-center justify-center p-4">
      <Suspense fallback={<div className="text-body-medium text-text-secondary">Loading...</div>}>
        <LoginView />
      </Suspense>
    </div>
  );
}
