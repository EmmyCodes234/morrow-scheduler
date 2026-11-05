import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  generateVeraPreMeetingBrief,
  generateVeraLedger,
  validateVeraLedger,
  isSubstantiveEvidence,
  extractSubstantiveEvidence,
  evidenceOccursInSource,
  resolveParticipantAssignee,
  isEvidenceRelevantToClaim,
  isConfirmedDecision,
  verifyAssigneeOwnership,
  verifyDeadlineGrounding,
  normalizeExecutiveSummaryClaim,
  normalizeDecisionItem,
  VeraError,
  VeraTimeoutError,
  VeraValidationError,
  VeraInsufficientEvidenceError,
  DEEPSEEK_TIMEOUT_MS,
  type VeraSummaryClaim,
  type VeraDecision,
  type VeraLedger,
} from "@/lib/intelligence/vera";
import { concludeRoomAndSynthesize, updateRoomNotes, approveRoomLedger } from "@/lib/room/room-service";

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
                    {
                      claim: "Emmanuel and Sarah agreed to launch the beta trial next Friday.",
                      evidence: "agreed to launch the beta trial next Friday, November 14th",
                    },
                  ],
                  keyDecisions: [
                    {
                      decision: "Launch beta trial on November 14th",
                      status: "confirmed",
                      evidence: "agreed to launch the beta trial next Friday, November 14th",
                    },
                  ],
                  actionItems: [
                    {
                      task: "Launch the beta trial",
                      assignee: "Emmanuel Enyi",
                      priority: "high",
                      deadline: "next Friday",
                      evidence: "Emmanuel and Sarah agreed to launch the beta trial next Friday, November 14th",
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
  // 2. Executive Summary Evidence Grounding & Traceability
  // =========================================================================
  describe("Executive Summary Evidence Grounding", () => {
    const context = {
      hostName: "Emmanuel Enyi",
      guestName: "Sarah Connor",
      sourceEvidence:
        "Emmanuel: We agree to proceed with the Postgres schema migration on Friday.\n" +
        "Sarah: I will review the Drizzle pull request by Thursday afternoon.\n" +
        "Emmanuel: We had lunch at 12pm and discussed the weather.",
    };

    it("rejects executive-summary strings without evidence", () => {
      expect(() =>
        validateVeraLedger(
          {
            executiveSummary: [
              "Emmanuel and Sarah agreed on Postgres schema migration schedule.",
            ],
            keyDecisions: [],
            actionItems: [],
          },
          context
        )
      ).toThrowError(VeraValidationError);
    });

    it("rejects summary objects without evidence", () => {
      expect(() =>
        validateVeraLedger(
          {
            executiveSummary: [
              { claim: "Team agreed on migration schedule." }, // Missing evidence
            ],
            keyDecisions: [],
            actionItems: [],
          },
          context
        )
      ).toThrowError(VeraValidationError);
    });

    it("rejects summary claims whose evidence does not exist in the source", () => {
      expect(() =>
        validateVeraLedger(
          {
            executiveSummary: [
              {
                claim: "Team agreed on migration schedule.",
                evidence: "We signed a contract with an external firm for database work.", // Fabricated quote
              },
            ],
            keyDecisions: [],
            actionItems: [],
          },
          context
        )
      ).toThrowError(VeraValidationError);
    });

    it("rejects an unrelated but genuine source excerpt as sufficient proof of a claim", () => {
      // The excerpt "We had lunch at 12pm" exists in source, but has zero relevance to adopting DynamoDB
      expect(() =>
        validateVeraLedger(
          {
            executiveSummary: [
              {
                claim: "Adopt AWS DynamoDB for the primary data layer",
                evidence: "We had lunch at 12pm and discussed the weather.",
              },
            ],
            keyDecisions: [],
            actionItems: [],
          },
          context
        )
      ).toThrowError(VeraValidationError);
    });

    it("accepts valid source-grounded summary claims and persists supporting evidence", () => {
      const validated = validateVeraLedger(
        {
          executiveSummary: [
            {
              claim: "Emmanuel and Sarah agreed to proceed with the Postgres schema migration on Friday.",
              evidence: "agree to proceed with the Postgres schema migration on Friday",
            },
          ],
          keyDecisions: [],
          actionItems: [],
        },
        context
      );

      expect(validated.executiveSummary).toHaveLength(1);
      const firstClaim = validated.executiveSummary[0] as VeraSummaryClaim;
      expect(firstClaim.claim).toBe(
        "Emmanuel and Sarah agreed to proceed with the Postgres schema migration on Friday."
      );
      expect(firstClaim.evidence).toBe("agree to proceed with the Postgres schema migration on Friday");
    });
  });

  // =========================================================================
  // 3. Traceable Decisions & Proposal Rejection
  // =========================================================================
  describe("Traceable Decisions & Proposal Rejection", () => {
    const context = {
      hostName: "Emmanuel Enyi",
      guestName: "Sarah Connor",
      sourceEvidence:
        "Emmanuel: We agree to proceed with the Postgres schema migration on Friday.\n" +
        "Sarah: I will review the Drizzle pull request by Thursday afternoon.\n" +
        "Emmanuel: We could perhaps look into Redis caching next quarter.\n" +
        "Sarah: We had coffee at 9am.",
    };

    it("accepts confirmed decisions with appropriate evidence and status", () => {
      const validated = validateVeraLedger(
        {
          executiveSummary: [
            {
              claim: "Team agreed on migration schedule.",
              evidence: "agree to proceed with the Postgres schema migration on Friday",
            },
          ],
          keyDecisions: [
            {
              decision: "Proceed with Postgres schema migration on Friday",
              status: "confirmed",
              evidence: "agree to proceed with the Postgres schema migration on Friday",
            },
          ],
          actionItems: [],
        },
        context
      );

      expect(validated.keyDecisions).toHaveLength(1);
      expect(validated.keyDecisions[0]).toEqual({
        decision: "Proceed with Postgres schema migration on Friday",
        status: "confirmed",
        evidence: "agree to proceed with the Postgres schema migration on Friday",
      });
    });

    it("rejects unsupported decisions when evidence is absent from the source material", () => {
      const validated = validateVeraLedger(
        {
          executiveSummary: [
            {
              claim: "Discussed migration.",
              evidence: "agree to proceed with the Postgres schema migration on Friday",
            },
          ],
          keyDecisions: [
            {
              decision: "Adopt Kubernetes cluster immediately",
              status: "confirmed",
              evidence: "We decided to deploy to Kubernetes cluster immediately", // Fabricated quote
            },
          ],
          actionItems: [],
        },
        context
      );

      expect(validated.keyDecisions).toHaveLength(0);
    });

    it("rejects tentative proposals from being classified as confirmed decisions", () => {
      const validated = validateVeraLedger(
        {
          executiveSummary: [
            {
              claim: "Reviewed caching options.",
              evidence: "We could perhaps look into Redis caching next quarter",
            },
          ],
          keyDecisions: [
            {
              decision: "Migrate database to Redis caching",
              status: "proposed",
              evidence: "We could perhaps look into Redis caching next quarter",
            },
            {
              decision: "Adopt Redis caching next quarter",
              status: "confirmed", // Falsely claimed confirmed, but evidence shows tentative proposal
              evidence: "We could perhaps look into Redis caching next quarter",
            },
          ],
          actionItems: [],
        },
        context
      );

      expect(validated.keyDecisions).toHaveLength(0);
    });

    it("rejects decisions when evidence is an unrelated but genuine source excerpt", () => {
      const validated = validateVeraLedger(
        {
          executiveSummary: [
            {
              claim: "Agreed to proceed with the Postgres schema migration.",
              evidence: "agree to proceed with the Postgres schema migration on Friday",
            },
          ],
          keyDecisions: [
            {
              decision: "Adopt Apache Kafka for streaming data pipelines",
              status: "confirmed",
              evidence: "We had coffee at 9am.", // Exists in source, but completely unrelated
            },
          ],
          actionItems: [],
        },
        context
      );

      expect(validated.keyDecisions).toHaveLength(0);
    });
  });

  // =========================================================================
  // 4. Action Items Ownership Grounding & Deadline Grounding
  // =========================================================================
  describe("Action Items Ownership & Deadline Grounding", () => {
    const context = {
      hostName: "Emmanuel Enyi",
      guestName: "Sarah Connor",
      sourceEvidence:
        "Emmanuel: We agree to proceed with the Postgres schema migration on Friday.\n" +
        "Sarah: I will review the Drizzle pull request by Thursday afternoon.\n" +
        "Emmanuel: We talked about Emmanuel's past project, but Sarah will handle the migration.\n" +
        "Sarah: We also had coffee at 9am.",
    };

    it("accepts action items with valid supporting evidence in the source", () => {
      const validated = validateVeraLedger(
        {
          executiveSummary: [
            {
              claim: "Sarah will review the Drizzle pull request.",
              evidence: "Sarah: I will review the Drizzle pull request by Thursday afternoon.",
            },
          ],
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
      expect(validated.actionItems[0].evidence).toBe(
        "Sarah: I will review the Drizzle pull request by Thursday afternoon."
      );
    });

    it("cannot assign an action item solely because assignee's name appears in evidence", () => {
      // In "We talked about Emmanuel's past project, but Sarah will handle the migration.",
      // Emmanuel is mentioned, but does NOT own the task.
      const validated = validateVeraLedger(
        {
          executiveSummary: [
            {
              claim: "Sarah will handle the migration.",
              evidence: "Sarah will handle the migration.",
            },
          ],
          keyDecisions: [],
          actionItems: [
            {
              task: "Handle the migration",
              assignee: "Emmanuel Enyi", // Casual mention, not owner
              priority: "high",
              evidence: "We talked about Emmanuel's past project, but Sarah will handle the migration.",
            },
          ],
        },
        context
      );

      expect(validated.actionItems).toHaveLength(1);
      expect(validated.actionItems[0].assignee).toBe("Unassigned");
    });

    it("rejects action items whose supporting evidence does not exist in the source", () => {
      const validated = validateVeraLedger(
        {
          executiveSummary: [
            {
              claim: "Sarah will review the Drizzle pull request.",
              evidence: "Sarah: I will review the Drizzle pull request by Thursday afternoon.",
            },
          ],
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

    it("rejects action items when evidence is an unrelated source excerpt", () => {
      const validated = validateVeraLedger(
        {
          executiveSummary: [
            {
              claim: "Sarah will review the Drizzle pull request.",
              evidence: "Sarah: I will review the Drizzle pull request by Thursday afternoon.",
            },
          ],
          keyDecisions: [],
          actionItems: [
            {
              task: "Deploy production cluster to Google Cloud",
              assignee: "Sarah Connor",
              priority: "high",
              evidence: "Sarah: We also had coffee at 9am.", // Exists in source, but unrelated to cluster deployment
            },
          ],
        },
        context
      );

      expect(validated.actionItems).toHaveLength(0);
    });

    it("rejects invented deadlines and preserves source-grounded deadlines", () => {
      const validated = validateVeraLedger(
        {
          executiveSummary: [
            {
              claim: "Sarah will review the Drizzle pull request.",
              evidence: "Sarah: I will review the Drizzle pull request by Thursday afternoon.",
            },
          ],
          keyDecisions: [],
          actionItems: [
            {
              task: "Review the Drizzle pull request",
              assignee: "Sarah Connor",
              priority: "high",
              deadline: "2026-11-25T18:00:00Z", // Invented timestamp not in source
              evidence: "Sarah: I will review the Drizzle pull request by Thursday afternoon.",
            },
          ],
        },
        context
      );

      expect(validated.actionItems).toHaveLength(1);
      // Invented deadline is discarded
      expect(validated.actionItems[0].deadline).toBeUndefined();
    });
  });

  // =========================================================================
  // 5. Backward Compatibility for Legacy Ledgers
  // =========================================================================
  describe("Backward Compatibility for Legacy Ledgers", () => {
    it("normalizes legacy plain-string summary items without crashing", () => {
      const legacyItem = "This is a previously saved plain summary string from an older ledger.";
      const normalized = normalizeExecutiveSummaryClaim(legacyItem);
      expect(normalized.claim).toBe(legacyItem);
      expect(normalized.evidence).toBeUndefined();
    });

    it("normalizes new claim-evidence summary objects accurately", () => {
      const newItem: VeraSummaryClaim = {
        claim: "Decided to adopt Neon PostgreSQL.",
        evidence: "agreed to adopt Neon PostgreSQL",
      };
      const normalized = normalizeExecutiveSummaryClaim(newItem);
      expect(normalized.claim).toBe("Decided to adopt Neon PostgreSQL.");
      expect(normalized.evidence).toBe("agreed to adopt Neon PostgreSQL");
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

  // =========================================================================
  // 7. Room Service Synthesis Retry & Concurrency Suite
  // =========================================================================
  describe("Room Service Synthesis Retry & Concurrency Suite", () => {
    it("allows a room in insufficient_evidence state to be claimed and retried", async () => {
      let currentRoom: any = {
        id: "room-1",
        bookingId: "b-1",
        accessToken: "token-retry-123",
        status: "in_progress",
        synthesisStatus: "insufficient_evidence",
        synthesisClaimToken: null as string | null,
        synthesisClaimedAt: null as Date | null,
        sharedNotes: "Emmanuel and Sarah agreed to launch next Friday, November 14th.",
        transcript: null,
        agenda: [],
        veraLedger: null,
        booking: {
          id: "b-1",
          status: "confirmed",
          guestName: "Sarah Connor",
          host: { id: "u-1", name: "Emmanuel Enyi" },
          eventType: { title: "Strategy Sync" },
        },
      };

      const mockDb: any = {
        query: {
          rooms: {
            findFirst: vi.fn().mockImplementation(async () => currentRoom),
          },
        },
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockImplementation((setValues) => ({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockImplementation(async () => {
                currentRoom = { ...currentRoom, ...setValues };
                return [currentRoom];
              }),
            }),
          })),
        }),
      };

      vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  executiveSummary: [
                    {
                      claim: "Emmanuel and Sarah agreed to launch next Friday.",
                      evidence: "agreed to launch next Friday, November 14th",
                    },
                  ],
                  keyDecisions: [
                    {
                      decision: "Launch next Friday",
                      status: "confirmed",
                      evidence: "agreed to launch next Friday, November 14th",
                    },
                  ],
                  actionItems: [],
                }),
              },
            },
          ],
        }),
      } as any);

      process.env.DEEPSEEK_API_KEY = "test-key";

      const result = await concludeRoomAndSynthesize("token-retry-123", mockDb);
      expect(result.success).toBe(true);
      expect(result.status).toBe("concluded");
      expect(result.veraLedger).toBeDefined();
    });

    it("prevents duplicate synthesis when room is already concluded", async () => {
      const existingLedger = {
        executiveSummary: [{ claim: "Already concluded claim", evidence: "source quote" }],
        actionItems: [],
        keyDecisions: ["Confirmed decision"],
      };

      const mockDb: any = {
        query: {
          rooms: {
            findFirst: vi.fn().mockResolvedValue({
              id: "room-concluded",
              status: "concluded",
              synthesisStatus: "completed",
              veraLedger: existingLedger,
              booking: {
                id: "b-concluded",
                status: "confirmed",
                host: { id: "u-1", name: "Host" },
              },
            }),
          },
        },
      };

      const fetchSpy = vi.spyOn(globalThis, "fetch");

      const result = await concludeRoomAndSynthesize("token-concluded", mockDb);
      expect(result.success).toBe(true);
      expect(result.status).toBe("concluded");
      expect(result.alreadyConcluded).toBe(true);
      expect(result.veraLedger).toEqual(existingLedger);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("rejects concurrent second worker when lease is actively held", async () => {
      let isFirstCall = true;
      const mockDb: any = {
        query: {
          rooms: {
            findFirst: vi.fn().mockImplementation(async () => ({
              id: "room-active",
              status: "in_progress",
              synthesisStatus: isFirstCall ? "idle" : "synthesizing",
              synthesisClaimToken: isFirstCall ? null : "worker-1-token",
              synthesisClaimedAt: new Date(), // Active lease
              booking: {
                id: "b-active",
                status: "confirmed",
                host: { id: "u-1", name: "Host" },
              },
            })),
          },
        },
        update: vi.fn().mockImplementation(() => {
          if (isFirstCall) {
            isFirstCall = false;
            return {
              set: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                  returning: vi.fn().mockResolvedValue([
                    {
                      id: "room-active",
                      synthesisStatus: "synthesizing",
                      synthesisClaimToken: "worker-1-token",
                      sharedNotes: "Valid meeting notes between Emmanuel and Sarah.",
                      booking: { id: "b-active", guestName: "Sarah", host: { name: "Emmanuel" } },
                    },
                  ]),
                }),
              }),
            };
          } else {
            // Second worker update where clause matches nothing because lease is active
            return {
              set: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                  returning: vi.fn().mockResolvedValue([]),
                }),
              }),
            };
          }
        }),
      };

      // Worker 2 calls concludeRoomAndSynthesize while Worker 1 holds lease
      isFirstCall = false; // Worker 2 view
      const result2 = await concludeRoomAndSynthesize("token-active", mockDb);
      expect(result2.success).toBe(true);
      expect(result2.status).toBe("synthesizing");
      expect(result2.processing).toBe(true);
    });

    it("fences out a stale worker whose claim was superseded", async () => {
      const activeClaimToken = "active-token-999";
      const staleClaimToken = "stale-token-111";

      let writeAttempts = 0;
      const mockDb: any = {
        query: {
          rooms: {
            findFirst: vi.fn().mockResolvedValue({
              id: "room-stale",
              status: "in_progress",
              synthesisStatus: "synthesizing",
              synthesisClaimToken: activeClaimToken, // superseded in db
              booking: { id: "b-stale", status: "confirmed", host: { id: "h-1", name: "Host" } },
            }),
          },
        },
        update: vi.fn().mockImplementation(() => {
          writeAttempts++;
          if (writeAttempts === 1) {
            // Lease claim succeeds initially
            return {
              set: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                  returning: vi.fn().mockResolvedValue([
                    {
                      id: "room-stale",
                      synthesisStatus: "synthesizing",
                      synthesisClaimToken: staleClaimToken,
                      sharedNotes: "Emmanuel and Sarah agreed to proceed with testing.",
                      booking: { id: "b-stale", guestName: "Sarah", host: { name: "Emmanuel" } },
                    },
                  ]),
                }),
              }),
            };
          } else {
            // Final commit fails because lease expired / superseded
            return {
              set: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                  returning: vi.fn().mockResolvedValue([]), // 0 rows updated
                }),
              }),
            };
          }
        }),
      };

      vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  executiveSummary: [
                    {
                      claim: "Emmanuel and Sarah agreed to proceed with testing.",
                      evidence: "agreed to proceed with testing",
                    },
                  ],
                  keyDecisions: [],
                  actionItems: [],
                }),
              },
            },
          ],
        }),
      } as any);

      process.env.DEEPSEEK_API_KEY = "test-key";

      const result = await concludeRoomAndSynthesize("token-stale", mockDb);
      expect(result.success).toBe(false);
      expect(result.status).toBe("stale_worker");
    });
  });

  // =========================================================================
  // Task 1.1.5: Conservative Decision Validation, Evidence Preservation, Host Review & Strict Grounding
  // =========================================================================
  describe("Task 1.1.5 — Conservative Decision Validation, Evidence Preservation & Host Review", () => {
    it("rejects decision with missing status from being classified as confirmed", () => {
      expect(isConfirmedDecision("Launch beta on Friday", "agreed to launch beta on Friday", undefined)).toBe(false);
      expect(isConfirmedDecision("Launch beta on Friday", "agreed to launch beta on Friday", "")).toBe(false);

      const context = {
        hostName: "Emmanuel Enyi",
        guestName: "Sarah Connor",
        sharedNotes: "We agreed to launch beta on Friday.",
      };
      const validated = validateVeraLedger(
        {
          executiveSummary: [{ claim: "Launch beta", evidence: "agreed to launch beta on Friday" }],
          keyDecisions: [
            {
              decision: "Launch beta on Friday",
              // status missing
              evidence: "agreed to launch beta on Friday",
            } as any,
          ],
          actionItems: [],
        },
        context
      );
      expect(validated.keyDecisions).toHaveLength(0);
    });

    it("rejects plain-string new decision entries without structured validation", () => {
      const context = {
        hostName: "Emmanuel Enyi",
        guestName: "Sarah Connor",
        sharedNotes: "We agreed to adopt Postgres 16 for production.",
      };
      const validated = validateVeraLedger(
        {
          executiveSummary: [{ claim: "Adopt Postgres", evidence: "agreed to adopt Postgres 16 for production." }],
          keyDecisions: [
            "Adopt Postgres 16 for production" as any,
          ],
          actionItems: [],
        },
        context
      );
      expect(validated.keyDecisions).toHaveLength(0);
    });

    it("preserves structured decision object with confirmed status and verified evidence", () => {
      const context = {
        hostName: "Emmanuel Enyi",
        guestName: "Sarah Connor",
        sharedNotes: "We agreed to proceed with the Postgres schema migration on Friday.",
      };
      const validated = validateVeraLedger(
        {
          executiveSummary: [{ claim: "Proceed with migration", evidence: "agreed to proceed with the Postgres schema migration on Friday" }],
          keyDecisions: [
            {
              decision: "Proceed with Postgres schema migration on Friday",
              status: "confirmed",
              evidence: "agreed to proceed with the Postgres schema migration on Friday",
            },
          ],
          actionItems: [],
        },
        context
      );
      expect(validated.keyDecisions).toHaveLength(1);
      expect(validated.keyDecisions[0]).toEqual({
        decision: "Proceed with Postgres schema migration on Friday",
        status: "confirmed",
        evidence: "agreed to proceed with the Postgres schema migration on Friday",
      });
    });

    it("does not classify proposed or open-question decisions as confirmed", () => {
      expect(isConfirmedDecision("Consider GraphQL", "We could consider GraphQL", "proposed")).toBe(false);
      expect(isConfirmedDecision("Database choice", "Which database to pick", "open_question")).toBe(false);

      const context = {
        hostName: "Emmanuel Enyi",
        guestName: "Sarah Connor",
        sharedNotes: "We discussed GraphQL as an alternative but did not decide.",
      };
      const validated = validateVeraLedger(
        {
          executiveSummary: [{ claim: "Discussed GraphQL", evidence: "discussed GraphQL as an alternative" }],
          keyDecisions: [
            {
              decision: "Adopt GraphQL for mobile clients",
              status: "proposed",
              evidence: "discussed GraphQL as an alternative",
            },
            {
              decision: "Which API architecture to use?",
              status: "open_question",
              evidence: "discussed GraphQL as an alternative",
            },
          ],
          actionItems: [],
        },
        context
      );
      expect(validated.keyDecisions).toHaveLength(0);
    });

    it("rejects decisions containing explicit negation or refusal language", () => {
      const negativeCases = [
        {
          decision: "We did not agree to adopt Redis",
          evidence: "We did not agree to adopt Redis for session caching",
        },
        {
          decision: "Cannot proceed with migration yet",
          evidence: "cannot proceed with migration yet until tests pass",
        },
        {
          decision: "Have not finalized the cloud provider",
          evidence: "have not finalized the cloud provider",
        },
        {
          decision: "Sarah refused to deploy on Friday",
          evidence: "Sarah refused to deploy on Friday due to stability risks",
        },
        {
          decision: "Decision against migrating to DynamoDB",
          evidence: "We decided against migrating to DynamoDB",
        },
      ];

      for (const { decision, evidence } of negativeCases) {
        expect(isConfirmedDecision(decision, evidence, "confirmed")).toBe(false);
      }
    });

    it("rejects a decision when the evidence contains contradictory or qualified negation", () => {
      const context = {
        hostName: "Emmanuel Enyi",
        guestName: "Sarah Connor",
        sharedNotes: "The team discussed backend caching options. The team specifically did not agree to adopt Redis caching.",
      };
      const validated = validateVeraLedger(
        {
          executiveSummary: [{ claim: "Discussed backend caching options", evidence: "discussed backend caching options" }],
          keyDecisions: [
            {
              decision: "Adopt Redis caching",
              status: "confirmed",
              evidence: "specifically did not agree to adopt Redis caching",
            },
          ],
          actionItems: [],
        },
        context
      );
      expect(validated.keyDecisions).toHaveLength(0);
    });

    it("ensures decision evidence is preserved in VeraLedger structured data", () => {
      const ledger: VeraLedger = {
        executiveSummary: [{ claim: "Summary", evidence: "Source quote" }],
        keyDecisions: [
          {
            decision: "Migrate to Tailwind v4",
            status: "confirmed",
            evidence: "agreed to migrate to Tailwind v4 next week",
          },
        ],
        actionItems: [],
        reviewStatus: "pending_host_review",
      };

      const normalized = ledger.keyDecisions.map(normalizeDecisionItem);
      expect(normalized[0]).toEqual({
        decision: "Migrate to Tailwind v4",
        status: "confirmed",
        evidence: "agreed to migrate to Tailwind v4 next week",
      });
    });

    it("normalizes historical plain-string decisions for backward compatibility", () => {
      const legacyDecision = "Adopt semantic design tokens";
      const normalized = normalizeDecisionItem(legacyDecision);
      expect(normalized).toEqual({
        decision: "Adopt semantic design tokens",
        status: "confirmed",
      });

      const structuredDecision: VeraDecision = {
        decision: "Adopt semantic design tokens",
        status: "confirmed",
        evidence: "agreed to adopt semantic design tokens",
      };
      expect(normalizeDecisionItem(structuredDecision)).toEqual(structuredDecision);
    });

    it("rejects speaker labels without affirmative commitment as action ownership", () => {
      expect(verifyAssigneeOwnership("Sarah Connor", "Sarah: We discussed the migration")).toBe(false);
      expect(verifyAssigneeOwnership("Sarah Connor", "Sarah: The migration is still unassigned")).toBe(false);
      expect(verifyAssigneeOwnership("Sarah Connor", "Sarah: Has anyone looked at the schema?")).toBe(false);
    });

    it("verifies explicit first-person commitment and third-person assignments", () => {
      expect(verifyAssigneeOwnership("Sarah Connor", "Sarah: I will handle the migration")).toBe(true);
      expect(verifyAssigneeOwnership("Sarah Connor", "Sarah: I'll deploy the build")).toBe(true);
      expect(verifyAssigneeOwnership("Sarah Connor", "Sarah: Let me review the pull request")).toBe(true);
      expect(verifyAssigneeOwnership("Sarah Connor", "Sarah: I can take this task")).toBe(true);

      expect(verifyAssigneeOwnership("Sarah Connor", "Sarah will handle the database migration")).toBe(true);
      expect(verifyAssigneeOwnership("Sarah Connor", "Sarah agreed to deploy the changes")).toBe(true);
      expect(verifyAssigneeOwnership("Sarah Connor", "Assigned to Sarah")).toBe(true);
      expect(verifyAssigneeOwnership("Sarah Connor", "Action item for Sarah: write tests")).toBe(true);
    });

    it("rejects action item assignments when the participant explicitly refuses or declines", () => {
      expect(verifyAssigneeOwnership("Sarah Connor", "Sarah: I cannot take responsibility for the migration")).toBe(false);
      expect(verifyAssigneeOwnership("Sarah Connor", "Sarah: I won't be able to handle deployment")).toBe(false);
      expect(verifyAssigneeOwnership("Sarah Connor", "Sarah refused to take on the database migration")).toBe(false);
      expect(verifyAssigneeOwnership("Sarah Connor", "Sarah is not responsible for the backend services")).toBe(false);
      expect(verifyAssigneeOwnership("Sarah Connor", "not assigned to Sarah")).toBe(false);
    });

    it("rejects scattered temporal words but preserves contiguous deadline phrases", () => {
      const source = "We had a meeting on Friday. The bug was detected at 3pm yesterday.";
      expect(verifyDeadlineGrounding("Friday at 3pm", "meeting on Friday", source)).toBeUndefined();

      const source2 = "Sarah agreed to finish the audit by Thursday afternoon.";
      expect(verifyDeadlineGrounding("by Thursday afternoon", "audit by Thursday afternoon", source2)).toBe("by Thursday afternoon");
      expect(verifyDeadlineGrounding("Thursday afternoon", "audit by Thursday afternoon", source2)).toBe("Thursday afternoon");
      expect(verifyDeadlineGrounding("next Friday", "launch the beta trial next Friday", "launch the beta trial next Friday")).toBe("next Friday");
    });

    it("initializes new synthesized ledgers with reviewStatus pending_host_review", async () => {
      process.env.DEEPSEEK_API_KEY = "test-key";
      vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  executiveSummary: [{ claim: "Beta planned", evidence: "agreed to launch beta next Friday" }],
                  keyDecisions: [{ decision: "Launch beta", status: "confirmed", evidence: "agreed to launch beta next Friday" }],
                  actionItems: [],
                }),
              },
            },
          ],
        }),
      } as any);

      const ledger = await generateVeraLedger({
        eventTitle: "Sprint Review",
        hostName: "Emmanuel Enyi",
        guestName: "Sarah Connor",
        agenda: [],
        sharedNotes: "We agreed to launch beta next Friday.",
      });

      expect(ledger.reviewStatus).toBe("pending_host_review");
    });

    it("allows the meeting host to approve a pending ledger via approveRoomLedger", async () => {
      const mockHostId = "host-user-123";
      const unapprovedLedger: VeraLedger = {
        executiveSummary: [{ claim: "Beta planned", evidence: "launch beta" }],
        keyDecisions: [{ decision: "Launch beta", status: "confirmed", evidence: "launch beta" }],
        actionItems: [],
        reviewStatus: "pending_host_review",
      };

      let dbLedger: any = unapprovedLedger;
      const mockDb: any = {
        query: {
          rooms: {
            findFirst: vi.fn().mockImplementation(() =>
              Promise.resolve({
                id: "room-abc",
                accessToken: "token-abc",
                status: "concluded",
                booking: { host: { id: mockHostId } },
                veraLedger: dbLedger,
              })
            ),
          },
        },
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockImplementation((updates: any) => ({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockImplementation(() => {
                dbLedger = updates.veraLedger;
                return Promise.resolve([{ id: "room-abc", veraLedger: dbLedger }]);
              }),
            }),
          })),
        }),
      };

      const result = await approveRoomLedger("token-abc", mockHostId, mockDb);
      expect(result.success).toBe(true);
      expect(result.status).toBe("approved");
      expect(result.veraLedger?.reviewStatus).toBe("approved");
      expect(result.veraLedger?.approvedBy).toBe(mockHostId);
      expect(result.veraLedger?.approvedAt).toBeDefined();
    });

    it("forbids an unrelated authenticated user from approving the host's ledger", async () => {
      const mockHostId = "host-user-123";
      const intruderId = "intruder-user-999";
      const mockDb: any = {
        query: {
          rooms: {
            findFirst: vi.fn().mockResolvedValue({
              id: "room-abc",
              accessToken: "token-abc",
              status: "concluded",
              booking: { host: { id: mockHostId } },
              veraLedger: {
                executiveSummary: [{ claim: "Summary", evidence: "quote" }],
                actionItems: [],
                reviewStatus: "pending_host_review",
              },
            }),
          },
        },
      };

      const result = await approveRoomLedger("token-abc", intruderId, mockDb);
      expect(result.success).toBe(false);
      expect(result.status).toBe("forbidden");
      expect(result.error).toContain("Forbidden");
    });

    it("forbids guest or missing host identity from approving the ledger", async () => {
      const mockDb: any = {
        query: {
          rooms: {
            findFirst: vi.fn().mockResolvedValue({
              id: "room-abc",
              accessToken: "token-abc",
              status: "concluded",
              booking: { host: { id: "host-user-123" } },
              veraLedger: { reviewStatus: "pending_host_review" },
            }),
          },
        },
      };

      const result = await approveRoomLedger("token-abc", "", mockDb);
      expect(result.success).toBe(false);
      expect(result.status).toBe("forbidden");
    });

    it("handles repeated approvals idempotently without corrupting ledger", async () => {
      const mockHostId = "host-user-123";
      const existingApprovedLedger: VeraLedger = {
        executiveSummary: [{ claim: "Summary", evidence: "quote" }],
        keyDecisions: [{ decision: "Launch beta", status: "confirmed", evidence: "quote" }],
        actionItems: [],
        reviewStatus: "approved",
        approvedAt: "2026-11-05T08:00:00.000Z",
        approvedBy: mockHostId,
      };

      const mockDb: any = {
        query: {
          rooms: {
            findFirst: vi.fn().mockResolvedValue({
              id: "room-abc",
              accessToken: "token-abc",
              status: "concluded",
              booking: { host: { id: mockHostId } },
              veraLedger: existingApprovedLedger,
            }),
          },
        },
        update: vi.fn(),
      };

      const result = await approveRoomLedger("token-abc", mockHostId, mockDb);
      expect(result.success).toBe(true);
      expect(result.status).toBe("already_approved");
      expect(result.veraLedger?.approvedAt).toBe("2026-11-05T08:00:00.000Z");
      expect(result.veraLedger?.approvedBy).toBe(mockHostId);
      expect(mockDb.update).not.toHaveBeenCalled();
    });
  });
});
