import { describe, it, expect } from "vitest";
import { generateVeraPreMeetingBrief, generateVeraLedger } from "@/lib/intelligence/vera";

describe("Vera Intelligence Engine", () => {
  it(
    "generates a structured pre-meeting brief and agenda fallback gracefully",
    async () => {
      const brief = await generateVeraPreMeetingBrief({
        eventTitle: "Strategy Consultation",
        hostName: "Emmanuel",
        guestName: "Alex",
        guestNotes: "Looking to review pricing plans.",
      });

      expect(brief).toBeDefined();
      expect(brief.intent).toBeDefined();
      expect(Array.isArray(brief.suggestedAgenda)).toBe(true);
      expect(brief.suggestedAgenda.length).toBeGreaterThanOrEqual(1);
      expect(brief.suggestedAgenda[0].addedBy).toBe("vera");
    },
    15000
  );

  it(
    "synthesizes ledger with decisions and action items",
    async () => {
      const ledger = await generateVeraLedger({
        eventTitle: "Engineering Alignment",
        hostName: "Emmanuel",
        guestName: "Alex",
        agenda: [
          { id: "1", text: "Architecture review", done: true, addedBy: "vera" },
          { id: "2", text: "Timeline agreement", done: true, addedBy: "host" },
        ],
        sharedNotes: "Agreed to ship on Friday. Alex will write test fixtures.",
        transcript: "Emmanuel: Let's ship Friday. Alex: I will provide the test fixtures by Thursday.",
      });

      expect(ledger).toBeDefined();
      expect(Array.isArray(ledger.executiveSummary)).toBe(true);
      expect(Array.isArray(ledger.actionItems)).toBe(true);
      expect(ledger.actionItems.length).toBeGreaterThanOrEqual(1);
      expect(ledger.actionItems[0].assignee).toBeDefined();
    },
    15000
  );
});
