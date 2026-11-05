import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  generateVeraPreMeetingBrief,
  generateVeraLedger,
  validateVeraLedger,
  isSubstantiveEvidence,
  extractSubstantiveEvidence,
  evidenceOccursInSource,
  resolveParticipantAssignee,
  VeraError,
  VeraTimeoutError,
  VeraValidationError,
  VeraInsufficientEvidenceError,
  DEEPSEEK_TIMEOUT_MS,
} from "@/lib/intelligence/vera";

describe("Vera Intelligence Engine — Evidence-Bound Synthesis & Participant Grounding", () => {
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
  // 1. Evidence Sufficiency Gate
  // =========================================================================
  describe("Evidence Sufficiency Gate", () => {
    it("rejects synthesis before calling fetch when notes and transcript are missing or empty", async () => {
      process.env.DEEPSEEK_API_KEY = "test-fake-key";
      const fetchSpy = vi.spyOn(globalThis, "fetch");

      await expect(
        generateVeraLedger({
          eventTitle: "Consultation Call",
          hostName: "Emmanuel Enyi",
          guestName: "Sarah Connor",
          agenda: [{ id: "1", text: "Product Roadmap", done: true, addedBy: "host" }],
          sharedNotes: "",
          transcript: "",
        })
      ).rejects.toThrowError(VeraInsufficientEvidenceError);

      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("rejects synthesis when notes contain only whitespace or trivial fragments", async () => {
      process.env.DEEPSEEK_API_KEY = "test-fake-key";
      const fetchSpy = vi.spyOn(globalThis, "fetch");

      await expect(
        generateVeraLedger({
          eventTitle: "Consultation Call",
          hostName: "Emmanuel Enyi",
          guestName: "Sarah Connor",
          agenda: [],
          sharedNotes: "   \n\t  ",
          transcript: "hello", // < 15 chars
        })
      ).rejects.toThrowError(VeraInsufficientEvidenceError);

      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("rejects synthesis when context is agenda-only even if checkboxes are marked done", async () => {
      process.env.DEEPSEEK_API_KEY = "test-fake-key";
      const fetchSpy = vi.spyOn(globalThis, "fetch");

      await expect(
        generateVeraLedger({
          eventTitle: "Sprint Review",
          hostName: "Emmanuel Enyi",
          guestName: "Sarah Connor",
          agenda: [
            { id: "1", text: "Architecture review", done: true, addedBy: "host" },
            { id: "2", text: "Security signoff", done: true, addedBy: "host" },
          ],
        })
      ).rejects.toThrowError(VeraInsufficientEvidenceError);

      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("rejects synthesis when text contains only known placeholder boilerplate", async () => {
      process.env.DEEPSEEK_API_KEY = "test-fake-key";
      const fetchSpy = vi.spyOn(globalThis, "fetch");

      await expect(
        generateVeraLedger({
          eventTitle: "Consultation Call",
          hostName: "Emmanuel Enyi",
          guestName: "Sarah Connor",
          agenda: [{ id: "1", text: "Introductions", done: true, addedBy: "host" }],
          sharedNotes: "No manual notes taken",
          transcript: "Conversation completed as outlined in notes and agenda.",
        })
      ).rejects.toThrowError(VeraInsufficientEvidenceError);

      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("allows synthesis to proceed when genuine substantive notes are provided", async () => {
      process.env.DEEPSEEK_API_KEY = "test-fake-key";

      const validNotes = "Emmanuel and Sarah agreed to launch the beta trial next Friday, November 14th.";

      vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  executiveSummary: [
                    "Emmanuel and Sarah agreed to launch the beta trial next Friday.",
                  ],
                  keyDecisions: [
                    {
                      decision: "Launch beta trial on November 14th",
                      evidence: "agreed to launch the beta trial next Friday, November 14th",
                    },
                  ],
                  actionItems: [
                    {
                      task: "Launch the beta trial",
                      assignee: "Emmanuel Enyi",
                      priority: "high",
                      deadline: "2026-11-14",
                      evidence: "Emmanuel and Sarah agreed to launch the beta trial next Friday",
                    },
                  ],
                  suggestedFollowUp: "Review beta metrics following launch.",
                }),
              },
            },
          ],
        }),
      } as any);

      const ledger = await generateVeraLedger({
        eventTitle: "Beta Planning",
        hostName: "Emmanuel Enyi",
        guestName: "Sarah Connor",
        agenda: [],
        sharedNotes: validNotes,
      });

      expect(ledger).toBeDefined();
      expect(ledger.keyDecisions).toHaveLength(1);
      expect(ledger.actionItems).toHaveLength(1);
    });
  });

  // =========================================================================
  // 2. Traceable Decisions & Evidence Verification
  // =========================================================================
  describe("Traceable Claims & Evidence Verification", () => {
    const context = {
      hostName: "Emmanuel Enyi",
      guestName: "Sarah Connor",
      sourceEvidence:
        "Emmanuel: We agree to proceed with the Postgres schema migration on Friday.\n" +
        "Sarah: I will review the Drizzle pull request by Thursday afternoon.\n" +
        "Emmanuel: We could perhaps look into Redis caching next quarter.",
    };

    it("accepts decisions that have verbatim supporting evidence in the source text", () => {
      const validated = validateVeraLedger(
        {
          executiveSummary: ["Team agreed on migration schedule."],
          keyDecisions: [
            {
              decision: "Proceed with Postgres schema migration on Friday",
              evidence: "agree to proceed with the Postgres schema migration on Friday",
            },
          ],
          actionItems: [],
        },
        context
      );

      expect(validated.keyDecisions).toHaveLength(1);
      expect(validated.keyDecisions[0]).toBe("Proceed with Postgres schema migration on Friday");
    });

    it("rejects unsupported decisions when evidence is absent from the source material", () => {
      const validated = validateVeraLedger(
        {
          executiveSummary: ["Meeting concluded."],
          keyDecisions: [
            {
              decision: "Adopt Kubernetes cluster immediately",
              evidence: "We decided to deploy to Kubernetes cluster immediately", // Fabricated quote
            },
          ],
          actionItems: [],
        },
        context
      );

      // Unsupported decision is discarded
      expect(validated.keyDecisions).toHaveLength(0);
    });

    it("rejects tentative proposals from being classified as decisions", () => {
      // "We could perhaps look into Redis caching next quarter" is a tentative suggestion, not an agreement
      const validated = validateVeraLedger(
        {
          executiveSummary: ["Explored caching possibilities."],
          keyDecisions: [
            {
              decision: "Migrate database to Redis caching",
              evidence: "We decided to migrate completely to Redis", // Absent
            },
          ],
          actionItems: [],
        },
        context
      );

      expect(validated.keyDecisions).toHaveLength(0);
    });

    it("accepts action items with valid supporting evidence in the source", () => {
      const validated = validateVeraLedger(
        {
          executiveSummary: ["Review schedule set."],
          keyDecisions: [],
          actionItems: [
            {
              task: "Review the Drizzle pull request",
              assignee: "Sarah Connor",
              priority: "high",
              deadline: "Thursday afternoon",
              evidence: "Sarah: I will review the Drizzle pull request by Thursday afternoon.",
            },
          ],
        },
        context
      );

      expect(validated.actionItems).toHaveLength(1);
      expect(validated.actionItems[0].task).toBe("Review the Drizzle pull request");
      expect(validated.actionItems[0].assignee).toBe("Sarah Connor");
      expect(validated.actionItems[0].deadline).toBe("Thursday afternoon");
    });

    it("rejects action items whose supporting evidence does not exist in the source", () => {
      const validated = validateVeraLedger(
        {
          executiveSummary: ["Reviewed items."],
          keyDecisions: [],
          actionItems: [
            {
              task: "Refactor backend API in Rust",
              assignee: "Emmanuel Enyi",
              priority: "medium",
              evidence: "Emmanuel: I will rewrite the whole backend in Rust tomorrow.", // Fabricated
            },
          ],
        },
        context
      );

      expect(validated.actionItems).toHaveLength(0);
    });
  });

  // =========================================================================
  // 3. Strict Participant Grounding
  // =========================================================================
  describe("Participant Grounding & Assignee Resolution", () => {
    it("grounds recognized host and guest names accurately", () => {
      const context = { hostName: "Emmanuel Enyi", guestName: "Sarah Connor" };

      expect(resolveParticipantAssignee("Emmanuel Enyi", context)).toBe("Emmanuel Enyi");
      expect(resolveParticipantAssignee("Sarah Connor", context)).toBe("Sarah Connor");
      expect(resolveParticipantAssignee("emmanuel", context)).toBe("Emmanuel Enyi");
      expect(resolveParticipantAssignee("sarah", context)).toBe("Sarah Connor");
      expect(resolveParticipantAssignee("Emmanuel (Host)", context)).toBe("Emmanuel Enyi");
    });

    it("maps unknown third-party names to Unassigned", () => {
      const context = { hostName: "Emmanuel Enyi", guestName: "Sarah Connor" };

      expect(resolveParticipantAssignee("Bob", context)).toBe("Unassigned");
      expect(resolveParticipantAssignee("Alice", context)).toBe("Unassigned");
      expect(resolveParticipantAssignee("External Vendor", context)).toBe("Unassigned");
    });

    it("maps ambiguous first names to Unassigned when both participants share the same first name", () => {
      const collidingContext = { hostName: "Alex Mercer", guestName: "Alex Turner" };

      // Ambiguous first name
      expect(resolveParticipantAssignee("Alex", collidingContext)).toBe("Unassigned");

      // Unambiguous full name
      expect(resolveParticipantAssignee("Alex Mercer", collidingContext)).toBe("Alex Mercer");
      expect(resolveParticipantAssignee("Alex Turner", collidingContext)).toBe("Alex Turner");
    });

    it("maps omitted, empty, or unassigned candidates to Unassigned without defaulting to host", () => {
      const context = { hostName: "Emmanuel Enyi", guestName: "Sarah Connor" };

      expect(resolveParticipantAssignee("", context)).toBe("Unassigned");
      expect(resolveParticipantAssignee("   ", context)).toBe("Unassigned");
      expect(resolveParticipantAssignee(undefined, context)).toBe("Unassigned");
      expect(resolveParticipantAssignee("Unassigned", context)).toBe("Unassigned");
      expect(resolveParticipantAssignee("unresolved", context)).toBe("Unassigned");
    });
  });

  // =========================================================================
  // 4. Pre-Meeting Brief Fallback Preservation
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
  // 5. Typed Timeout and Provider Errors
  // =========================================================================
  describe("Provider Error Handling", () => {
    const validNotes = "We met and agreed to launch the project next month.";

    it("throws VeraError with code MISSING_CREDENTIALS when DEEPSEEK_API_KEY is unset", async () => {
      delete process.env.DEEPSEEK_API_KEY;

      await expect(
        generateVeraLedger({
          eventTitle: "Engineering Alignment",
          hostName: "Emmanuel",
          guestName: "Alex",
          agenda: [],
          sharedNotes: validNotes,
        })
      ).rejects.toThrowError(VeraError);
    });

    it("aborts and throws VeraTimeoutError when request times out", async () => {
      process.env.DEEPSEEK_API_KEY = "test-fake-key";

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

      await expect(
        generateVeraLedger({
          eventTitle: "Timeout Test Call",
          hostName: "Emmanuel",
          guestName: "Alex",
          agenda: [],
          sharedNotes: validNotes,
          timeoutMs: 10,
        })
      ).rejects.toThrowError(VeraTimeoutError);
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
          sharedNotes: validNotes,
        })
      ).rejects.toThrowError(VeraError);
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
          sharedNotes: validNotes,
        })
      ).rejects.toThrowError(VeraError);
    });
  });
});
