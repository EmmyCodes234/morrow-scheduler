"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { Divider } from "@/components/base/divider/divider";
import { SocialButton } from "@/components/base/social-button/social-button";
import { HugeMail, HugeArrowRight, HugeCheck } from "@/components/icons/hugeicons";

export interface LoginViewProps {
  onSuccess?: () => void;
  onGoToOnboarding?: () => void;
}

export function LoginView({ onSuccess, onGoToOnboarding }: LoginViewProps) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    setSent(true);
    setTimeout(() => {
      onSuccess?.();
    }, 1500);
  };

  return (
    <div className="w-full max-w-md mx-auto rounded-3xl border border-border-button-default bg-background-primary-default p-8 sm:p-10 shadow-sm flex flex-col gap-6">
      {/* BRAND & HEADER */}
      <div className="flex flex-col items-center text-center gap-2">
        <div className="size-11 rounded-2xl bg-accent-500 text-white flex items-center justify-center font-bold text-headline-medium shadow-xs mb-2">
          M
        </div>
        <h1 className="text-title-2-medium text-text-primary">Sign in to Morrow</h1>
        <p className="text-body-regular text-text-secondary">
          Tomorrow starts here. Connect your calendar and get booked.
        </p>
      </div>

      {/* SOCIAL LOGINS */}
      <div className="flex flex-col gap-3">
        <SocialButton
          brand="google"
          appearance="white"
          onClick={() => {
            signIn("google", { callbackUrl: "/dashboard", redirectTo: "/dashboard" });
          }}
          className="w-full justify-center"
        >
          Continue with Google
        </SocialButton>
      </div>

      {/* DIVIDER */}
      <div className="relative flex py-2 items-center">
        <div className="flex-grow border-t border-border-button-default" />
        <span className="flex-shrink mx-4 text-caption-1-semibold text-text-tertiary uppercase tracking-wider">
          Or continue with email
        </span>
        <div className="flex-grow border-t border-border-button-default" />
      </div>

      {/* EMAIL SIGN IN */}
      {sent ? (
        <div className="rounded-2xl border border-border-button-default bg-status-lime-background/30 p-5 flex items-center gap-3 text-status-lime-text">
          <HugeCheck className="size-5 shrink-0" />
          <span className="text-body-medium">
            Sign-in link sent to <span className="font-medium">{email}</span>
          </span>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Input
            label="Work email"
            type="email"
            placeholder="you@company.com"
            value={email}
            onChange={setEmail}
            leadingIcon={HugeMail}
            isRequired
          />

          <Button type="submit" variant="primary" className="w-full justify-center">
            Send magic link
          </Button>
        </form>
      )}

      {/* FOOTER */}
      <div className="flex flex-col items-center gap-3 pt-3 border-t border-border-button-default text-center">
        <span className="text-caption-1-semibold text-text-tertiary">
          Only free and busy calendar slots are read.
        </span>

        <button
          type="button"
          onClick={onGoToOnboarding}
          className="text-body-2-regular text-accent-500 hover:underline cursor-pointer flex items-center gap-1"
        >
          <span>Need a new account? Start onboarding</span>
          <HugeArrowRight className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
