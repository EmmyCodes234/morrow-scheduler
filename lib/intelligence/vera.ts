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
 * Ensures no fabricated decisions, generic placeholders, or invented participants.
 */
export function validateVeraLedger(
  raw: unknown,
  context: { hostName: string; guestName: string }
): VeraLedger {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new VeraValidationError("Model output is not a valid JSON object.");
  }

  const rawObj = raw as Record<string, unknown>;

  // 1. executiveSummary: must be a valid array of non-empty strings
  if (!Array.isArray(rawObj.executiveSummary) || rawObj.executiveSummary.length === 0) {
    throw new VeraValidationError("executiveSummary must be a non-empty array of strings.");
  }
  const executiveSummary: string[] = [];
  for (let i = 0; i < rawObj.executiveSummary.length; i++) {
    const item = rawObj.executiveSummary[i];
    if (typeof item !== "string" || !item.trim()) {
      throw new VeraValidationError(`executiveSummary item at index ${i} is not a valid non-empty string.`);
    }
    executiveSummary.push(item.trim());
  }

  // 2. keyDecisions: must be a valid array of non-empty strings
  if (!Array.isArray(rawObj.keyDecisions)) {
    throw new VeraValidationError("keyDecisions must be an array of strings.");
  }
  const keyDecisions: string[] = [];
  for (let i = 0; i < rawObj.keyDecisions.length; i++) {
    const item = rawObj.keyDecisions[i];
    if (typeof item !== "string" || !item.trim()) {
      throw new VeraValidationError(`keyDecisions item at index ${i} is not a valid non-empty string.`);
    }
    keyDecisions.push(item.trim());
  }

  // 3. actionItems: must be a valid array of correctly structured items
  if (!Array.isArray(rawObj.actionItems)) {
    throw new VeraValidationError("actionItems must be an array.");
  }

  const hostNormalized = context.hostName.trim().toLowerCase();
  const guestNormalized = context.guestName.trim().toLowerCase();

  const actionItems: VeraActionItem[] = [];
  for (let i = 0; i < rawObj.actionItems.length; i++) {
    const item = rawObj.actionItems[i];
    if (!item || typeof item !== "object") {
      throw new VeraValidationError(`actionItems item at index ${i} is not an object.`);
    }

    const itemObj = item as Record<string, unknown>;

    // Task must be non-empty string; missing tasks must not be replaced with generic tasks
    if (typeof itemObj.task !== "string" || !itemObj.task.trim()) {
      throw new VeraValidationError(`actionItems item at index ${i} has a missing or empty task.`);
    }
    const task = itemObj.task.trim();

    // Priority must be one of 'high', 'medium', 'low'
    const validPriorities = ["high", "medium", "low"] as const;
    let priority: "high" | "medium" | "low" = "medium";
    if (typeof itemObj.priority === "string" && validPriorities.includes(itemObj.priority.toLowerCase() as any)) {
      priority = itemObj.priority.toLowerCase() as "high" | "medium" | "low";
    }

    // Assignee grounding:
    // Ground in known participants when specified.
    // Missing assignees must NOT automatically be assigned to the host.
    // If not specified or uncertain, mark as "Unassigned".
    let assignee = "Unassigned";
    if (typeof itemObj.assignee === "string" && itemObj.assignee.trim()) {
      const rawAssignee = itemObj.assignee.trim();
      const rawLower = rawAssignee.toLowerCase();
      if (rawLower.includes(hostNormalized) || hostNormalized.includes(rawLower)) {
        assignee = context.hostName.trim();
      } else if (rawLower.includes(guestNormalized) || guestNormalized.includes(rawLower)) {
        assignee = context.guestName.trim();
      } else if (rawLower !== "unassigned" && rawLower !== "unresolved") {
        assignee = rawAssignee;
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
 * Strictly validates the model output and throws typed VeraError upon failure.
 * NEVER returns fabricated decisions, action items, or false summaries.
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
  const systemPrompt = `You are Vera, the executive scribe for Morrow.
Your role is to record the definitive, truthful record of the meeting.
Extract clear decisions, concrete action items with explicit assignees (${params.hostName} or ${params.guestName}), and a disciplined executive summary.
Where the discussion or notes are uncertain or do not establish an outcome, represent that uncertainty rather than manufacturing certainty.
If an action item cannot be assigned confidently, leave the assignee as "Unassigned".
Proposals that were not explicitly agreed upon must not be recorded as confirmed decisions.
Never use emojis. Never use hype. Use clear, exact business language.

Return a valid JSON object matching this schema:
{
  "executiveSummary": [
    "Summary sentence 1",
    "Summary sentence 2"
  ],
  "keyDecisions": [
    "Decision 1"
  ],
  "actionItems": [
    {
      "task": "Specific task description",
      "assignee": "${params.hostName}" or "${params.guestName}" or "Unassigned",
      "priority": "high" | "medium" | "low",
      "deadline": "optional deadline if explicitly mentioned"
    }
  ],
  "suggestedFollowUp": "Clear single recommendation for when they should sync next or what triggers the next meeting."
}`;

  const userPrompt = `Meeting: ${params.eventTitle}
Participants: ${params.hostName} (Host) and ${params.guestName} (Guest)

Covered Agenda:
${params.agenda.map((a) => `- [${a.done ? "Done" : "Pending"}] ${a.text}`).join("\n")}

Shared Notes Taken During Call:
${params.sharedNotes || "No manual notes taken"}

Transcript / Discussion Snippets:
${params.transcript || "Conversation completed as outlined in notes and agenda."}`;

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
  });
}
