import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  generateVeraPreMeetingBrief,
  generateVeraLedger,
  validateVeraLedger,
  VeraError,
  VeraTimeoutError,
  VeraValidationError,
  DEEPSEEK_TIMEOUT_MS,
} from "@/lib/intelligence/vera";

describe("Vera Intelligence Engine — Truthful Failure Handling & Structured Validation", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  // =========================================================================
  // 1. Pre-Meeting Brief Fallback Preservation
  // =========================================================================
  describe("Pre-Meeting Brief Fallback", () => {
    it("generates a structured fallback brief without throwing when credentials or API fail", async () => {
      delete process.env.DEEPSEEK_API_KEY;

      const brief = await generateVeraPreMeetingBrief({
        eventTitle: "Strategy Consultation",
        hostName: "Emmanuel",
        guestName: "Alex",
        guestNotes: "Looking to review pricing plans.",
      });

      expect(brief).toBeDefined();
      expect(brief.intent).toBe("Discussion on Strategy Consultation");
      expect(Array.isArray(brief.suggestedAgenda)).toBe(true);
      expect(brief.suggestedAgenda.length).toBe(3);
      expect(brief.suggestedAgenda[0].addedBy).toBe("vera");
    });
  });

  // =========================================================================
  // 2. Truthful Failure Handling — No Fabricated Ledgers
  // =========================================================================
  describe("Post-Meeting Synthesis Truthful Failures", () => {
    it("throws VeraError with code MISSING_CREDENTIALS when DEEPSEEK_API_KEY is unset (never fabricates ledger)", async () => {
      delete process.env.DEEPSEEK_API_KEY;

      await expect(
        generateVeraLedger({
          eventTitle: "Engineering Alignment",
          hostName: "Emmanuel",
          guestName: "Alex",
          agenda: [{ id: "1", text: "Timeline agreement", done: true, addedBy: "host" }],
          sharedNotes: "Agreed to ship on Friday.",
        })
      ).rejects.toThrowError(VeraError);

      try {
        await generateVeraLedger({
          eventTitle: "Engineering Alignment",
          hostName: "Emmanuel",
          guestName: "Alex",
          agenda: [],
        });
      } catch (err: any) {
        expect(err.code).toBe("MISSING_CREDENTIALS");
        expect(err.statusCode).toBe(500);
      }
    });

    it("aborts and throws VeraTimeoutError when request times out", async () => {
      process.env.DEEPSEEK_API_KEY = "test-fake-key";

      // Mock fetch to simulate an AbortError when signal triggers
      vi.spyOn(globalThis, "fetch").mockImplementation((_url, options: any) => {
        return new Promise((_, reject) => {
          if (options?.signal) {
            options.signal.addEventListener("abort", () => {
              const abortErr = new Error("This operation was aborted");
              abortErr.name = "AbortError";
              reject(abortErr);
            });
          }
        });
      });

      // Pass a very small timeout for deterministic unit test
      await expect(
        generateVeraLedger({
          eventTitle: "Timeout Test Call",
          hostName: "Emmanuel",
          guestName: "Alex",
          agenda: [],
          timeoutMs: 10,
        })
      ).rejects.toThrowError(VeraTimeoutError);

      try {
        await generateVeraLedger({
          eventTitle: "Timeout Test Call",
          hostName: "Emmanuel",
          guestName: "Alex",
          agenda: [],
          timeoutMs: 10,
        });
      } catch (err: any) {
        expect(err.code).toBe("TIMEOUT");
        expect(err.statusCode).toBe(504);
        expect(err.message).toContain("timed out after 10ms");
      }
    });

    it("throws VeraError with PROVIDER_ERROR when DeepSeek returns HTTP 500 or 429", async () => {
      process.env.DEEPSEEK_API_KEY = "test-fake-key";

      vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: false,
        status: 429,
        text: async () => "Rate limit exceeded. Please wait.",
      } as any);

      await expect(
        generateVeraLedger({
          eventTitle: "Rate Limit Test",
          hostName: "Emmanuel",
          guestName: "Alex",
          agenda: [],
        })
      ).rejects.toThrowError(VeraError);

      try {
        await generateVeraLedger({
          eventTitle: "Rate Limit Test",
          hostName: "Emmanuel",
          guestName: "Alex",
          agenda: [],
        });
      } catch (err: any) {
        expect(err.code).toBe("PROVIDER_ERROR");
        expect(err.statusCode).toBe(429);
        expect(err.message).toContain("429");
      }
    });

    it("throws VeraError with INVALID_JSON when DeepSeek returns non-parseable output", async () => {
      process.env.DEEPSEEK_API_KEY = "test-fake-key";

      vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "Not a JSON { [ broken" } }],
        }),
      } as any);

      await expect(
        generateVeraLedger({
          eventTitle: "Malformed Test",
          hostName: "Emmanuel",
          guestName: "Alex",
          agenda: [],
        })
      ).rejects.toThrowError(VeraError);

      try {
        await generateVeraLedger({
          eventTitle: "Malformed Test",
          hostName: "Emmanuel",
          guestName: "Alex",
          agenda: [],
        });
      } catch (err: any) {
        expect(err.code).toBe("INVALID_JSON");
      }
    });

    it("throws VeraError with EMPTY_RESPONSE when DeepSeek returns null content", async () => {
      process.env.DEEPSEEK_API_KEY = "test-fake-key";

      vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "" } }],
        }),
      } as any);

      await expect(
        generateVeraLedger({
          eventTitle: "Empty Content Test",
          hostName: "Emmanuel",
          guestName: "Alex",
          agenda: [],
        })
      ).rejects.toThrowError(VeraError);
    });
  });

  // =========================================================================
  // 3. Structured Output Validation & Grounding
  // =========================================================================
  describe("Structured Output Validation & Participant Grounding", () => {
    const context = { hostName: "Emmanuel Enyi", guestName: "Sarah Connor" };

    it("rejects output when executiveSummary is missing or empty array", () => {
      expect(() =>
        validateVeraLedger(
          {
            executiveSummary: [],
            keyDecisions: ["Decision 1"],
            actionItems: [],
          },
          context
        )
      ).toThrowError(VeraValidationError);

      expect(() =>
        validateVeraLedger(
          {
            executiveSummary: ["Valid sentence", ""],
            keyDecisions: [],
            actionItems: [],
          },
          context
        )
      ).toThrowError(VeraValidationError);
    });

    it("rejects output when action item task is missing or blank (never invents generic task)", () => {
      expect(() =>
        validateVeraLedger(
          {
            executiveSummary: ["Met and discussed roadmap."],
            keyDecisions: [],
            actionItems: [{ task: "   ", assignee: "Emmanuel Enyi" }],
          },
          context
        )
      ).toThrowError(VeraValidationError);
    });

    it("preserves unassigned action items as 'Unassigned' without defaulting to the host", () => {
      const validated = validateVeraLedger(
        {
          executiveSummary: ["Discussion completed successfully."],
          keyDecisions: ["Proceed with alpha trial."],
          actionItems: [
            {
              task: "Prepare test credentials",
              assignee: "", // Unspecified
              priority: "high",
            },
            {
              task: "Verify security protocol",
              assignee: "Unassigned",
              priority: "medium",
            },
          ],
        },
        context
      );

      expect(validated.actionItems[0].assignee).toBe("Unassigned");
      expect(validated.actionItems[0].assignee).not.toBe(context.hostName);
      expect(validated.actionItems[1].assignee).toBe("Unassigned");
    });

    it("grounds specified assignees accurately to known participants", () => {
      const validated = validateVeraLedger(
        {
          executiveSummary: ["Aligned on requirements."],
          keyDecisions: ["Confirmed Q1 launch."],
          actionItems: [
            {
              task: "Deploy staging server",
              assignee: "emmanuel",
              priority: "high",
            },
            {
              task: "Provide brand assets",
              assignee: "Sarah Connor",
              priority: "low",
            },
          ],
        },
        context
      );

      expect(validated.actionItems[0].assignee).toBe("Emmanuel Enyi");
      expect(validated.actionItems[1].assignee).toBe("Sarah Connor");
    });

    it("retains explicitly mentioned deadlines and leaves missing deadlines undefined (never invents dates)", () => {
      const validated = validateVeraLedger(
        {
          executiveSummary: ["Sprint planning finalized."],
          keyDecisions: ["Freeze code by Friday."],
          actionItems: [
            {
              task: "Submit PR",
              assignee: "Emmanuel Enyi",
              priority: "high",
              deadline: "2026-11-08",
            },
            {
              task: "Review documentation",
              assignee: "Sarah Connor",
              priority: "medium",
              // deadline omitted
            },
          ],
        },
        context
      );

      expect(validated.actionItems[0].deadline).toBe("2026-11-08");
      expect(validated.actionItems[1].deadline).toBeUndefined();
    });

    it("successfully generates and returns validated VeraLedger when DeepSeek responds correctly", async () => {
      process.env.DEEPSEEK_API_KEY = "test-fake-key";

      vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  executiveSummary: [
                    "Emmanuel Enyi and Sarah Connor held an architectural alignment call.",
                    "Key focus was on establishing atomic database-level leasing.",
                  ],
                  keyDecisions: ["Approved 60s synthesis lease with 25s timeout fence."],
                  actionItems: [
                    {
                      task: "Ship integration tests for database injection",
                      assignee: "Emmanuel Enyi",
                      priority: "high",
                    },
                  ],
                  suggestedFollowUp: "Review integration test coverage on Thursday.",
                }),
              },
            },
          ],
        }),
      } as any);

      const ledger = await generateVeraLedger({
        eventTitle: "Architecture Alignment",
        hostName: "Emmanuel Enyi",
        guestName: "Sarah Connor",
        agenda: [{ id: "1", text: "Architecture review", done: true, addedBy: "host" }],
        sharedNotes: "Agreed to ship database injection.",
      });

      expect(ledger.executiveSummary).toHaveLength(2);
      expect(ledger.keyDecisions).toHaveLength(1);
      expect(ledger.actionItems).toHaveLength(1);
      expect(ledger.actionItems[0].task).toBe("Ship integration tests for database injection");
      expect(ledger.actionItems[0].assignee).toBe("Emmanuel Enyi");
      expect(ledger.actionItems[0].priority).toBe("high");
      expect(ledger.suggestedFollowUp).toBe("Review integration test coverage on Thursday.");
    });
  });
});
