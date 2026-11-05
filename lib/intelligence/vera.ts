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

const DEEPSEEK_API_URL = "https://api.deepseek.com/chat/completions";
const MODEL_NAME = process.env.DEEPSEEK_MODEL || "deepseek-chat";

async function callDeepSeek(messages: Array<{ role: "system" | "user" | "assistant"; content: string }>) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error("DEEPSEEK_API_KEY is not configured.");
  }

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
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => "");
    throw new Error(`DeepSeek API request failed (${res.status}): ${errorText}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("Empty response returned from DeepSeek API.");
  }

  return JSON.parse(content);
}

/**
 * Generates an executive pre-meeting brief and proposed agenda items.
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

    const suggestedAgenda: VeraAgendaItem[] = Array.isArray(raw.suggestedAgenda)
      ? raw.suggestedAgenda.map((item: { text?: string }, idx: number) => ({
          id: `agenda-vera-${Date.now()}-${idx}`,
          text: item.text || `Discussion point ${idx + 1}`,
          done: false,
          addedBy: "vera",
        }))
      : [];

    return {
      intent: raw.intent || `Align on ${params.eventTitle}`,
      talkingPoints: Array.isArray(raw.talkingPoints) ? raw.talkingPoints : [],
      background: raw.background || "Standard scheduled sync.",
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
 */
export async function generateVeraLedger(params: {
  eventTitle: string;
  hostName: string;
  guestName: string;
  agenda: VeraAgendaItem[];
  sharedNotes?: string;
  transcript?: string;
}): Promise<VeraLedger> {
  const systemPrompt = `You are Vera, the executive scribe for Morrow.
Your role is to record the definitive record of the meeting.
Extract clear decisions, concrete action items with explicit assignees (${params.hostName} or ${params.guestName}), and a disciplined executive summary.
Never use emojis. Never use hype. Use clear, exact business language.

Return a valid JSON object matching this schema:
{
  "executiveSummary": [
    "Summary sentence 1",
    "Summary sentence 2",
    "Summary sentence 3"
  ],
  "keyDecisions": [
    "Decision 1",
    "Decision 2"
  ],
  "actionItems": [
    {
      "task": "Specific task description",
      "assignee": "${params.hostName} or ${params.guestName}",
      "priority": "high" | "medium" | "low"
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

  try {
    const raw = await callDeepSeek([
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ]);

    const actionItems: VeraActionItem[] = Array.isArray(raw.actionItems)
      ? raw.actionItems.map((item: { task?: string; assignee?: string; priority?: "high" | "medium" | "low" }, idx: number) => ({
          id: `action-${Date.now()}-${idx}`,
          task: item.task || "Follow up on discussion",
          assignee: item.assignee || params.hostName,
          priority: item.priority || "medium",
          done: false,
        }))
      : [];

    return {
      executiveSummary: Array.isArray(raw.executiveSummary) ? raw.executiveSummary : [],
      keyDecisions: Array.isArray(raw.keyDecisions) ? raw.keyDecisions : [],
      actionItems,
      suggestedFollowUp: raw.suggestedFollowUp,
    };
  } catch (error) {
    console.error("[Vera] Error synthesizing ledger:", error);
    return {
      executiveSummary: [
        `Completed sync for ${params.eventTitle} between ${params.hostName} and ${params.guestName}.`,
        "Topics covered as outlined in the meeting agenda.",
      ],
      keyDecisions: ["Agreed to proceed with planned milestones."],
      actionItems: [
        {
          id: `action-fallback-1`,
          task: `Share relevant follow-up materials with ${params.guestName}`,
          assignee: params.hostName,
          priority: "medium",
          done: false,
        },
      ],
      suggestedFollowUp: "Schedule follow-up upon completion of initial action items.",
    };
  }
}
