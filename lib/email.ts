import {
  buildGuestConfirmationEmail,
  buildHostBookingNotificationEmail,
  buildGuestApprovalEmail,
  buildGuestRejectionEmail,
  buildGuestCancellationEmail,
  buildHostCancellationEmail,
  buildOtpEmail,
} from "./email-templates";

export interface BookingEmailPayload {
  toEmail: string;
  guestName: string;
  hostName: string;
  hostEmail?: string;
  eventTitle: string;
  dateStr: string;
  timeStr: string;
  durationMins: number;
  status?: string;
  calendarSynced?: boolean;
  locationType?: string;
  locationUrl?: string;
  meetLink?: string;
  guestNotes?: string;
  cancelUrl?: string;
  idempotencyKey?: string;
}

export async function sendBookingConfirmationEmail(
  payload: BookingEmailPayload,
  idempotencyKey?: string
): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || apiKey.includes("re_...") || !apiKey.startsWith("re_")) {
    console.log("[Email] Resend API key not configured, skipping dispatch:", payload.toEmail);
    return false;
  }

  const isPending = payload.status === "pending";

  const html = buildGuestConfirmationEmail({
    guestName: payload.guestName,
    hostName: payload.hostName,
    eventTitle: payload.eventTitle,
    dateStr: payload.dateStr,
    timeStr: payload.timeStr,
    durationMins: payload.durationMins,
    status: payload.status,
    calendarSynced: payload.calendarSynced,
    locationType: payload.locationType,
    locationUrl: payload.locationUrl,
    meetLink: payload.meetLink,
    cancelUrl: payload.cancelUrl,
  });

  const subject = isPending
    ? `Booking Request Received: ${payload.eventTitle} with ${payload.hostName}`
    : `Confirmed: ${payload.eventTitle} with ${payload.hostName}`;

  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    };
    const key = idempotencyKey || payload.idempotencyKey;
    if (key) {
      headers["Idempotency-Key"] = key;
    }

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers,
      body: JSON.stringify({
        from: "Morrow <notifications@usemorrow.xyz>",
        to: [payload.toEmail],
        subject,
        html,
      }),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => "");
      console.error(`[Email] Resend API error (${res.status}):`, err);
      return false;
    }

    // Also notify host if host email is present
    if (payload.hostEmail && payload.hostEmail !== payload.toEmail) {
      sendHostNotificationEmail(
        payload,
        key ? `${key}-host` : undefined
      ).catch((e) =>
        console.error("[Email] Error sending host notification:", e)
      );
    }

    return true;
  } catch (err) {
    console.error("[Email] Failed to send confirmation email:", err);
    return false;
  }
}

export async function sendBookingApprovalEmail(
  payload: BookingEmailPayload,
  idempotencyKey?: string
): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || apiKey.includes("re_...") || !apiKey.startsWith("re_")) {
    console.log("[Email] Resend API key not configured, skipping approval email:", payload.toEmail);
    return false;
  }

  const html = buildGuestApprovalEmail({
    guestName: payload.guestName,
    hostName: payload.hostName,
    eventTitle: payload.eventTitle,
    dateStr: payload.dateStr,
    timeStr: payload.timeStr,
    durationMins: payload.durationMins,
    calendarSynced: payload.calendarSynced,
    locationType: payload.locationType,
    locationUrl: payload.locationUrl,
    meetLink: payload.meetLink,
    cancelUrl: payload.cancelUrl,
  });

  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    };
    const key = idempotencyKey || payload.idempotencyKey;
    if (key) {
      headers["Idempotency-Key"] = key;
    }

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers,
      body: JSON.stringify({
        from: "Morrow <notifications@usemorrow.xyz>",
        to: [payload.toEmail],
        subject: `Approved: ${payload.eventTitle} with ${payload.hostName}`,
        html,
      }),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => "");
      console.error(`[Email] Resend API error (${res.status}):`, err);
      return false;
    }

    return true;
  } catch (err) {
    console.error("[Email] Failed to send approval email:", err);
    return false;
  }
}

export async function sendBookingRejectionEmail(
  payload: {
    toEmail: string;
    guestName: string;
    hostName: string;
    eventTitle: string;
    dateStr: string;
    timeStr: string;
    reason?: string;
    bookingUrl?: string;
    idempotencyKey?: string;
  },
  idempotencyKey?: string
): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || apiKey.includes("re_...") || !apiKey.startsWith("re_")) {
    console.log("[Email] Resend API key not configured, skipping rejection email:", payload.toEmail);
    return false;
  }

  const html = buildGuestRejectionEmail({
    guestName: payload.guestName,
    hostName: payload.hostName,
    eventTitle: payload.eventTitle,
    dateStr: payload.dateStr,
    timeStr: payload.timeStr,
    reason: payload.reason,
    bookingUrl: payload.bookingUrl,
  });

  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    };
    const key = idempotencyKey || payload.idempotencyKey;
    if (key) {
      headers["Idempotency-Key"] = key;
    }

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers,
      body: JSON.stringify({
        from: "Morrow <notifications@usemorrow.xyz>",
        to: [payload.toEmail],
        subject: `Declined: ${payload.eventTitle} with ${payload.hostName}`,
        html,
      }),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => "");
      console.error(`[Email] Resend API error (${res.status}):`, err);
      return false;
    }

    return true;
  } catch (err) {
    console.error("[Email] Failed to send rejection email:", err);
    return false;
  }
}

