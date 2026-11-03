/**
 * BoardUI Email Template System
 * 
 * Translates BoardUI's semantic tokens, composite typography, and component styling
 * into bulletproof, responsive, email-client-safe inline HTML.
 */

export interface EmailBaseOptions {
  previewText?: string;
  headline: string;
  subheadline?: string;
  badgeText?: string;
  badgeVariant?: "blue" | "lime" | "destructive";
  contentHtml: string;
  primaryCta?: {
    label: string;
    url: string;
  };
  footerLinks?: {
    label: string;
    url: string;
  }[];
}

const BADGE_COLORS = {
  blue: { bg: "#EFF6FF", text: "#1D4ED8", border: "#BFDBFE" },
  lime: { bg: "#F7FEE7", text: "#3F6212", border: "#D9F99D" },
  destructive: { bg: "#FEF2F2", text: "#B91C1C", border: "#FECACA" },
};

/**
 * Base email layout matching BoardUI's visual aesthetic:
 * - Inter font stack
 * - #F8FAFC ground ground
 * - #FFFFFF elevated card with 1px #E2E8F0 border & 16px radius
 * - #2563EB primary CTA buttons
 */
export function renderBoardUIEmailLayout(opts: EmailBaseOptions): string {
  const badgeStyle = opts.badgeVariant ? BADGE_COLORS[opts.badgeVariant] : BADGE_COLORS.blue;

  return `
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${opts.headline}</title>
  <style type="text/css">
    @media only screen and (max-width: 600px) {
      .email-card { width: 100% !important; padding: 20px !important; }
      .email-container { padding: 12px !important; }
    }
  </style>
</head>
<body style="margin: 0; padding: 0; background-color: #F8FAFC; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased;">
  <!-- PREVIEW TEXT -->
  ${opts.previewText ? `<div style="display:none;font-size:1px;color:#F8FAFC;line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;">${opts.previewText}</div>` : ""}

  <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #F8FAFC; padding: 40px 16px;">
    <tr>
      <td align="center">
        <!-- MAX WIDTH WRAPPER (560px) -->
        <table border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 560px;">
          <!-- BRAND LOGO HEADER -->
          <tr>
            <td align="left" style="padding-bottom: 24px;">
              <table border="0" cellpadding="0" cellspacing="0">
                <tr>
                  <!-- Morrow Icon Tile -->
                  <td style="width: 32px; height: 32px; border-radius: 9px; background-color: #2563EB; text-align: center; vertical-align: middle;">
                    <span style="font-family: 'Inter', sans-serif; font-size: 16px; font-weight: 800; color: #FFFFFF; line-height: 32px;">M</span>
                  </td>
                  <td style="padding-left: 10px;">
                    <span style="font-family: 'Inter', sans-serif; font-size: 18px; font-weight: 700; color: #0F172A; letter-spacing: -0.03em;">Morrow</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- MAIN CARD -->
          <tr>
            <td class="email-card" style="background-color: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 18px; padding: 32px; box-shadow: 0 1px 3px rgba(15, 23, 42, 0.04);">
              ${opts.badgeText ? `
                <div style="margin-bottom: 16px;">
                  <span style="display: inline-block; background-color: ${badgeStyle.bg}; color: ${badgeStyle.text}; border: 1px solid ${badgeStyle.border}; font-size: 12px; font-weight: 600; padding: 3px 10px; border-radius: 9999px; text-transform: uppercase; letter-spacing: 0.04em;">
                    ${opts.badgeText}
                  </span>
                </div>
              ` : ""}

              <h1 style="margin: 0 0 8px 0; font-size: 22px; font-weight: 700; color: #0F172A; letter-spacing: -0.025em; line-height: 1.3;">
                ${opts.headline}
              </h1>

              ${opts.subheadline ? `
                <p style="margin: 0 0 24px 0; font-size: 15px; color: #475569; line-height: 1.55;">
                  ${opts.subheadline}
                </p>
              ` : '<div style="margin-bottom: 20px;"></div>'}

              <!-- INJECTED BODY CONTENT -->
              ${opts.contentHtml}

              <!-- PRIMARY CTA BUTTON -->
              ${opts.primaryCta ? `
                <table border="0" cellpadding="0" cellspacing="0" width="100%" style="margin-top: 28px; margin-bottom: 8px;">
                  <tr>
                    <td align="center">
                      <a href="${opts.primaryCta.url}" target="_blank" style="display: block; width: 100%; box-sizing: border-box; background-color: #2563EB; color: #FFFFFF; font-family: 'Inter', sans-serif; font-size: 15px; font-weight: 600; text-align: center; text-decoration: none; padding: 13px 24px; border-radius: 12px; box-shadow: 0 1px 2px rgba(37, 99, 235, 0.2);">
                        ${opts.primaryCta.label}
                      </a>
                    </td>
                  </tr>
                </table>
              ` : ""}
            </td>
          </tr>

          <!-- FOOTER -->
          <tr>
            <td align="center" style="padding-top: 24px; padding-bottom: 12px;">
              ${opts.footerLinks && opts.footerLinks.length > 0 ? `
                <div style="font-size: 13px; color: #64748B; margin-bottom: 8px;">
                  ${opts.footerLinks.map((l) => `<a href="${l.url}" style="color: #64748B; text-decoration: underline; margin: 0 8px;">${l.label}</a>`).join("&bull;")}
                </div>
              ` : ""}
              <p style="margin: 0; font-size: 12px; color: #94A3B8; letter-spacing: 0.01em;">
                Powered by <a href="https://usemorrow.xyz" style="color: #2563EB; text-decoration: none; font-weight: 500;">Morrow</a> &bull; Tomorrow starts here
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;
}

function resolveLocationDisplay(opts: {
  locationType?: string;
  locationUrl?: string;
  meetLink?: string;
}): { label: string; detail: string; ctaUrl?: string } | null {
  const locType = opts.locationType || (opts.meetLink?.includes("zoom") ? "zoom" : opts.meetLink ? "google_meet" : undefined);
  const targetUrl = opts.locationUrl || opts.meetLink;

  if (locType === "zoom") {
    return {
      label: "Zoom Meeting",
      detail: targetUrl || "Link will be shared by host",
      ctaUrl: targetUrl,
    };
  }
  if (locType === "google_meet") {
    return {
      label: "Google Meet",
      detail: targetUrl || "Link will be shared before meeting",
      ctaUrl: targetUrl,
    };
  }
  if (locType === "phone") {
    return {
      label: "Phone Call",
      detail: targetUrl || "Host will initiate contact at scheduled time",
    };
  }
  if (locType === "in_person") {
    return {
      label: "In-Person Meeting",
      detail: targetUrl || "Address provided by host",
    };
  }
  if (locType === "custom" || targetUrl) {
    return {
      label: "Location",
      detail: targetUrl || "Details provided by host",
      ctaUrl: targetUrl?.startsWith("http") ? targetUrl : undefined,
    };
  }
  return null;
}

/**
 * Guest Booking Confirmation Email
 */
export function buildGuestConfirmationEmail(data: {
  guestName: string;
  hostName: string;
  eventTitle: string;
  dateStr: string;
  timeStr: string;
  durationMins: number;
  status?: string;
  calendarSynced?: boolean;
  locationType?: string;
  locationUrl?: string;
  meetLink?: string;
  cancelUrl?: string;
}): string {
  const isPending = data.status === "pending";
  const locationInfo = resolveLocationDisplay({
    locationType: data.locationType,
    locationUrl: data.locationUrl,
    meetLink: data.meetLink,
  });

  const content = `
    <div style="background-color: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 14px; padding: 20px; margin-bottom: 20px;">
      <div style="margin-bottom: 14px;">
        <span style="font-size: 16px; font-weight: 700; color: #0F172A;">${data.eventTitle}</span>
        <span style="display: inline-block; background-color: #EFF6FF; color: #1D4ED8; font-size: 12px; font-weight: 600; padding: 2px 8px; border-radius: 9999px; margin-left: 6px;">
          ${data.durationMins} mins
        </span>
      </div>

      <table border="0" cellpadding="0" cellspacing="0" width="100%" style="font-size: 14px; color: #334155; line-height: 1.7;">
        <tr>
          <td style="width: 24px; vertical-align: top; padding-bottom: 6px;">📅</td>
          <td style="padding-bottom: 6px;">
            <strong style="color: #0F172A;">When:</strong> ${data.dateStr} at ${data.timeStr}
          </td>
        </tr>
        <tr>
          <td style="width: 24px; vertical-align: top; padding-bottom: 6px;">👤</td>
          <td style="padding-bottom: 6px;">
            <strong style="color: #0F172A;">Host:</strong> ${data.hostName}
          </td>
        </tr>
        ${locationInfo ? `
          <tr>
            <td style="width: 24px; vertical-align: top; padding-bottom: 6px;">📍</td>
            <td style="padding-bottom: 6px;">
              <strong style="color: #0F172A;">${locationInfo.label}:</strong> ${locationInfo.detail}
            </td>
          </tr>
        ` : ""}
        ${isPending ? `
          <tr>
            <td style="width: 24px; vertical-align: top; padding-bottom: 6px;">⏳</td>
            <td style="padding-bottom: 6px;">
              <strong style="color: #B45309;">Status:</strong> Pending host approval
            </td>
          </tr>
        ` : ""}
      </table>
    </div>
  `;

  if (isPending) {
    return renderBoardUIEmailLayout({
      previewText: `Request Received: ${data.eventTitle} with ${data.hostName}`,
      badgeText: "Pending Approval",
      badgeVariant: "blue",
      headline: "Booking Request Received",
      subheadline: `Hi ${data.guestName}, your request for ${data.eventTitle} with ${data.hostName} has been submitted. This event requires host approval. You will receive an update once the host reviews your request.`,
      contentHtml: content,
      footerLinks: data.cancelUrl ? [
        { label: "Cancel request", url: data.cancelUrl },
      ] : undefined,
    });
  }

  const calendarSubtext = data.calendarSynced
    ? `A calendar invitation has been added to your schedule.`
    : `Please mark your calendar for the scheduled time.`;

  return renderBoardUIEmailLayout({
    previewText: `Confirmed: ${data.eventTitle} with ${data.hostName}`,
    badgeText: "Confirmed",
    badgeVariant: "lime",
    headline: "You're scheduled!",
    subheadline: `Hi ${data.guestName}, your meeting with ${data.hostName} is confirmed. ${calendarSubtext}`,
    contentHtml: content,
    primaryCta: locationInfo?.ctaUrl ? {
      label: `Join ${locationInfo.label}`,
      url: locationInfo.ctaUrl,
    } : undefined,
    footerLinks: data.cancelUrl ? [
      { label: "Cancel booking", url: data.cancelUrl },
    ] : undefined,
  });
}

/**
 * Host Notification Email (when a guest books or requests approval)
 */
export function buildHostBookingNotificationEmail(data: {
  hostName: string;
  guestName: string;
  guestEmail: string;
  eventTitle: string;
  dateStr: string;
  timeStr: string;
  durationMins: number;
  status?: string;
  guestNotes?: string;
  locationType?: string;
  locationUrl?: string;
  meetLink?: string;
  dashboardUrl: string;
}): string {
  const isPending = data.status === "pending";
  const locationInfo = resolveLocationDisplay({
    locationType: data.locationType,
    locationUrl: data.locationUrl,
    meetLink: data.meetLink,
  });

  const content = `
    <div style="background-color: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 14px; padding: 20px; margin-bottom: 20px;">
      <div style="margin-bottom: 14px;">
        <span style="font-size: 16px; font-weight: 700; color: #0F172A;">${data.eventTitle}</span>
        <span style="display: inline-block; background-color: #EFF6FF; color: #1D4ED8; font-size: 12px; font-weight: 600; padding: 2px 8px; border-radius: 9999px; margin-left: 6px;">
          ${data.durationMins} mins
        </span>
      </div>

      <table border="0" cellpadding="0" cellspacing="0" width="100%" style="font-size: 14px; color: #334155; line-height: 1.7;">
        <tr>
          <td style="width: 24px; vertical-align: top; padding-bottom: 6px;">📅</td>
          <td style="padding-bottom: 6px;">
            <strong style="color: #0F172A;">When:</strong> ${data.dateStr} at ${data.timeStr}
          </td>
        </tr>
        <tr>
          <td style="width: 24px; vertical-align: top; padding-bottom: 6px;">👤</td>
          <td style="padding-bottom: 6px;">
            <strong style="color: #0F172A;">Guest:</strong> ${data.guestName} (<a href="mailto:${data.guestEmail}" style="color: #2563EB; text-decoration: none;">${data.guestEmail}</a>)
          </td>
        </tr>
        ${locationInfo ? `
          <tr>
            <td style="width: 24px; vertical-align: top; padding-bottom: 6px;">📍</td>
            <td style="padding-bottom: 6px;">
              <strong style="color: #0F172A;">${locationInfo.label}:</strong> ${locationInfo.detail}
            </td>
          </tr>
        ` : ""}
        ${data.guestNotes ? `
          <tr>
            <td style="width: 24px; vertical-align: top; padding-bottom: 6px;">📝</td>
            <td style="padding-bottom: 6px;">
              <strong style="color: #0F172A;">Notes:</strong> ${data.guestNotes}
            </td>
          </tr>
        ` : ""}
      </table>
    </div>
  `;

  if (isPending) {
    return renderBoardUIEmailLayout({
      previewText: `Action Required: ${data.guestName} requested ${data.eventTitle}`,
      badgeText: "Requires Approval",
      badgeVariant: "blue",
      headline: "New booking request",
      subheadline: `Hi ${data.hostName}, ${data.guestName} has requested a ${data.eventTitle} with you. Please review and approve or reject this booking in your dashboard.`,
      contentHtml: content,
      primaryCta: {
        label: "Review Request in Dashboard",
        url: data.dashboardUrl,
      },
    });
  }

  return renderBoardUIEmailLayout({
    previewText: `New Booking: ${data.guestName} booked ${data.eventTitle}`,
    badgeText: "New Booking",
    badgeVariant: "blue",
    headline: "New meeting booked",
    subheadline: `Hi ${data.hostName}, ${data.guestName} has scheduled a ${data.eventTitle} with you.`,
    contentHtml: content,
    primaryCta: {
      label: "View in Morrow Dashboard",
      url: data.dashboardUrl,
    },
  });
}

/**
 * One-Time Password (OTP) Verification Email
 */
export function buildOtpEmail(data: {
  otpCode: string;
  email: string;
}): string {
  // Format code with a middle space: e.g. "482 910"
  const formattedCode =
    data.otpCode.length === 6
      ? `${data.otpCode.slice(0, 3)} ${data.otpCode.slice(3)}`
      : data.otpCode;

  const content = `
    <div style="background-color: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 16px; padding: 28px 20px; text-align: center; margin: 24px 0 20px 0;">
      <div style="font-size: 13px; font-weight: 600; color: #64748B; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 12px;">
        Your Verification Code
      </div>
      <div style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 36px; font-weight: 700; color: #0F172A; letter-spacing: 0.18em; line-height: 1.1; margin-bottom: 12px;">
        ${formattedCode}
      </div>
      <div style="font-size: 13px; color: #64748B;">
        Expires in <strong style="color: #0F172A;">10 minutes</strong>
      </div>
    </div>

    <p style="font-size: 14px; color: #475569; line-height: 1.6; margin: 0 0 12px 0;">
      We received a request to sign in to your Morrow account using <strong style="color: #0F172A;">${data.email}</strong>.
    </p>
    <p style="font-size: 13px; color: #94A3B8; line-height: 1.5; margin: 0;">
      If you did not request this code, no action is required and your account remains safe.
    </p>
  `;

  return renderBoardUIEmailLayout({
    previewText: `${data.otpCode} is your Morrow verification code`,
    badgeText: "Security Verification",
    badgeVariant: "blue",
    headline: "Verify your email",
    subheadline: "Use the 6-digit code below to securely authenticate with Morrow.",
    contentHtml: content,
  });
}


/**
 * Guest Booking Approval Notification Email
 */
export function buildGuestApprovalEmail(data: {
  guestName: string;
  hostName: string;
  eventTitle: string;
  dateStr: string;
  timeStr: string;
  durationMins: number;
  calendarSynced?: boolean;
  locationType?: string;
  locationUrl?: string;
  meetLink?: string;
  cancelUrl?: string;
}): string {
  const locationInfo = resolveLocationDisplay({
    locationType: data.locationType,
    locationUrl: data.locationUrl,
    meetLink: data.meetLink,
  });

  const content = `
    <div style="background-color: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 14px; padding: 20px; margin-bottom: 20px;">
      <div style="margin-bottom: 14px;">
        <span style="font-size: 16px; font-weight: 700; color: #0F172A;">${data.eventTitle}</span>
        <span style="display: inline-block; background-color: #EFF6FF; color: #1D4ED8; font-size: 12px; font-weight: 600; padding: 2px 8px; border-radius: 9999px; margin-left: 6px;">
          ${data.durationMins} mins
        </span>
      </div>

      <table border="0" cellpadding="0" cellspacing="0" width="100%" style="font-size: 14px; color: #334155; line-height: 1.7;">
        <tr>
          <td style="width: 24px; vertical-align: top; padding-bottom: 6px;">📅</td>
          <td style="padding-bottom: 6px;">
            <strong style="color: #0F172A;">When:</strong> ${data.dateStr} at ${data.timeStr}
          </td>
        </tr>
        <tr>
          <td style="width: 24px; vertical-align: top; padding-bottom: 6px;">👤</td>
          <td style="padding-bottom: 6px;">
            <strong style="color: #0F172A;">Host:</strong> ${data.hostName}
          </td>
        </tr>
        ${locationInfo ? `
          <tr>
            <td style="width: 24px; vertical-align: top; padding-bottom: 6px;">📍</td>
            <td style="padding-bottom: 6px;">
              <strong style="color: #0F172A;">${locationInfo.label}:</strong> ${locationInfo.detail}
            </td>
          </tr>
        ` : ""}
      </table>
    </div>
  `;

  const calendarSubtext = data.calendarSynced
    ? `A calendar invitation has been sent to your email and added to your calendar.`
    : `Please mark your calendar for the scheduled time.`;

  return renderBoardUIEmailLayout({
    previewText: `Approved: ${data.eventTitle} with ${data.hostName}`,
    badgeText: "Confirmed",
    badgeVariant: "lime",
    headline: "Your booking is approved!",
    subheadline: `Hi ${data.guestName}, ${data.hostName} has approved your booking request. ${calendarSubtext}`,
    contentHtml: content,
    primaryCta: locationInfo?.ctaUrl ? {
      label: `Join ${locationInfo.label}`,
      url: locationInfo.ctaUrl,
    } : undefined,
    footerLinks: data.cancelUrl ? [
      { label: "Cancel booking", url: data.cancelUrl },
    ] : undefined,
  });
}

/**
 * Guest Booking Rejection Notification Email
 */
export function buildGuestRejectionEmail(data: {
  guestName: string;
  hostName: string;
  eventTitle: string;
  dateStr: string;
  timeStr: string;
  reason?: string;
  bookingUrl?: string;
}): string {
  const content = `
    <div style="background-color: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 14px; padding: 20px; margin-bottom: 20px;">
      <div style="margin-bottom: 14px;">
        <span style="font-size: 16px; font-weight: 700; color: #0F172A;">${data.eventTitle}</span>
      </div>

      <table border="0" cellpadding="0" cellspacing="0" width="100%" style="font-size: 14px; color: #334155; line-height: 1.7;">
        <tr>
          <td style="width: 24px; vertical-align: top; padding-bottom: 6px;">📅</td>
          <td style="padding-bottom: 6px;">
            <strong style="color: #0F172A;">Requested Time:</strong> ${data.dateStr} at ${data.timeStr}
          </td>
        </tr>
        <tr>
          <td style="width: 24px; vertical-align: top; padding-bottom: 6px;">👤</td>
          <td style="padding-bottom: 6px;">
            <strong style="color: #0F172A;">Host:</strong> ${data.hostName}
          </td>
        </tr>
        ${data.reason ? `
          <tr>
            <td style="width: 24px; vertical-align: top; padding-bottom: 6px;">📝</td>
            <td style="padding-bottom: 6px;">
              <strong style="color: #0F172A;">Reason:</strong> ${data.reason}
            </td>
          </tr>
        ` : ""}
      </table>
    </div>
  `;

  return renderBoardUIEmailLayout({
    previewText: `Declined: ${data.eventTitle} with ${data.hostName}`,
    badgeText: "Declined",
    badgeVariant: "destructive",
    headline: "Booking Request Declined",
    subheadline: `Hi ${data.guestName}, unfortunately ${data.hostName} was unable to accept your booking request for ${data.eventTitle}.`,
    contentHtml: content,
    primaryCta: data.bookingUrl ? {
      label: "Choose Another Time",
      url: data.bookingUrl,
    } : undefined,
  });
}


/**
 * HTML escaping utility for email content.
 * Escapes &, <, >, ", and ' to prevent HTML injection/XSS in email clients.
 */
export function escapeHtml(str?: string | null): string {
  if (!str || typeof str !== "string") return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Sanitizes URLs for href attributes in email templates.
 * Restricts to http, https, and mailto schemes, and escapes quotes.
 */
export function sanitizeEmailUrl(url?: string | null): string | undefined {
  if (!url || typeof url !== "string") return undefined;
  const trimmed = url.trim();
  if (/^(https?:\/\/|mailto:)/i.test(trimmed)) {
    return trimmed
      .replace(/"/g, "%22")
      .replace(/'/g, "%27")
      .replace(/</g, "%3C")
      .replace(/>/g, "%3E");
  }
  return undefined;
}

/**
 * Host notification when a guest cancels a booking
 */
export function buildGuestCancellationEmail(data: {
  hostName: string;
  guestName: string;
  guestEmail: string;
  eventTitle: string;
  dateStr: string;
  timeStr: string;
  reason?: string;
  dashboardUrl?: string;
}): string {
  const safeTitle = escapeHtml(data.eventTitle);
  const safeHostName = escapeHtml(data.hostName);
  const safeGuestName = escapeHtml(data.guestName);
  const safeGuestEmail = escapeHtml(data.guestEmail);
  const safeDateStr = escapeHtml(data.dateStr);
  const safeTimeStr = escapeHtml(data.timeStr);
  const safeReason = data.reason ? escapeHtml(data.reason) : undefined;
  const safeDashboardUrl = sanitizeEmailUrl(data.dashboardUrl);

  const content = `
    <div style="background-color: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 14px; padding: 20px; margin-bottom: 20px;">
      <div style="margin-bottom: 14px;">
        <span style="font-size: 16px; font-weight: 700; color: #0F172A;">${safeTitle}</span>
      </div>

      <table border="0" cellpadding="0" cellspacing="0" width="100%" style="font-size: 14px; color: #334155; line-height: 1.7;">
        <tr>
          <td style="width: 24px; vertical-align: top; padding-bottom: 6px;">📅</td>
          <td style="padding-bottom: 6px;">
            <strong style="color: #0F172A;">Scheduled Time:</strong> ${safeDateStr} at ${safeTimeStr}
          </td>
        </tr>
        <tr>
          <td style="width: 24px; vertical-align: top; padding-bottom: 6px;">👤</td>
          <td style="padding-bottom: 6px;">
            <strong style="color: #0F172A;">Guest:</strong> ${safeGuestName} (${safeGuestEmail})
          </td>
        </tr>
        ${safeReason ? `
          <tr>
            <td style="width: 24px; vertical-align: top; padding-bottom: 6px;">📝</td>
            <td style="padding-bottom: 6px;">
              <strong style="color: #0F172A;">Reason:</strong> ${safeReason}
            </td>
          </tr>
        ` : ""}
      </table>
    </div>
  `;

  return renderBoardUIEmailLayout({
    previewText: `Cancelled: ${safeTitle} with ${safeGuestName}`,
    badgeText: "Cancelled",
    badgeVariant: "destructive",
    headline: "Meeting Cancelled by Guest",
    subheadline: `Hi ${safeHostName}, ${safeGuestName} has cancelled their scheduled meeting for ${safeTitle}. The time slot has been released back to your available hours.`,
    contentHtml: content,
    primaryCta: safeDashboardUrl ? {
      label: "View Bookings",
      url: safeDashboardUrl,
    } : undefined,
  });
}

/**
 * Guest notification when a host cancels a booking
 */
export function buildHostCancellationEmail(data: {
  guestName: string;
  hostName: string;
  eventTitle: string;
  dateStr: string;
  timeStr: string;
  reason?: string;
  rebookUrl?: string;
}): string {
  const safeTitle = escapeHtml(data.eventTitle);
  const safeHostName = escapeHtml(data.hostName);
  const safeGuestName = escapeHtml(data.guestName);
  const safeDateStr = escapeHtml(data.dateStr);
  const safeTimeStr = escapeHtml(data.timeStr);
  const safeReason = data.reason ? escapeHtml(data.reason) : undefined;
  const safeRebookUrl = sanitizeEmailUrl(data.rebookUrl);

  const content = `
    <div style="background-color: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 14px; padding: 20px; margin-bottom: 20px;">
      <div style="margin-bottom: 14px;">
        <span style="font-size: 16px; font-weight: 700; color: #0F172A;">${safeTitle}</span>
      </div>

      <table border="0" cellpadding="0" cellspacing="0" width="100%" style="font-size: 14px; color: #334155; line-height: 1.7;">
        <tr>
          <td style="width: 24px; vertical-align: top; padding-bottom: 6px;">📅</td>
          <td style="padding-bottom: 6px;">
            <strong style="color: #0F172A;">Scheduled Time:</strong> ${safeDateStr} at ${safeTimeStr}
          </td>
        </tr>
        <tr>
          <td style="width: 24px; vertical-align: top; padding-bottom: 6px;">👤</td>
          <td style="padding-bottom: 6px;">
            <strong style="color: #0F172A;">Host:</strong> ${safeHostName}
          </td>
        </tr>
        ${safeReason ? `
          <tr>
            <td style="width: 24px; vertical-align: top; padding-bottom: 6px;">📝</td>
            <td style="padding-bottom: 6px;">
              <strong style="color: #0F172A;">Reason:</strong> ${safeReason}
            </td>
          </tr>
        ` : ""}
      </table>
    </div>
  `;

  return renderBoardUIEmailLayout({
    previewText: `Cancelled: ${safeTitle} with ${safeHostName}`,
    badgeText: "Cancelled",
    badgeVariant: "destructive",
    headline: "Meeting Cancelled by Host",
    subheadline: `Hi ${safeGuestName}, your meeting for ${safeTitle} with ${safeHostName} has been cancelled.`,
    contentHtml: content,
    primaryCta: safeRebookUrl ? {
      label: "Schedule Another Time",
      url: safeRebookUrl,
    } : undefined,
  });
}
