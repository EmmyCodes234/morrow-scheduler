import { describe, it, expect } from "vitest";
import {
  formatCalendarUtcDate,
  createGoogleCalendarUrl,
  generateIcsContent,
} from "@/lib/scheduling/calendar-export";

describe("Calendar Export Engine", () => {
  const startTime = new Date("2026-11-15T14:00:00Z");
  const endTime = new Date("2026-11-15T15:00:00Z");

  it("formats Date objects into UTC iCalendar format (YYYYMMDDTHHMMSSZ)", () => {
    const formatted = formatCalendarUtcDate(startTime);
    expect(formatted).toBe("20261115T140000Z");
  });

  it("constructs accurate 1-click Google Calendar web creation URL", () => {
    const urlStr = createGoogleCalendarUrl({
      title: "Quarterly Strategy Review",
      description: "Review product roadmap and team growth targets.",
      location: "https://meet.google.com/abc-defg-hij",
      startTime,
      endTime,
    });

    const parsed = new URL(urlStr);
    expect(parsed.hostname).toBe("calendar.google.com");
    expect(parsed.searchParams.get("action")).toBe("TEMPLATE");
    expect(parsed.searchParams.get("text")).toBe("Quarterly Strategy Review");
    expect(parsed.searchParams.get("dates")).toBe("20261115T140000Z/20261115T150000Z");
    expect(parsed.searchParams.get("details")).toContain("Review product roadmap");
    expect(parsed.searchParams.get("location")).toBe("https://meet.google.com/abc-defg-hij");
  });

  it("generates valid iCalendar (.ics) structure with compliant line endings", () => {
    const ics = generateIcsContent({
      id: "meeting-12345",
      title: "Product All-Hands",
      description: "Company quarterly sync",
      location: "https://zoom.us/j/987654321",
      startTime,
      endTime,
      organizerName: "Enyi Emmanuel",
      organizerEmail: "enyi@usemorrow.xyz",
    });

    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("VERSION:2.0");
    expect(ics).toContain("UID:meeting-12345@usemorrow.xyz");
    expect(ics).toContain("SUMMARY:Product All-Hands");
    expect(ics).toContain("DTSTART:20261115T140000Z");
    expect(ics).toContain("DTEND:20261115T150000Z");
    expect(ics).toContain("LOCATION:https://zoom.us/j/987654321");
    expect(ics).toContain("ORGANIZER;CN=Enyi Emmanuel:mailto:enyi@usemorrow.xyz");
    expect(ics).toContain("END:VEVENT");
    expect(ics).toContain("END:VCALENDAR");
  });
});

describe("Dashboard Analytics Engine", () => {
  interface MockBooking {
    id: string;
    eventTitle: string;
    date: string;
    status: string;
    duration?: number;
    isGroup?: boolean;
    maxAttendees?: number;
  }

  function computeMetrics(bookings: MockBooking[]) {
    const totalBookings = bookings.length;
    const confirmedCount = bookings.filter((b) => b.status === "Confirmed").length;
    const completedCount = bookings.filter((b) => b.status === "Completed").length;
    const cancelledCount = bookings.filter((b) => b.status === "Cancelled").length;

    const cancellationRate = totalBookings > 0 ? Math.round((cancelledCount / totalBookings) * 100) : 0;
    const attendanceRate = totalBookings > 0 ? 100 - cancellationRate : 100;

    const groupBookingsCount = bookings.filter(
      (b) => b.isGroup || (b.maxAttendees && b.maxAttendees > 1)
    ).length;
    const oneOnOneCount = totalBookings - groupBookingsCount;

    const totalMinutes = bookings.reduce((acc, curr) => {
      if (curr.status === "Cancelled") return acc;
      return acc + (curr.duration || 30);
    }, 0);

    return {
      totalBookings,
      confirmedCount,
      completedCount,
      cancelledCount,
      cancellationRate,
      attendanceRate,
      groupBookingsCount,
      oneOnOneCount,
      totalHours: (totalMinutes / 60).toFixed(1),
    };
  }

  it("calculates accurate attendance, cancellation, and hours metrics", () => {
    const sampleBookings: MockBooking[] = [
      { id: "1", eventTitle: "30 Min Call", date: "2026-11-01", status: "Completed", duration: 30 },
      { id: "2", eventTitle: "60 Min Strategy", date: "2026-11-02", status: "Confirmed", duration: 60 },
      { id: "3", eventTitle: "Group Workshop", date: "2026-11-03", status: "Confirmed", duration: 90, isGroup: true, maxAttendees: 10 },
      { id: "4", eventTitle: "30 Min Call", date: "2026-11-04", status: "Cancelled", duration: 30 },
    ];

    const metrics = computeMetrics(sampleBookings);

    expect(metrics.totalBookings).toBe(4);
    expect(metrics.confirmedCount).toBe(2);
    expect(metrics.completedCount).toBe(1);
    expect(metrics.cancelledCount).toBe(1);
    expect(metrics.cancellationRate).toBe(25); // 1 out of 4
    expect(metrics.attendanceRate).toBe(75);
    expect(metrics.groupBookingsCount).toBe(1);
    expect(metrics.oneOnOneCount).toBe(3);
    expect(metrics.totalHours).toBe("3.0"); // 30 + 60 + 90 = 180 mins = 3.0 hrs
  });

  it("computes 100% attendance rate when there are zero cancellations", () => {
    const bookings: MockBooking[] = [
      { id: "1", eventTitle: "Call", date: "2026-11-01", status: "Confirmed", duration: 30 },
      { id: "2", eventTitle: "Call", date: "2026-11-02", status: "Completed", duration: 30 },
    ];

    const metrics = computeMetrics(bookings);
    expect(metrics.cancellationRate).toBe(0);
    expect(metrics.attendanceRate).toBe(100);
  });
});
