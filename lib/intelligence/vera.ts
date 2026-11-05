export interface VeraAgendaItem {
  id: string;
  text: string;
  done: boolean;
  addedBy: "host" | "guest" | "vera";
}

export interface VeraSummaryClaim {
  claim: string;
  evidence: string;
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

export interface VeraDecision {
  decision: string;
  status: "confirmed" | "proposed" | "open_question";
  evidence: string;
}

export interface VeraLedger {
  executiveSummary: Array<VeraSummaryClaim | string>;
  actionItems: VeraActionItem[];
  keyDecisions: Array<VeraDecision | string>;
  suggestedFollowUp?: string;
  reviewStatus?: "pending_host_review" | "approved";
  approvedAt?: string;
  approvedBy?: string;
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

const STOP_WORDS = new Set([
  "a", "about", "above", "after", "again", "against", "all", "am", "an", "and", "any", "are",
  "as", "at", "be", "because", "been", "before", "being", "below", "between", "both", "but",
  "by", "can", "cannot", "could", "did", "do", "does", "doing", "down", "during", "each",
  "few", "for", "from", "further", "had", "has", "have", "having", "he", "her", "here",
  "hers", "herself", "him", "himself", "his", "how", "i", "if", "in", "into", "is", "it",
  "its", "itself", "let", "me", "more", "most", "my", "myself", "no", "nor", "not", "of",
  "off", "on", "once", "only", "or", "other", "ought", "our", "ours", "ourselves", "out",
  "over", "own", "same", "she", "should", "so", "some", "such", "than", "that", "the",
  "their", "theirs", "them", "themselves", "then", "there", "these", "they", "this", "those",
  "through", "to", "too", "under", "until", "up", "very", "was", "we", "were", "what",
  "when", "where", "which", "while", "who", "whom", "why", "with", "would", "you", "your",
  "yours", "yourself", "yourselves", "standard", "scheduled", "meeting", "call", "discussion",
  "notes", "agenda", "completed", "outlined", "conversation", "sync", "team", "today", "yesterday",
  "tomorrow"
]);

/**
 * Extracts non-trivial content words from text for semantic overlap checks.
 */
export function extractContentKeywords(text: string): string[] {
  const norm = normalizeForEvidenceComparison(text);
  return norm.split(/\s+/).filter((w) => w.length >= 3 && !STOP_WORDS.has(w));
}

function getWordStems(word: string): string[] {
  const stems = [word];
  if (word.endsWith("ed") && word.length > 4) stems.push(word.slice(0, -2));
  if (word.endsWith("ing") && word.length > 5) stems.push(word.slice(0, -3));
  if (word.endsWith("es") && word.length > 4) stems.push(word.slice(0, -2));
  if (word.endsWith("s") && word.length > 3) stems.push(word.slice(0, -1));
  return stems;
}

/**
 * Verifies that a source excerpt actually pertains to the claim / decision / task,
 * rather than being an unrelated quote that happens to exist in the source text.
 */
export function isEvidenceRelevantToClaim(claim: string, evidence: string): boolean {
  if (!claim || !evidence) return false;
  const claimWords = extractContentKeywords(claim);
  const evidenceNorm = normalizeForEvidenceComparison(evidence);

  if (claimWords.length === 0) {
    const claimNorm = normalizeForEvidenceComparison(claim);
    return claimNorm.length > 0 && evidenceNorm.includes(claimNorm);
  }

  // Count how many significant claim keywords (or their base stems) appear in the evidence
  let matchingWords = 0;
  for (const word of claimWords) {
    const stems = getWordStems(word);
    if (stems.some((s) => evidenceNorm.includes(s))) {
      matchingWords++;
    }
  }

  // At least 1 significant content word if short, or at least 25% of content words
  const minRequired = Math.max(1, Math.ceil(claimWords.length * 0.25));
  return matchingWords >= minRequired;
}

/**
 * Safely escapes characters in a string for inclusion in regular expressions.
 */
export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Verifies that a decision represents an explicitly confirmed agreement,
 * rejecting tentative proposals, exploratory ideas, open questions,
 * and negated or contradictory language.
 */
export function isConfirmedDecision(decision: string, evidence: string, status?: string): boolean {
  if (!status || status.trim().toLowerCase() !== "confirmed") {
    return false;
  }

  const normDecision = normalizeForEvidenceComparison(decision);
  const normEvidence = normalizeForEvidenceComparison(evidence);

  // Check for negative, contradictory, qualified, or refusal language:
  // e.g. "We did not agree...", "cannot proceed", "have not finalized", "not moving"
  const negationPatterns = /\b(not|did\s+not|didn't|do\s+not|don't|does\s+not|doesn't|cannot|can't|cant|won't|wont|will\s+not|never|no\b|neither|refused|refuse|refuses|rejected|reject|rejects|opposed|oppose|against|haven't|have\s+not|hasn't|has\s+not|unresolved|undecided|yet)\b/i;

  if (negationPatterns.test(decision) || negationPatterns.test(evidence)) {
    return false;
  }

  // Proposal, speculative, conditional, or tentative language without definitive consensus
  const proposalPatterns = /\b(propose|proposed|proposal|suggest|suggested|suggestion|consider|considering|might|could|tentative|tentatively|maybe|perhaps|tbd|discuss\s+further|open\s+question|remains\s+open|\?)\b/i;

  if (proposalPatterns.test(normDecision) || proposalPatterns.test(normEvidence)) {
    return false;
  }

  return true;
}

/**
 * Verifies that an action item's evidence excerpt establishes active ownership or commitment,
 * rather than merely mentioning the participant's name or speaker tag in passing.
 * Distinguishes direct commitments from passive discussion, refusals, and unassigned mentions.
 */
export function verifyAssigneeOwnership(
  assigneeName: string,
  evidence: string
): boolean {
  if (!assigneeName || assigneeName === "Unassigned") return false;
  const trimmedEvidence = evidence.trim();
  const normEvidence = normalizeForEvidenceComparison(trimmedEvidence);
  const firstName = assigneeName.trim().toLowerCase().split(/\s+/)[0];
  const safeFirst = escapeRegex(firstName);
  const safeFull = escapeRegex(assigneeName.trim());

  // Participant name must occur in evidence
  if (
    !new RegExp(`\\b${safeFirst}\\b`, "i").test(trimmedEvidence) &&
    !new RegExp(`\\b${safeFull}\\b`, "i").test(trimmedEvidence)
  ) {
    return false;
  }

  // 1. Explicit refusal or negation check:
  // e.g. "Sarah: I cannot take responsibility...", "Sarah cannot...", "Sarah will not...", "not me", "still unassigned"
  const refusalPatterns = [
    new RegExp(`\\b${safeFirst}\\s*:\\s*.*\\b(cannot|can't|cant|will\\s+not|won't|wont|am\\s+unable|refuse|not\\s+me|not\\s+taking|not\\s+responsible|unassigned)\\b`, "i"),
    new RegExp(`\\b${safeFirst}\\s+(cannot|can't|cant|will\\s+not|won't|wont|refuses|is\\s+not\\s+responsible|is\\s+not\\s+handling)\\b`, "i"),
    new RegExp(`\\b(not\\s+assigned\\s+to|cannot\\s+assign\\s+to)\\s+${safeFirst}\\b`, "i"),
  ];
  if (refusalPatterns.some((pattern) => pattern.test(trimmedEvidence))) {
    return false;
  }

  // 2. Speaker label with explicit first-person commitment:
  // "Sarah: I will...", "Sarah: I'll...", "Sarah: Let me...", "Sarah: I can take/handle...", "Sarah: I commit to..."
  // Note: A speaker label alone like "Sarah: We discussed..." or "Sarah: The migration is..." does NOT commit.
  const speakerCommitment = new RegExp(
    `\\b${safeFirst}\\s*:\\s*(i\\s+will|i'll|let\\s+me|i\\s+shall|i\\s+can\\s+(take|handle|do|lead)|i\\s+(commit|take|handle|volunteer))\\b`,
    "i"
  );
  if (speakerCommitment.test(trimmedEvidence)) {
    return true;
  }

  // 3. Third-person affirmative assignment patterns:
  // "Sarah will handle...", "Sarah to deploy...", "assigned to Sarah", "action item for Sarah", "Sarah is responsible for..."
  const thirdPersonAssignment = [
    new RegExp(`\\b${safeFirst}\\s+(will|shall|to|agreed\\s+to|committed\\s+to|commits\\s+to|is\\s+handling|handles|taking|takes|volunteered\\s+to)\\b`, "i"),
    new RegExp(`\\b(assigned\\s+to|action\\s+item\\s+for|ownership\\s+by|responsible\\s+for)\\s+(:\\s*)?${safeFirst}\\b`, "i"),
  ];

  return thirdPersonAssignment.some((pattern) => pattern.test(normEvidence));
}

/**
 * Validates that an action item deadline is grounded in the source notes or transcript,
 * requiring contiguous source phrasing and rejecting scattered or invented timestamps.
 */
export function verifyDeadlineGrounding(
  deadline: string,
  evidence: string,
  source: string
): string | undefined {
  if (!deadline || typeof deadline !== "string") return undefined;
  const trimmed = deadline.trim();
  if (!trimmed) return undefined;

  const normDeadline = normalizeForEvidenceComparison(trimmed);
  const normEvidence = normalizeForEvidenceComparison(evidence);
  const normSource = normalizeForEvidenceComparison(source);

  // 1. Exact contiguous normalized match in evidence or source
  if (normEvidence.includes(normDeadline) || normSource.includes(normDeadline)) {
    return trimmed;
  }

  // 2. Exact match stripped of leading temporal prepositions (e.g. "by Thursday afternoon" -> "Thursday afternoon")
  const stripped = normDeadline.replace(/^(by|before|on|at|due|for)\s+/, "").trim();
  if (stripped.length >= 3 && (normEvidence.includes(stripped) || normSource.includes(stripped))) {
    return trimmed;
  }

  return undefined;
}

/**
 * Normalizes an executive summary claim for reading, preserving backward compatibility
 * with previously saved plain strings.
 */
export function normalizeExecutiveSummaryClaim(
  item: string | VeraSummaryClaim
): { claim: string; evidence?: string } {
  if (typeof item === "string") {
    return { claim: item };
  }
  return { claim: item.claim, evidence: item.evidence };
}

/**
 * Normalizes a key decision item for reading, preserving backward compatibility
 * with previously saved plain strings.
 */
export function normalizeDecisionItem(
  item: string | VeraDecision
): { decision: string; status: "confirmed" | "proposed" | "open_question"; evidence?: string } {
  if (typeof item === "string") {
    return { decision: item, status: "confirmed" };
  }
  return item;
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
  context: {
    hostName: string;
    guestName: string;
    sourceEvidence?: string;
    sharedNotes?: string;
    transcript?: string;
  }
): VeraLedger {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new VeraValidationError("Model output is not a valid JSON object.");
  }

  const rawObj = raw as Record<string, unknown>;
  const source =
    context.sourceEvidence ||
    [context.sharedNotes, context.transcript].filter(Boolean).join("\n") ||
    "";

  // 1. executiveSummary: newly generated output must contain { claim, evidence } objects with verifiable evidence
  if (!Array.isArray(rawObj.executiveSummary) || rawObj.executiveSummary.length === 0) {
    throw new VeraValidationError("executiveSummary must be a non-empty array.");
  }

  const executiveSummary: VeraSummaryClaim[] = [];
  for (let i = 0; i < rawObj.executiveSummary.length; i++) {
    const item = rawObj.executiveSummary[i];

    // Reject plain strings without evidence (newly generated output requires inspectable evidence)
    if (typeof item === "string") {
      console.warn(`[Vera] Rejecting plain string summary claim without evidence at index ${i}: "${item}"`);
      continue;
    }

    if (!item || typeof item !== "object") {
      continue;
    }

    const obj = item as Record<string, unknown>;
    const claim = typeof obj.claim === "string" ? obj.claim.trim() : typeof obj.text === "string" ? obj.text.trim() : "";
    const evidence = typeof obj.evidence === "string" ? obj.evidence.trim() : "";

    // Reject missing claim or missing evidence
    if (!claim || !evidence) {
      console.warn(`[Vera] Rejecting summary claim missing claim or evidence at index ${i}`);
      continue;
    }

    // Check evidence occurs in source
    if (source && !evidenceOccursInSource(evidence, source)) {
      console.warn(`[Vera] Rejecting summary claim whose evidence is absent from source: "${claim}"`);
      continue;
    }

    // Check that evidence is actually relevant to the claim (not an unrelated source excerpt)
    if (!isEvidenceRelevantToClaim(claim, evidence)) {
      console.warn(`[Vera] Rejecting summary claim because evidence does not support the claim: "${claim}"`);
      continue;
    }

    executiveSummary.push({ claim, evidence });
  }

  if (executiveSummary.length === 0) {
    throw new VeraValidationError("No executive summary claims could be verified against the supplied meeting evidence.");
  }

  // 2. keyDecisions: newly generated output must contain structured VeraDecision objects
  if (!Array.isArray(rawObj.keyDecisions)) {
    throw new VeraValidationError("keyDecisions must be an array.");
  }

  const keyDecisions: VeraDecision[] = [];
  for (let i = 0; i < rawObj.keyDecisions.length; i++) {
    const item = rawObj.keyDecisions[i];

    // Reject plain strings from newly generated model output
    if (typeof item === "string") {
      console.warn(`[Vera] Rejecting plain-string decision without evidence at index ${i}: "${item}"`);
      continue;
    }

    if (!item || typeof item !== "object") {
      continue;
    }

    const obj = item as Record<string, unknown>;
    const decisionText = typeof obj.decision === "string" ? obj.decision.trim() : typeof obj.text === "string" ? obj.text.trim() : "";
    const evidenceQuote = typeof obj.evidence === "string" ? obj.evidence.trim() : "";

    // Reject missing or invalid status. NEVER default missing status to confirmed!
    const rawStatus = typeof obj.status === "string" ? obj.status.trim().toLowerCase() : "";
    if (!rawStatus || !["confirmed", "proposed", "open_question"].includes(rawStatus)) {
      console.warn(`[Vera] Rejecting decision with missing or invalid status at index ${i}: "${decisionText}"`);
      continue;
    }

    if (!decisionText || !evidenceQuote) {
      continue;
    }

    // Only confirmed decisions enter the confirmed collection
    if (rawStatus !== "confirmed") {
      console.warn(`[Vera] Rejecting non-confirmed decision (${rawStatus}): "${decisionText}"`);
      continue;
    }

    // Check whether excerpt or decision language is negative, qualified, or tentative
    if (!isConfirmedDecision(decisionText, evidenceQuote, rawStatus)) {
      console.warn(`[Vera] Rejecting unconfirmed, negative, or tentative decision: "${decisionText}"`);
      continue;
    }

    // Explicit supporting evidence required in source
    if (source) {
      if (!evidenceOccursInSource(evidenceQuote, source)) {
        console.warn(`[Vera] Rejecting decision without source evidence: "${decisionText}"`);
        continue;
      }

      // Check evidence relevance: an unrelated quote cannot prove a decision
      if (!isEvidenceRelevantToClaim(decisionText, evidenceQuote)) {
        console.warn(`[Vera] Rejecting decision because evidence is unrelated: "${decisionText}"`);
        continue;
      }
    }

    keyDecisions.push({
      decision: decisionText,
      status: "confirmed",
      evidence: evidenceQuote,
    });
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

      // Check evidence relevance: an unrelated quote cannot prove an action item
      if (!isEvidenceRelevantToClaim(task, quoteToCheck)) {
        console.warn(`[Vera] Rejecting action item because evidence is unrelated: "${task}"`);
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

    // Verify ownership: evidence must establish that this person takes/owns the task,
    // not merely contain the person's name casually in passing
    if (assignee !== "Unassigned" && evidenceQuote) {
      const hasOwnership = verifyAssigneeOwnership(assignee, evidenceQuote);
      if (!hasOwnership) {
        assignee = "Unassigned";
      }
    }

    // Deadline: must be grounded in source evidence, not invented
    let deadline: string | undefined = undefined;
    if (typeof itemObj.deadline === "string" && itemObj.deadline.trim()) {
      deadline = verifyDeadlineGrounding(itemObj.deadline, evidenceQuote, source);
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
    {
      "claim": "Direct summary claim grounded strictly in the discussion",
      "evidence": "Direct verbatim excerpt from notes or transcript proving this claim"
    }
  ],
  "keyDecisions": [
    {
      "decision": "Explicitly agreed, confirmed decision",
      "status": "confirmed", // Note: Set to "confirmed" ONLY if participants explicitly agreed. Use "proposed" or "open_question" for unresolved topics.
      "evidence": "Direct verbatim excerpt from notes or transcript proving agreement"
    }
  ],
  "actionItems": [
    {
      "task": "Specific task description",
      "assignee": "${params.hostName}" or "${params.guestName}" or "Unassigned",
      "priority": "high" | "medium" | "low",
      "deadline": "exact wording used in source if mentioned (e.g. 'by Friday'), otherwise omit",
      "evidence": "Direct verbatim excerpt from notes or transcript proving task and ownership"
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

  const validated = validateVeraLedger(raw, {
    hostName: params.hostName,
    guestName: params.guestName,
    sourceEvidence: combinedEvidence,
  });

  return {
    ...validated,
    reviewStatus: "pending_host_review",
  };
}
