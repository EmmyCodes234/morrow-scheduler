/**
 * Calendar export helpers for 1-click Google Calendar and native iCalendar (.ics) downloads.
 */

export function formatCalendarUtcDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

export function createGoogleCalendarUrl(event: {
  title: string;
  description?: string | null;
  location?: string | null;
  startTime: Date;
  endTime: Date;
}): string {
  const dates = `${formatCalendarUtcDate(event.startTime)}/${formatCalendarUtcDate(event.endTime)}`;
  const url = new URL("https://calendar.google.com/calendar/render");
  url.searchParams.set("action", "TEMPLATE");
  url.searchParams.set("text", event.title);
  url.searchParams.set("dates", dates);

  const detailsParts: string[] = [];
  if (event.description) detailsParts.push(event.description);
  if (event.location) detailsParts.push(`Join Meeting: ${event.location}`);
  if (detailsParts.length > 0) {
    url.searchParams.set("details", detailsParts.join("\n\n"));
  }

  if (event.location) {
    url.searchParams.set("location", event.location);
  }

  return url.toString();
}

export function generateIcsContent(event: {
  id: string;
  title: string;
  description?: string | null;
  location?: string | null;
  startTime: Date;
  endTime: Date;
  organizerName?: string;
  organizerEmail?: string;
}): string {
  const uid = `${event.id}@usemorrow.xyz`;
  const dtStamp = formatCalendarUtcDate(new Date());
  const dtStart = formatCalendarUtcDate(event.startTime);
  const dtEnd = formatCalendarUtcDate(event.endTime);

  const cleanText = (str?: string | null) =>
    (str || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Morrow//Morrow Scheduler//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${dtStamp}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${cleanText(event.title)}`,
  ];

  if (event.description) {
    lines.push(`DESCRIPTION:${cleanText(event.description)}`);
  }
  if (event.location) {
    lines.push(`LOCATION:${cleanText(event.location)}`);
  }
  if (event.organizerName && event.organizerEmail) {
    lines.push(`ORGANIZER;CN=${cleanText(event.organizerName)}:mailto:${event.organizerEmail}`);
  }

  lines.push("STATUS:CONFIRMED", "END:VEVENT", "END:VCALENDAR");

  return lines.join("\r\n");
}

export function downloadIcsFile(filename: string, content: string): void {
  if (typeof window === "undefined") return;
  const blob = new Blob([content], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".ics") ? filename : `${filename}.ics`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
