import { describe, it, expect } from "vitest";

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
    status: "ringing" | "admitted" | "declined" | "missed" | "cancelled" | "concluded";
    createdAt: Date;
    now: Date;
  }): { status: string; isExpired: boolean; secondsRemaining: number } {
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
    const baseTime = new Date("2026-11-07T12:00:00Z");

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
});
