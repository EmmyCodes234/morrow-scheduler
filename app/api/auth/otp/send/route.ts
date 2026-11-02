import { NextRequest, NextResponse } from "next/server";
import { db, verificationTokens } from "@/db";
import { sendOtpEmail } from "@/lib/email";
import crypto from "crypto";
import { eq, and, gt } from "drizzle-orm";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const rawEmail = body.email;

    if (!rawEmail || typeof rawEmail !== "string") {
      return NextResponse.json({ error: "A valid email address is required." }, { status: 400 });
    }

    const email = rawEmail.trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json({ error: "Please enter a valid email address." }, { status: 400 });
    }

    // Rate limiting: check if a token was issued in the last 30 seconds
    const thirtySecondsAgo = new Date(Date.now() - 30 * 1000);
    const [recentToken] = await db
      .select()
      .from(verificationTokens)
      .where(
        and(
          eq(verificationTokens.email, email),
          gt(verificationTokens.createdAt, thirtySecondsAgo)
        )
      )
      .limit(1);

    if (recentToken) {
      return NextResponse.json(
        { error: "A verification code was recently sent. Please wait a few seconds before requesting another." },
        { status: 429 }
      );
    }

    // Generate 6-digit code
    const otpCode = crypto.randomInt(100000, 1000000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Remove any previous tokens for this email
    await db.delete(verificationTokens).where(eq(verificationTokens.email, email));

    // Save token to DB
    await db.insert(verificationTokens).values({
      email,
      token: otpCode,
      expiresAt,
    });

    // Send email via Resend
    const sent = await sendOtpEmail(email, otpCode);
    if (!sent) {
      return NextResponse.json(
        { error: "Could not send verification email. Please check your email and try again." },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "Verification code sent to your email.",
    });
  } catch (err: any) {
    console.error("[OTP Send Error]:", err);
    return NextResponse.json({ error: err.message || "An unexpected error occurred." }, { status: 500 });
  }
}
