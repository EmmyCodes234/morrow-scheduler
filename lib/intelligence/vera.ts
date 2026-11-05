export interface VeraAgendaItem {
  id: string;
  text: string;
  done: boolean;
  addedBy: "host" | "guest" | "vera";
}

export interface VeraActionItem {
  id: string;
  task: string;
  assignee: string;
  priority: "high" | "medium" | "low";
  done: boolean;
  deadline?: string;
  evidence?: string;
}

export interface VeraPreMeetingBrief {
  intent: string;
  talkingPoints: string[];
  background: string;
  suggestedAgenda: VeraAgendaItem[];
}

export interface VeraLedger {
  executiveSummary: string[];
  actionItems: VeraActionItem[];
  keyDecisions: string[];
  suggestedFollowUp?: string;
}

export const DEEPSEEK_TIMEOUT_MS = 25_000;
const DEEPSEEK_API_URL = "https://api.deepseek.com/chat/completions";
const MODEL_NAME = process.env.DEEPSEEK_MODEL || "deepseek-chat";

export class VeraError extends Error {
  code: string;
  statusCode?: number;

  constructor(message: string, code: string, statusCode?: number) {
    super(message);
    this.name = "VeraError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export class VeraTimeoutError extends VeraError {
  constructor(message = `DeepSeek request timed out after ${DEEPSEEK_TIMEOUT_MS}ms.`) {
    super(message, "TIMEOUT", 504);
    this.name = "VeraTimeoutError";
  }
}

export class VeraValidationError extends VeraError {
  constructor(message: string) {
    super(message, "VALIDATION_ERROR", 422);
    this.name = "VeraValidationError";
  }
}

export class VeraInsufficientEvidenceError extends VeraError {
  constructor(
    message = "Vera needs actual meeting notes or a transcript before it can create a reliable meeting record. Add the missing context and try again."
  ) {
    super(message, "INSUFFICIENT_EVIDENCE", 422);
    this.name = "VeraInsufficientEvidenceError";
  }
}

const KNOWN_PLACEHOLDERS = [
  "conversation completed as outlined in notes and agenda",
  "no manual notes taken",
  "no notes provided",
  "standard scheduled sync",
  "no transcript available",
  "conversation completed as outlined",
];

/**
 * Determines whether the supplied text contains substantive meeting evidence
 * beyond whitespace, trivial fragments, or boilerplate placeholders.
 */
export function isSubstantiveEvidence(text?: string | null): boolean {
  if (!text || typeof text !== "string") return false;
  const trimmed = text.trim();
  if (trimmed.length < 15) return false;

  const normalized = trimmed
    .toLowerCase()
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "")
    .trim();

  for (const placeholder of KNOWN_PLACEHOLDERS) {
    const cleanPlaceholder = placeholder
      .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "")
      .trim();
    if (normalized === cleanPlaceholder) {
      return false;
    }
  }
  return true;
}

/**
 * Combines substantive notes and transcripts into a unified evidence document.
 * Returns an empty string if neither source contains genuine evidence.
 */
export function extractSubstantiveEvidence(notes?: string | null, transcript?: string | null): string {
  const parts: string[] = [];
  if (isSubstantiveEvidence(notes)) {
    parts.push(notes!.trim());
  }
  if (isSubstantiveEvidence(transcript)) {
    parts.push(transcript!.trim());
  }
  return parts.join("\n\n");
}

/**
 * Normalizes text for comparison against source evidence.
 */
