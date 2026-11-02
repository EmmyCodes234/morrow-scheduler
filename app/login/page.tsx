import { Suspense } from "react";
import { LoginView } from "@/components/scheduling/login-view";

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-background-full flex items-center justify-center p-4">
      <Suspense fallback={<div className="text-body-medium text-text-secondary">Loading...</div>}>
        <LoginView />
      </Suspense>
    </div>
  );
}
