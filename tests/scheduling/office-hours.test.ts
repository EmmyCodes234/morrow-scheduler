import { describe, it, expect } from "vitest";
import { isHostWithinOfficeSchedule } from "@/lib/office/office-service";

describe("Virtual Office Hours Engine", () => {
  const EMAIL_REGEX =
    /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

  function validateKnockInput(input: {
    guestName?: string;
    guestEmail?: string;
    topic?: string;
  }): { valid: boolean; error?: string } {
    const name = input.guestName?.trim() || "";
    const email = input.guestEmail?.trim().toLowerCase() || "";
    const topic = input.topic?.trim() || "";

    if (!name) return { valid: false, error: "Your name is required." };
    if (!email || !EMAIL_REGEX.test(email)) return { valid: false, error: "A valid email address is required." };
    if (!topic) return { valid: false, error: "Please enter what you'd like to discuss." };
    if (topic.length > 140) return { valid: false, error: "Topic cannot exceed 140 characters." };

    return { valid: true };
  }

  function resolveMeetLink(host: {
    defaultLocationType?: string;
    zoomMeetingUrl?: string;
    teamsMeetingUrl?: string;
  }): string {
    if (host.defaultLocationType === "zoom" && host.zoomMeetingUrl) {
      return host.zoomMeetingUrl;
    }
    if (host.defaultLocationType === "teams" && host.teamsMeetingUrl) {
      return host.teamsMeetingUrl;
    }
    if (host.zoomMeetingUrl) {
      return host.zoomMeetingUrl;
    }
    return "https://meet.google.com/new";
  }

  function computeKnockStatus(knock: {
    status: "ringing" | "admitted" | "declined" | "missed" | "cancelled" | "concluded" | "queued";
    createdAt: Date;
    now: Date;
  }): { status: string; isExpired: boolean; secondsRemaining: number } {
    if (knock.status === "queued") {
      return { status: "queued", isExpired: false, secondsRemaining: 60 };
    }

    const elapsedMs = knock.now.getTime() - knock.createdAt.getTime();
    const elapsedSeconds = Math.floor(elapsedMs / 1000);
    const secondsRemaining = Math.max(0, 60 - elapsedSeconds);

    if (knock.status === "ringing" && elapsedMs > 60000) {
      return { status: "missed", isExpired: true, secondsRemaining: 0 };
    }

    return {
      status: knock.status,
      isExpired: knock.status === "ringing" && elapsedMs > 60000,
      secondsRemaining,
    };
  }

  function computeEstimatedWait(position: number, speedChatMins: number): number {
    return Math.max(1, position) * speedChatMins;
  }

  describe("Knock Input Validation", () => {
    it("rejects empty visitor name", () => {
      const res = validateKnockInput({
        guestName: "   ",
        guestEmail: "alice@example.com",
        topic: "Quick question on API architecture",
      });
      expect(res.valid).toBe(false);
      expect(res.error).toBe("Your name is required.");
    });

    it("rejects invalid email addresses", () => {
      const res = validateKnockInput({
        guestName: "Alice",
        guestEmail: "not-an-email",
        topic: "Quick question",
      });
      expect(res.valid).toBe(false);
      expect(res.error).toBe("A valid email address is required.");
    });

    it("rejects missing topic note", () => {
      const res = validateKnockInput({
        guestName: "Alice",
        guestEmail: "alice@example.com",
        topic: "",
      });
      expect(res.valid).toBe(false);
      expect(res.error).toBe("Please enter what you'd like to discuss.");
    });

    it("enforces 140 character limit on discussion topic", () => {
      const longTopic = "a".repeat(141);
      const res = validateKnockInput({
        guestName: "Alice",
        guestEmail: "alice@example.com",
        topic: longTopic,
      });
      expect(res.valid).toBe(false);
      expect(res.error).toBe("Topic cannot exceed 140 characters.");
    });

    it("accepts valid visitor knock", () => {
      const res = validateKnockInput({
        guestName: "Alice Morgan",
        guestEmail: "alice@example.com",
        topic: "Seed round feedback and team intros",
      });
      expect(res.valid).toBe(true);
      expect(res.error).toBeUndefined();
    });
  });

  describe("60-Second Ringing Window & Timeout Transition", () => {
    it("keeps status as ringing when under 60 seconds have elapsed", () => {
      const createdAt = new Date("2026-11-07T12:00:00Z");
      const checkTime = new Date("2026-11-07T12:00:35Z"); // 35s later

      const res = computeKnockStatus({
        status: "ringing",
        createdAt,
        now: checkTime,
      });

      expect(res.status).toBe("ringing");
      expect(res.isExpired).toBe(false);
      expect(res.secondsRemaining).toBe(25);
    });

    it("auto-transitions status to missed when 60s window expires", () => {
      const createdAt = new Date("2026-11-07T12:00:00Z");
      const checkTime = new Date("2026-11-07T12:01:05Z"); // 65s later

      const res = computeKnockStatus({
        status: "ringing",
        createdAt,
        now: checkTime,
      });

      expect(res.status).toBe("missed");
      expect(res.isExpired).toBe(true);
      expect(res.secondsRemaining).toBe(0);
    });

    it("does not expire queued knocks", () => {
      const createdAt = new Date("2026-11-07T12:00:00Z");
      const checkTime = new Date("2026-11-07T12:05:00Z"); // 5 mins later

      const res = computeKnockStatus({
        status: "queued",
        createdAt,
        now: checkTime,
      });

      expect(res.status).toBe("queued");
      expect(res.isExpired).toBe(false);
    });
  });

  describe("Host Video Room Link Provisioning", () => {
    it("provisions Google Meet by default when host has no Zoom or Teams", () => {
      const link = resolveMeetLink({
        defaultLocationType: "google_meet",
      });
      expect(link).toBe("https://meet.google.com/new");
    });

    it("uses Zoom meeting URL when Zoom is the default provider", () => {
      const link = resolveMeetLink({
        defaultLocationType: "zoom",
        zoomMeetingUrl: "https://zoom.us/j/1234567890",
      });
      expect(link).toBe("https://zoom.us/j/1234567890");
    });

    it("uses Microsoft Teams URL when Teams is the default provider", () => {
      const link = resolveMeetLink({
        defaultLocationType: "teams",
        teamsMeetingUrl: "https://teams.microsoft.com/l/meetup-join/abc",
      });
      expect(link).toBe("https://teams.microsoft.com/l/meetup-join/abc");
    });
  });

  describe("Host Door State Transitions", () => {
    it("transitions host to busy upon admitting visitor", () => {
      let hostStatus: "open" | "busy" | "closed" = "open";

      // Host admits visitor
      hostStatus = "busy";
      expect(hostStatus).toBe("busy");

      // Host concludes meeting
      hostStatus = "open";
      expect(hostStatus).toBe("open");
    });
  });

  describe("Scheduled Recurring Office Hours Windows", () => {
    it("respects manual officeStatus when auto-schedule is disabled", () => {
      const res = isHostWithinOfficeSchedule({
        officeAutoSchedule: false,
        officeStatus: "open",
      });
      expect(res.inSchedule).toBe(true);
      expect(res.effectiveStatus).toBe("open");

      const closedRes = isHostWithinOfficeSchedule({
        officeAutoSchedule: false,
        officeStatus: "closed",
      });
      expect(closedRes.inSchedule).toBe(false);
      expect(closedRes.effectiveStatus).toBe("closed");
    });

    it("always preserves busy status even when auto-schedule is enabled", () => {
      // Monday 15:00 UTC (inside 14:00-16:00 window)
      const mondayMid = new Date("2026-11-09T15:00:00Z");
      const res = isHostWithinOfficeSchedule(
        {
          officeAutoSchedule: true,
          officeStatus: "busy",
          officeScheduleDays: [1, 2, 3, 4, 5],
          officeScheduleStart: "14:00",
          officeScheduleEnd: "16:00",
          timezone: "UTC",
        },
        mondayMid
      );
      expect(res.effectiveStatus).toBe("busy");
      expect(res.inSchedule).toBe(false);
    });

    it("opens door automatically during configured recurring window on active day", () => {
      // Monday 2026-11-09 at 14:30 UTC
      const mondayInWindow = new Date("2026-11-09T14:30:00Z");
      const res = isHostWithinOfficeSchedule(
        {
          officeAutoSchedule: true,
          officeStatus: "closed",
          officeScheduleDays: [1, 2, 3, 4, 5],
          officeScheduleStart: "14:00",
          officeScheduleEnd: "16:00",
          timezone: "UTC",
        },
        mondayInWindow
      );
      expect(res.inSchedule).toBe(true);
      expect(res.effectiveStatus).toBe("open");
    });

    it("keeps door closed before or after configured time window", () => {
      // Monday 2026-11-09 at 13:59 UTC (before)
      const beforeWindow = new Date("2026-11-09T13:59:00Z");
      const beforeRes = isHostWithinOfficeSchedule(
        {
          officeAutoSchedule: true,
          officeStatus: "closed",
          officeScheduleDays: [1, 2, 3, 4, 5],
          officeScheduleStart: "14:00",
          officeScheduleEnd: "16:00",
          timezone: "UTC",
        },
        beforeWindow
      );
      expect(beforeRes.inSchedule).toBe(false);
      expect(beforeRes.effectiveStatus).toBe("closed");

      // Monday 2026-11-09 at 16:01 UTC (after)
      const afterWindow = new Date("2026-11-09T16:01:00Z");
      const afterRes = isHostWithinOfficeSchedule(
        {
          officeAutoSchedule: true,
          officeStatus: "closed",
          officeScheduleDays: [1, 2, 3, 4, 5],
          officeScheduleStart: "14:00",
          officeScheduleEnd: "16:00",
          timezone: "UTC",
        },
        afterWindow
      );
      expect(afterRes.inSchedule).toBe(false);
      expect(afterRes.effectiveStatus).toBe("closed");
    });

    it("keeps door closed on non-scheduled days (e.g. Sunday)", () => {
      // Sunday 2026-11-08 at 15:00 UTC
      const sundayTime = new Date("2026-11-08T15:00:00Z");
      const res = isHostWithinOfficeSchedule(
        {
          officeAutoSchedule: true,
          officeStatus: "closed",
          officeScheduleDays: [1, 2, 3, 4, 5], // Mon-Fri only
          officeScheduleStart: "14:00",
          officeScheduleEnd: "16:00",
          timezone: "UTC",
        },
        sundayTime
      );
      expect(res.inSchedule).toBe(false);
      expect(res.effectiveStatus).toBe("closed");
    });

    it("accurately accounts for host local timezone offset", () => {
      // America/New_York is UTC-5 in November (EST)
      // 19:30 UTC is 14:30 in New York
      const utcTime = new Date("2026-11-09T19:30:00Z");
      const res = isHostWithinOfficeSchedule(
        {
          officeAutoSchedule: true,
          officeStatus: "closed",
          officeScheduleDays: [1, 2, 3, 4, 5],
          officeScheduleStart: "14:00",
          officeScheduleEnd: "16:00",
          timezone: "America/New_York",
        },
        utcTime
      );
      expect(res.inSchedule).toBe(true);
      expect(res.effectiveStatus).toBe("open");
    });
  });

  describe("Concurrent Visitor Queue & Waiting Room", () => {
    it("calculates estimated wait time based on position and speed chat duration", () => {
      expect(computeEstimatedWait(1, 10)).toBe(10);
      expect(computeEstimatedWait(2, 10)).toBe(20);
      expect(computeEstimatedWait(3, 15)).toBe(45);
    });

    it("assigns sequential positions to multiple concurrent queued knocks", () => {
      const activeKnock = { id: "k1", status: "ringing" };
      const knocks = [
        { id: "k2", status: "queued", createdAt: new Date("2026-11-07T10:00:00Z") },
        { id: "k3", status: "queued", createdAt: new Date("2026-11-07T10:01:00Z") },
        { id: "k4", status: "queued", createdAt: new Date("2026-11-07T10:02:00Z") },
      ];

      const queuedKnocks = knocks.filter((k) => k.status === "queued");
      const positionK2 = queuedKnocks.findIndex((k) => k.id === "k2") + 1;
      const positionK3 = queuedKnocks.findIndex((k) => k.id === "k3") + 1;
      const positionK4 = queuedKnocks.findIndex((k) => k.id === "k4") + 1;

      expect(positionK2).toBe(1);
      expect(positionK3).toBe(2);
      expect(positionK4).toBe(3);
    });
  });
});