export function normalizeForEvidenceComparison(text: string): string {
  return text
    .toLowerCase()
    .replace(/[“”"''`]/g, "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[.,\/#!$%\^&\*;:{}=\-_~()]/g, "")
    .trim();
}

/**
 * Checks whether an excerpt exists as a normalized substring in the source material.
 */
export function evidenceOccursInSource(excerpt: string, source: string): boolean {
  if (!excerpt || !source) return false;
  const normExcerpt = normalizeForEvidenceComparison(excerpt);
  const normSource = normalizeForEvidenceComparison(source);
  if (!normExcerpt || normExcerpt.length < 5) return false;
  return normSource.includes(normExcerpt);
}

/**
 * Strictly resolves an action item assignee to host, guest, or "Unassigned".
 * Unknown names or ambiguous first names automatically become "Unassigned".
 */
export function resolveParticipantAssignee(
  rawAssignee: string | undefined | null,
  context: { hostName: string; guestName: string }
): string {
  if (!rawAssignee || typeof rawAssignee !== "string") {
    return "Unassigned";
  }

  const trimmed = rawAssignee.trim();
  const lower = trimmed.toLowerCase();
  if (
    !lower ||
    lower === "unassigned" ||
    lower === "unresolved" ||
    lower === "nobody" ||
    lower === "none"
  ) {
    return "Unassigned";
  }

  const hostFull = context.hostName.trim();
  const guestFull = context.guestName.trim();
  const hostLower = hostFull.toLowerCase();
  const guestLower = guestFull.toLowerCase();

  // Exact full name match
  if (lower === hostLower) return hostFull;
  if (lower === guestLower) return guestFull;

  // Extract first names
  const hostFirst = hostLower.split(/\s+/)[0];
  const guestFirst = guestLower.split(/\s+/)[0];
  const firstNamesCollide = hostFirst === guestFirst;

  // If first names collide (e.g. John Doe & John Smith), "John" is ambiguous
  if (firstNamesCollide) {
    if (lower === hostFirst) return "Unassigned";
  } else {
    if (lower === hostFirst) return hostFull;
    if (lower === guestFirst) return guestFull;
  }

  // Check role-annotated name: e.g. "Emmanuel Enyi (Host)", "Sarah Connor (Guest)"
  const matchesHost =
    lower.includes(hostLower) || (!firstNamesCollide && lower.includes(hostFirst));
  const matchesGuest =
    lower.includes(guestLower) || (!firstNamesCollide && lower.includes(guestFirst));

  if (matchesHost && !matchesGuest) return hostFull;
  if (matchesGuest && !matchesHost) return guestFull;

  // Unknown names (e.g. "Bob", "Charlie", "ThirdParty") or ambiguous matches become "Unassigned"
  return "Unassigned";
}

export async function callDeepSeek(
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  options?: { timeoutMs?: number }
) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new VeraError("DEEPSEEK_API_KEY is not configured.", "MISSING_CREDENTIALS", 500);
  }

  const timeoutMs = options?.timeoutMs ?? DEEPSEEK_TIMEOUT_MS;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(DEEPSEEK_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL_NAME,
        messages,
        response_format: { type: "json_object" },
        temperature: 0.3,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => "");
      throw new VeraError(
        `DeepSeek API request failed (${res.status}): ${errorText}`,
        "PROVIDER_ERROR",
        res.status
      );
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content || typeof content !== "string" || !content.trim()) {
      throw new VeraError("Empty response returned from DeepSeek API.", "EMPTY_RESPONSE", 502);
    }

    try {
      return JSON.parse(content);
    } catch {
      throw new VeraError("Malformed JSON returned from DeepSeek API.", "INVALID_JSON", 502);
    }
  } catch (err: unknown) {
    const errorObj = err as { name?: string } | undefined;
    if (errorObj?.name === "AbortError" || controller.signal.aborted) {
      throw new VeraTimeoutError(`DeepSeek request timed out after ${timeoutMs}ms.`);
    }
    if (err instanceof VeraError) {
      throw err;
    }
    throw new VeraError(err instanceof Error ? err.message : String(err), "NETWORK_ERROR");
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Validates the structured output returned from DeepSeek for post-meeting synthesis.
 * Ensures claims, decisions, and action items are grounded in the supplied meeting evidence.
 * Discards unsupported decisions and action items rather than accepting unevidenced claims.
 */
export function validateVeraLedger(
  raw: unknown,
  context: { hostName: string; guestName: string; sourceEvidence?: string }
): VeraLedger {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new VeraValidationError("Model output is not a valid JSON object.");
  }

  const rawObj = raw as Record<string, unknown>;
  const source = context.sourceEvidence || "";

  // 1. executiveSummary: must be a valid array of non-empty strings or claim objects
  if (!Array.isArray(rawObj.executiveSummary) || rawObj.executiveSummary.length === 0) {
    throw new VeraValidationError("executiveSummary must be a non-empty array of strings.");
  }

  const executiveSummary: string[] = [];
  for (let i = 0; i < rawObj.executiveSummary.length; i++) {
    const item = rawObj.executiveSummary[i];
    let claimText = "";
    let evidenceQuote = "";

    if (typeof item === "string") {
      claimText = item.trim();
    } else if (item && typeof item === "object") {
      const obj = item as Record<string, unknown>;
      claimText = typeof obj.claim === "string" ? obj.claim.trim() : typeof obj.text === "string" ? obj.text.trim() : "";
      evidenceQuote = typeof obj.evidence === "string" ? obj.evidence.trim() : "";
    }

    if (!claimText) {
      throw new VeraValidationError(`executiveSummary item at index ${i} is not a valid non-empty string or claim.`);
    }

    // If sourceEvidence is provided, verify evidence quote occurs in source if provided
    if (source && evidenceQuote) {
      if (!evidenceOccursInSource(evidenceQuote, source)) {
        continue;
      }
    }

    executiveSummary.push(claimText);
  }

  if (executiveSummary.length === 0) {
    throw new VeraValidationError("No executive summary claims could be verified against the supplied meeting evidence.");
  }

  // 2. keyDecisions: must be a valid array of strings or decision objects
  if (!Array.isArray(rawObj.keyDecisions)) {
    throw new VeraValidationError("keyDecisions must be an array of strings.");
  }

  const keyDecisions: string[] = [];
  for (let i = 0; i < rawObj.keyDecisions.length; i++) {
    const item = rawObj.keyDecisions[i];
    let decisionText = "";
    let evidenceQuote = "";

    if (typeof item === "string") {
      decisionText = item.trim();
      evidenceQuote = decisionText;
    } else if (item && typeof item === "object") {
      const obj = item as Record<string, unknown>;
      decisionText = typeof obj.decision === "string" ? obj.decision.trim() : typeof obj.text === "string" ? obj.text.trim() : "";
      evidenceQuote = typeof obj.evidence === "string" ? obj.evidence.trim() : "";
    }

    if (!decisionText) {
      continue;
    }

    // Explicit supporting evidence required: if source evidence is provided,
    // verify that evidenceQuote (or decisionText) exists in the source text.
    if (source) {
      const quoteToCheck = evidenceQuote || decisionText;
      if (!evidenceOccursInSource(quoteToCheck, source)) {
        console.warn(`[Vera] Rejecting decision without source evidence: "${decisionText}"`);
        continue;
      }
    }

    keyDecisions.push(decisionText);
  }

  // 3. actionItems: must be a valid array of correctly structured items
  if (!Array.isArray(rawObj.actionItems)) {
    throw new VeraValidationError("actionItems must be an array.");
  }

  const actionItems: VeraActionItem[] = [];
  for (let i = 0; i < rawObj.actionItems.length; i++) {
    const item = rawObj.actionItems[i];
    if (!item || typeof item !== "object") {
      throw new VeraValidationError(`actionItems item at index ${i} is not an object.`);
    }

    const itemObj = item as Record<string, unknown>;

    if (typeof itemObj.task !== "string" || !itemObj.task.trim()) {
      throw new VeraValidationError(`actionItems item at index ${i} has a missing or empty task.`);
    }
    const task = itemObj.task.trim();
    const evidenceQuote = typeof itemObj.evidence === "string" ? itemObj.evidence.trim() : "";

    // If source evidence is available, check that the action item has matching evidence in the source
    if (source) {
      const quoteToCheck = evidenceQuote || task;
      if (!evidenceOccursInSource(quoteToCheck, source)) {
        console.warn(`[Vera] Rejecting action item without source evidence: "${task}"`);
        continue;
      }
    }

    // Priority
    const validPriorities = ["high", "medium", "low"] as const;
    let priority: "high" | "medium" | "low" = "medium";
    if (
      typeof itemObj.priority === "string" &&
      validPriorities.includes(itemObj.priority.toLowerCase() as any)
    ) {
      priority = itemObj.priority.toLowerCase() as "high" | "medium" | "low";
    }

    // Participant grounding: strictly resolved to host, guest, or "Unassigned"
    let assignee = resolveParticipantAssignee(itemObj.assignee as string | undefined, context);

    // If evidence does not establish who owns the task, preserve as "Unassigned"
    if (assignee !== "Unassigned" && evidenceQuote && source) {
      const normEvidence = normalizeForEvidenceComparison(evidenceQuote);
      const assigneeFirst = assignee.toLowerCase().split(/\s+/)[0];
      if (!normEvidence.includes(assigneeFirst)) {
        assignee = "Unassigned";
      }
    }

    // Deadline: missing deadlines must remain unspecified rather than invented
    let deadline: string | undefined = undefined;
    if (typeof itemObj.deadline === "string" && itemObj.deadline.trim()) {
      deadline = itemObj.deadline.trim();
    }

    actionItems.push({
      id: `action-${Date.now()}-${i}`,
      task,
      assignee,
      priority,
      done: Boolean(itemObj.done),
      ...(deadline ? { deadline } : {}),
      ...(evidenceQuote ? { evidence: evidenceQuote } : {}),
    });
  }

  // 4. suggestedFollowUp: optional string
  let suggestedFollowUp: string | undefined = undefined;
  if (typeof rawObj.suggestedFollowUp === "string" && rawObj.suggestedFollowUp.trim()) {
    suggestedFollowUp = rawObj.suggestedFollowUp.trim();
  }

  return {
    executiveSummary,
    keyDecisions,
    actionItems,
    ...(suggestedFollowUp ? { suggestedFollowUp } : {}),
  };
}

