"use client";

import { useState, useEffect } from "react";
import { signIn } from "next-auth/react";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { InputOtp } from "@/components/base/input-otp/input-otp";
import { SocialButton } from "@/components/base/social-button/social-button";
import {
  HugeMail,
  HugeArrowRight,
  HugeArrowLeft,
  HugeCheck,
  HugeAlert,
} from "@/components/icons/hugeicons";
import { MorrowLogo } from "@/components/brand/morrow-logo";

export interface LoginViewProps {
  onSuccess?: () => void;
  onGoToOnboarding?: () => void;
}

export function LoginView({ onSuccess, onGoToOnboarding }: LoginViewProps) {
  const [step, setStep] = useState<"email" | "otp">("email");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(0);

  // Countdown timer for code resend
  useEffect(() => {
    if (countdown <= 0) return;
    const interval = setInterval(() => {
      setCountdown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(interval);
  }, [countdown]);

  // Step 1: Send OTP code
  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !email.includes("@")) {
      setError("Please enter a valid email address.");
      return;
    }

    setIsSending(true);
    setError(null);

    try {
      const res = await fetch("/api/auth/otp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to send code. Please try again.");
        setIsSending(false);
        return;
      }

      setStep("otp");
      setOtp("");
      setCountdown(60);
      setIsSending(false);
    } catch (err: any) {
      console.error("Error sending OTP:", err);
      setError("Failed to connect to the server. Please try again.");
      setIsSending(false);
    }
  };

  // Resend OTP code
  const handleResendOtp = async () => {
    if (countdown > 0 || isResending) return;

    setIsResending(true);
    setError(null);

    try {
      const res = await fetch("/api/auth/otp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to resend code.");
      } else {
        setCountdown(60);
      }
    } catch (err) {
      setError("Could not resend code. Please try again.");
    } finally {
      setIsResending(false);
    }
  };

  // Step 2: Verify OTP and sign in
  const handleVerifyOtp = async (codeToVerify?: string) => {
    const code = (codeToVerify || otp).trim();
    if (code.length !== 6 || isVerifying) return;

    setIsVerifying(true);
    setError(null);

    try {
      const result = await signIn("email-otp", {
        email,
        otp: code,
        redirect: false,
      });

      if (result?.error) {
        setError("Invalid or expired verification code. Please check and try again.");
        setIsVerifying(false);
        return;
      }

      // Success! Redirect to dashboard (or onboarding if new account)
      if (onSuccess) {
        onSuccess();
      } else {
        window.location.href = "/dashboard";
      }
    } catch (err) {
      console.error("Error verifying OTP:", err);
      setError("An unexpected error occurred during verification.");
      setIsVerifying(false);
    }
  };

  return (
    <div className="w-full max-w-md mx-auto rounded-3xl border border-border-button-default bg-background-primary-default p-8 sm:p-10 shadow-sm flex flex-col gap-6">
      {/* BRAND & HEADER */}
      <div className="flex flex-col items-center text-center gap-2">
        <MorrowLogo size={40} variant="icon" className="mb-2 shadow-sm" />
        <h1 className="text-title-2-medium text-text-primary">
          {step === "email" ? "Sign in to Morrow" : "Check your inbox"}
        </h1>
        <p className="text-body-regular text-text-secondary">
          {step === "email"
            ? "Tomorrow starts here. Connect your calendar and get booked."
            : `We sent a 6-digit verification code to ${email}`}
        </p>
      </div>

      {/* ERROR ALERT */}
      {error && (
        <div className="rounded-2xl border border-border-error-default bg-background-tertiary-error/60 p-3.5 flex items-start gap-2.5 text-text-error-primary">
          <HugeAlert className="size-4 shrink-0 mt-0.5 text-foreground-icon-error" />
          <span className="text-body-2-regular">{error}</span>
        </div>
      )}

      {step === "email" ? (
        <>
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
          <div className="relative flex py-1 items-center">
            <div className="flex-grow border-t border-border-button-default" />
            <span className="flex-shrink mx-4 text-caption-1-semibold text-text-tertiary uppercase tracking-wider">
              Or continue with email
            </span>
            <div className="flex-grow border-t border-border-button-default" />
          </div>

          {/* EMAIL SIGN IN */}
          <form onSubmit={handleSendOtp} className="flex flex-col gap-4">
            <Input
              label="Work email"
              type="email"
              placeholder="you@company.com"
              value={email}
              onChange={(val) => {
                setEmail(val);
                if (error) setError(null);
              }}
              leadingIcon={HugeMail}
              isRequired
              isDisabled={isSending}
            />

            <Button
              type="submit"
              variant="primary"
              disabled={isSending || !email}
              className="w-full justify-center"
            >
              {isSending ? "Sending code..." : "Send verification code"}
            </Button>
          </form>

          {/* FOOTER */}
          <div className="flex flex-col items-center gap-3 pt-3 border-t border-border-button-default text-center">
            <span className="text-caption-1-semibold text-text-tertiary">
              Calendar syncing is encrypted and conflict-free.
            </span>

            {onGoToOnboarding && (
              <button
                type="button"
                onClick={onGoToOnboarding}
                className="text-body-2-regular text-accent-500 hover:underline cursor-pointer flex items-center gap-1"
              >
                <span>Need a new account? Start onboarding</span>
                <HugeArrowRight className="size-3.5" />
              </button>
            )}
          </div>
        </>
      ) : (
        /* STEP 2: OTP ENTRY */
        <div className="flex flex-col gap-6">
          <div className="flex flex-col items-center gap-4">
            <InputOtp
              length={6}
              groupEvery={3}
              value={otp}
              onChange={(val) => {
                setOtp(val);
                if (error) setError(null);
              }}
              onComplete={(val) => handleVerifyOtp(val)}
              isDisabled={isVerifying}
              isInvalid={!!error}
            />
          </div>

          <Button
            type="button"
            variant="primary"
            onClick={() => handleVerifyOtp()}
            disabled={otp.length !== 6 || isVerifying}
            className="w-full justify-center"
          >
            {isVerifying ? "Verifying..." : "Verify and continue"}
          </Button>

          {/* RESEND & BACK */}
          <div className="flex flex-col items-center gap-3 pt-2 text-center">
            <div className="text-body-2-regular text-text-secondary">
              {countdown > 0 ? (
                <span>Resend code in <strong className="text-text-primary">{countdown}s</strong></span>
              ) : (
                <button
                  type="button"
                  onClick={handleResendOtp}
                  disabled={isResending}
                  className="text-accent-500 hover:underline cursor-pointer font-medium"
                >
                  {isResending ? "Resending..." : "Resend code"}
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={() => {
                setStep("email");
                setError(null);
              }}
              className="text-body-2-regular text-text-tertiary hover:text-text-primary flex items-center gap-1 cursor-pointer transition-colors"
            >
              <HugeArrowLeft className="size-3.5" />
              <span>Use a different email</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