async function sendHostNotificationEmail(
  payload: BookingEmailPayload,
  idempotencyKey?: string
): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || !payload.hostEmail) return false;

  const isPending = payload.status === "pending";

  const html = buildHostBookingNotificationEmail({
    hostName: payload.hostName,
    guestName: payload.guestName,
    guestEmail: payload.toEmail,
    eventTitle: payload.eventTitle,
    dateStr: payload.dateStr,
    timeStr: payload.timeStr,
    durationMins: payload.durationMins,
    status: payload.status,
    guestNotes: payload.guestNotes,
    locationType: payload.locationType,
    locationUrl: payload.locationUrl,
    meetLink: payload.meetLink,
    dashboardUrl: `${process.env.NEXT_PUBLIC_APP_URL || "https://usemorrow.xyz"}/dashboard`,
  });

  const subject = isPending
    ? `Booking Request: ${payload.guestName} requested ${payload.eventTitle}`
    : `New Meeting: ${payload.guestName} booked ${payload.eventTitle}`;

  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    };
    if (idempotencyKey) {
      headers["Idempotency-Key"] = idempotencyKey;
    }

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers,
      body: JSON.stringify({
        from: "Morrow <notifications@usemorrow.xyz>",
        to: [payload.hostEmail],
        subject,
        html,
      }),
    });
    return res.ok;
  } catch (err) {
    console.error("[Email] Failed to send host notification:", err);
    return false;
  }
}

/**
 * Send an OTP code to an email address for authentication / login / registration.
 */
export async function sendOtpEmail(email: string, otpCode: string): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || apiKey.includes("re_...") || !apiKey.startsWith("re_")) {
    console.log("[Email] Resend API key not configured, skipping OTP email:", email);
    return false;
  }

  const html = buildOtpEmail({
    otpCode,
    email,
  });

  const fromEmail = process.env.RESEND_AUTH_FROM_EMAIL || "Morrow Security <auth@usemorrow.xyz>";

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [email],
        subject: `${otpCode} is your Morrow verification code`,
        html,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error("[Email] Resend API error sending OTP:", err);
      return false;
    }

    return true;
  } catch (err) {
    console.error("[Email] Failed to send OTP email:", err);
    return false;
  }
}


export async function sendGuestCancellationEmail(
  payload: {
    toEmail: string;
    hostName: string;
    guestName: string;
    guestEmail: string;
    eventTitle: string;
    dateStr: string;
    timeStr: string;
    reason?: string;
    dashboardUrl?: string;
    idempotencyKey?: string;
  },
  idempotencyKey?: string
): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || apiKey.includes("re_...") || !apiKey.startsWith("re_")) {
    console.log("[Email] Resend API key not configured, skipping guest cancellation email:", payload.toEmail);
    return false;
  }

  const html = buildGuestCancellationEmail({
    hostName: payload.hostName,
    guestName: payload.guestName,
    guestEmail: payload.guestEmail,
    eventTitle: payload.eventTitle,
    dateStr: payload.dateStr,
    timeStr: payload.timeStr,
    reason: payload.reason,
    dashboardUrl: payload.dashboardUrl || `${process.env.NEXT_PUBLIC_APP_URL || "https://usemorrow.xyz"}/dashboard/bookings`,
  });

  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    };
    const key = idempotencyKey || payload.idempotencyKey;
    if (key) {
      headers["Idempotency-Key"] = key;
    }

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers,
      body: JSON.stringify({
        from: "Morrow <notifications@usemorrow.xyz>",
        to: [payload.toEmail],
        subject: `Cancelled: ${payload.eventTitle} with ${payload.guestName}`,
        html,
      }),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => "");
      console.error(`[Email] Resend API error (${res.status}):`, err);
      return false;
    }

    return true;
  } catch (err) {
    console.error("[Email] Failed to send guest cancellation email:", err);
    return false;
  }
}

export async function sendHostCancellationEmail(
  payload: {
    toEmail: string;
    guestName: string;
    hostName: string;
    eventTitle: string;
    dateStr: string;
    timeStr: string;
    reason?: string;
    rebookUrl?: string;
    idempotencyKey?: string;
  },
  idempotencyKey?: string
): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || apiKey.includes("re_...") || !apiKey.startsWith("re_")) {
    console.log("[Email] Resend API key not configured, skipping host cancellation email:", payload.toEmail);
    return false;
  }

  const html = buildHostCancellationEmail({
    guestName: payload.guestName,
    hostName: payload.hostName,
    eventTitle: payload.eventTitle,
    dateStr: payload.dateStr,
    timeStr: payload.timeStr,
    reason: payload.reason,
    rebookUrl: payload.rebookUrl,
  });

  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    };
    const key = idempotencyKey || payload.idempotencyKey;
    if (key) {
      headers["Idempotency-Key"] = key;
    }

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers,
      body: JSON.stringify({
        from: "Morrow <notifications@usemorrow.xyz>",
        to: [payload.toEmail],
        subject: `Cancelled: ${payload.eventTitle} with ${payload.hostName}`,
        html,
      }),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => "");
      console.error(`[Email] Resend API error (${res.status}):`, err);
      return false;
    }

    return true;
  } catch (err) {
    console.error("[Email] Failed to send host cancellation email:", err);
    return false;
  }
}