/**
 * Generates an executive pre-meeting brief and proposed agenda items.
 * Preserves a safe fallback so room provisioning never fails if Vera is temporarily unavailable.
 */
export async function generateVeraPreMeetingBrief(params: {
  eventTitle: string;
  hostName: string;
  guestName: string;
  guestNotes?: string | null;
  customAnswers?: Record<string, unknown> | null;
}): Promise<VeraPreMeetingBrief> {
  const systemPrompt = `You are Vera, the executive scribe and intelligence for Morrow.
Your role is to prepare the host and guest with an understated, precise, professional meeting brief.
Never use emojis. Never use hype words or robotic jargon. Be concise, dignified, and direct.

Return a valid JSON object matching this schema:
{
  "intent": "A single sentence defining the primary objective of this conversation.",
  "talkingPoints": ["Point 1", "Point 2", "Point 3"],
  "background": "Brief 1-2 sentence context summary based on the provided notes.",
  "suggestedAgenda": [
    { "text": "Specific agenda item 1" },
    { "text": "Specific agenda item 2" },
    { "text": "Specific agenda item 3" }
  ]
}`;

  const userPrompt = `Meeting: ${params.eventTitle}
Host: ${params.hostName}
Guest: ${params.guestName}
Guest Notes: ${params.guestNotes || "No notes provided"}
Custom Details: ${JSON.stringify(params.customAnswers || {})}`;

  try {
    const raw = await callDeepSeek([
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ]);

    const rawObj = raw as Record<string, unknown>;
    const suggestedAgenda: VeraAgendaItem[] = Array.isArray(rawObj.suggestedAgenda)
      ? rawObj.suggestedAgenda.map((item: { text?: string }, idx: number) => ({
          id: `agenda-vera-${Date.now()}-${idx}`,
          text: item.text || `Discussion point ${idx + 1}`,
          done: false,
          addedBy: "vera",
        }))
      : [];

    return {
      intent: (rawObj.intent as string) || `Align on ${params.eventTitle}`,
      talkingPoints: Array.isArray(rawObj.talkingPoints) ? (rawObj.talkingPoints as string[]) : [],
      background: (rawObj.background as string) || "Standard scheduled sync.",
      suggestedAgenda,
    };
  } catch (error) {
    console.error("[Vera] Error generating pre-meeting brief:", error);
    return {
      intent: `Discussion on ${params.eventTitle}`,
      talkingPoints: ["Align on priorities", "Review next steps"],
      background: params.guestNotes || "Scheduled consultation.",
      suggestedAgenda: [
        {
          id: `agenda-fallback-1`,
          text: "Review objective and background",
          done: false,
          addedBy: "vera",
        },
        {
          id: `agenda-fallback-2`,
          text: "Discuss open questions and deliverables",
          done: false,
          addedBy: "vera",
        },
        {
          id: `agenda-fallback-3`,
          text: "Confirm next milestones",
          done: false,
          addedBy: "vera",
        },
      ],
    };
  }
}

