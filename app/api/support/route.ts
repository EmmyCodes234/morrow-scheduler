import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    const body = await req.json();
    const { category, subject, message, userEmail, userName } = body;

    const senderEmail = userEmail || session?.user?.email || "anonymous@usemorrow.xyz";
    const senderName = userName || session?.user?.name || "Morrow User";

    if (!subject || !message) {
      return NextResponse.json({ error: "Subject and message are required" }, { status: 400 });
    }

    const ticketId = `MRW-${Math.floor(100000 + Math.random() * 900000)}`;

    // Dispatch notification to support and user confirmation via Resend if API key is configured
    const apiKey = process.env.RESEND_API_KEY;
    if (apiKey && !apiKey.includes("re_...") && apiKey.startsWith("re_")) {
      try {
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: "Morrow Support <support@usemorrow.xyz>",
            to: ["support@usemorrow.xyz"],
            reply_to: senderEmail,
            subject: `[${ticketId}] [${category.toUpperCase()}] ${subject}`,
            text: `Support Ticket: ${ticketId}\nFrom: ${senderName} (${senderEmail})\nCategory: ${category}\n\nMessage:\n${message}`,
          }),
        });
      } catch (emailErr) {
        console.error("Error dispatching support ticket email:", emailErr);
      }
    } else {
      console.log(`[Support Ticket ${ticketId}] From: ${senderName} (${senderEmail}) | Subject: ${subject} | Message: ${message}`);
    }

    return NextResponse.json({ success: true, ticketId });
  } catch (err) {
    console.error("Support API error:", err);
    return NextResponse.json({ error: "Failed to process support request" }, { status: 500 });
  }
}
