export interface BookingEmailPayload {
  toEmail: string;
  guestName: string;
  hostName: string;
  eventTitle: string;
  dateStr: string;
  timeStr: string;
  durationMins: number;
  meetLink?: string;
  cancelUrl?: string;
}

export async function sendBookingConfirmationEmail(payload: BookingEmailPayload): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || apiKey.includes("re_...") || !apiKey.startsWith("re_")) {
    console.log("[Email] Resend API key not configured, skipping dispatch:", payload.toEmail);
    return false;
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Morrow <notifications@usemorrow.xyz>",
        to: [payload.toEmail],
        subject: `Confirmed: ${payload.eventTitle} with ${payload.hostName}`,
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #0F172A;">
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 24px;">
              <div style="width: 32px; height: 32px; border-radius: 8px; background: #2563EB; color: #FFFFFF; font-weight: bold; font-size: 16px; display: flex; align-items: center; justify-content: center; text-align: center; line-height: 32px;">M</div>
              <span style="font-size: 18px; font-weight: 600; color: #0F172A;">Morrow</span>
            </div>

            <h1 style="font-size: 22px; font-weight: 600; margin-bottom: 8px;">You're scheduled!</h1>
            <p style="font-size: 15px; color: #475569; margin-bottom: 24px;">
              Hi ${payload.guestName}, your meeting with ${payload.hostName} is confirmed.
            </p>

            <div style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 16px; padding: 20px; margin-bottom: 24px;">
              <h2 style="font-size: 17px; font-weight: 600; margin-top: 0; margin-bottom: 12px; color: #0F172A;">
                ${payload.eventTitle} (${payload.durationMins} mins)
              </h2>
              <div style="font-size: 14px; color: #334155; line-height: 1.6;">
                <div>📅 <strong>When:</strong> ${payload.dateStr} at ${payload.timeStr}</div>
                ${payload.meetLink ? `<div style="margin-top: 8px;">📹 <strong>Video Link:</strong> <a href="${payload.meetLink}" style="color: #2563EB; text-decoration: underline;">Join Google Meet</a></div>` : ""}
              </div>
            </div>

            ${payload.cancelUrl ? `
              <p style="font-size: 13px; color: #64748B;">
                Need to make a change? <a href="${payload.cancelUrl}" style="color: #64748B; text-decoration: underline;">Cancel or reschedule</a>.
              </p>
            ` : ""}
          </div>
        `,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error("[Email] Resend API error:", err);
      return false;
    }

    return true;
  } catch (err) {
    console.error("[Email] Failed to send confirmation email:", err);
    return false;
  }
}