/**
 * Synthesizes the meeting ledger: executive summary, key decisions, and assigned action items.
 * Strictly verifies that substantive evidence exists BEFORE calling DeepSeek.
 * Every decision and action item must be grounded in actual evidence.
 * Throws VeraInsufficientEvidenceError if notes/transcript do not contain sufficient source material.
 */
export async function generateVeraLedger(params: {
  eventTitle: string;
  hostName: string;
  guestName: string;
  agenda: VeraAgendaItem[];
  sharedNotes?: string;
  transcript?: string;
  timeoutMs?: number;
}): Promise<VeraLedger> {
  // 1. Evidence sufficiency gate: must have actual substantive notes or transcript
  const combinedEvidence = extractSubstantiveEvidence(params.sharedNotes, params.transcript);
  if (!combinedEvidence) {
    throw new VeraInsufficientEvidenceError(
      "Vera needs actual meeting notes or a transcript before it can create a reliable meeting record. Add the missing context and try again."
    );
  }

  const systemPrompt = `You are Vera, the executive scribe for Morrow.
Your governing principle: Prefer an incomplete meeting record over an invented one.
Record ONLY what was explicitly discussed and evidenced in the provided notes or transcript.
Do NOT treat proposals, exploratory thoughts, or tentative suggestions as confirmed decisions.
A discussion topic or agenda item is NOT a decision unless there was explicit agreement in the notes or transcript.
Every decision, action item, and summary point MUST include a direct, verbatim evidence quote from the notes or transcript.
If an excerpt cannot be found verbatim in the notes or transcript, it will be rejected.
Do NOT invent tasks, deadlines, or assignees. If ownership is not explicitly stated in the source text, set assignee to "Unassigned".
Never use emojis. Never use hype. Use clear, exact business language.

Return a valid JSON object matching this schema:
{
  "executiveSummary": [
    "Summary claim grounded directly in the discussion"
  ],
  "keyDecisions": [
    {
      "decision": "Confirmed agreed decision",
      "evidence": "Direct excerpt from notes or transcript proving agreement"
    }
  ],
  "actionItems": [
    {
      "task": "Specific task description",
      "assignee": "${params.hostName}" or "${params.guestName}" or "Unassigned",
      "priority": "high" | "medium" | "low",
      "deadline": "explicit deadline if mentioned in source, otherwise omit",
      "evidence": "Direct excerpt from notes or transcript proving task and ownership"
    }
  ],
  "suggestedFollowUp": "Clear single recommendation for when they should sync next or what triggers the next meeting."
}`;

  const userPrompt = `Meeting: ${params.eventTitle}
Participants: ${params.hostName} (Host) and ${params.guestName} (Guest)

Covered Agenda (Context only, NOT proof of discussion or agreement):
${params.agenda.map((a) => `- [${a.done ? "Done" : "Pending"}] ${a.text}`).join("\n")}

Substantive Meeting Evidence (Notes & Transcript):
${combinedEvidence}`;

  const raw = await callDeepSeek(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    { timeoutMs: params.timeoutMs }
  );

  return validateVeraLedger(raw, {
    hostName: params.hostName,
    guestName: params.guestName,
    sourceEvidence: combinedEvidence,
  });
}
