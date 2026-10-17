import { z } from "zod";
import { getLlm } from "@/lib/llm";
import { addDays, formatSpokenDate, todayISO } from "@/lib/dates";
import { documentRefSchema } from "@/lib/schemas";
import type { ToolResult } from "@/lib/types";
import { documentForPrompt } from "./explainDocument";
import { resolveDocument } from "./resolveDocument";

export const TONES = ["polite", "firm"] as const;
export type Tone = (typeof TONES)[number];

const draftSchema = z.object({
  subject: z.string().describe("Short email subject line"),
  body: z.string().describe("Letter/email body with greeting and sign-off, plain text"),
});

export const draftReplyOutput = draftSchema.extend({
  document: documentRefSchema,
  intent: z.string(),
  tone: z.enum(TONES),
});

const SYSTEM_PROMPT = `You write short replies (letters or emails) to companies and organizations on behalf of a household.
Rules:
- Reference the document's real numbers and dates (account, policy or notice numbers, amounts, due dates).
- Never invent facts, reasons, amounts or personal data: use placeholders like [Your name], [Your address], [Your phone].
- Keep it under 150 words. Plain text, no markdown. Write in English.
- Put a blank line between paragraphs and a space after every comma and period.`;

// What each tone means. Firm must read clearly different from polite, without threats.
const TONE_RULES: Record<Tone, (replyBy: string) => string> = {
  polite: () =>
    "Tone: polite and warm. Courteous, appreciative, friendly; it's fine to thank them for their understanding.",
  firm: (replyBy) =>
    `Tone: firm. Direct and businesslike:
- State the request plainly in the first sentence ("I am requesting...", "I need...").
- No apologies, no softeners: never write "kindly", "I hope", "I would be grateful", "if possible", "sorry", "please accept".
- Ask for a written answer by ${replyBy}, using that exact date.
- Stay respectful: no threats, no legal claims, no ultimatums, no invented consequences.`,
};

// Words that show a "firm" draft came out soft anyway.
const SOFT_PHRASES = /\b(kindly|i hope|would be (very )?grateful|if possible|sorry|apolog|please accept)/i;

export async function runDraftReply(input: {
  document_id?: string;
  query?: string;
  intent: string;
  tone?: Tone;
}): Promise<ToolResult<z.infer<typeof draftReplyOutput>>> {
  const doc = await resolveDocument(input);
  const tone = input.tone ?? "polite";

  const today = todayISO();
  const prompt =
    `Today's date: ${today}.\n\nDocument:\n${documentForPrompt(doc)}\n\n` +
    `${TONE_RULES[tone](formatSpokenDate(addDays(today, 7)))}\n\n` +
    `Write a ${tone} reply to ${doc.issuer}. Goal: ${input.intent}`;

  let draft = await getLlm().generateJson({ system: SYSTEM_PROMPT, prompt, schema: draftSchema });
  // Small models often slip back into polite phrasing: one retry with a reminder.
  if (tone === "firm" && SOFT_PHRASES.test(draft.body)) {
    draft = await getLlm().generateJson({
      system: SYSTEM_PROMPT,
      prompt: `${prompt}\n\nYour last draft was too soft. Rewrite it: direct, no apologies or softeners.`,
      schema: draftSchema,
    });
  }

  // A fixed, short sentence: voice assistants should never read the letter out loud.
  const text =
    tone === "firm"
      ? `Here's a firmer draft to ${doc.issuer}. Check it before you send it.`
      : `Here's a polite draft to ${doc.issuer}. Say "make it firmer" to change the tone.`;

  return {
    text,
    structuredContent: {
      document: { id: doc.id, title: doc.title, issuer: doc.issuer, type: doc.type },
      intent: input.intent,
      tone,
      subject: draft.subject.trim(),
      body: tidyLetter(draft.body),
    },
  };
}

// Fixes words glued together after punctuation ("Team,I", "date.We") and extra spaces.
function tidyLetter(body: string): string {
  return body
    .replace(/([,;])(?=[A-Za-z])/g, "$1 ")
    .replace(/([a-z])\.(?=[A-Z])/g, "$1. ")
    .replace(/[ \t]+$/gm, "")
    .trim();
}
