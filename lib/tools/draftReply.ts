import { z } from "zod";
import { getLlm } from "@/lib/llm";
import { todayISO } from "@/lib/dates";
import type { Document, ToolResult } from "@/lib/types";
import { documentForPrompt } from "./explainDocument";
import { resolveDocument } from "./resolveDocument";

export type Tone = "polite" | "firm";

const draftSchema = z.object({
  subject: z.string().describe("Short email subject line"),
  body: z.string().describe("Letter/email body with greeting and sign-off, plain text"),
});

const SYSTEM_PROMPT = `You write short replies (letters or emails) to companies and organizations on behalf of a household.
Rules:
- Reference the document's real numbers and dates (account, policy or notice numbers, amounts, due dates).
- Never invent personal data: use placeholders like [Your name], [Your address], [Your phone].
- Keep it under 150 words, clear and respectful. Plain text, no markdown.
- Write in English.`;

export async function runDraftReply(input: {
  document_id?: string;
  query?: string;
  intent: string;
  tone?: Tone;
}): Promise<
  ToolResult<{
    document: Pick<Document, "id" | "title" | "issuer" | "type">;
    intent: string;
    tone: Tone;
    subject: string;
    body: string;
  }>
> {
  const doc = await resolveDocument(input);
  const tone = input.tone ?? "polite";

  const draft = await getLlm().generateJson({
    system: SYSTEM_PROMPT,
    prompt:
      `Today's date: ${todayISO()}.\n\nDocument:\n${documentForPrompt(doc)}\n\n` +
      `Write a ${tone} reply to ${doc.issuer}. Goal: ${input.intent}`,
    schema: draftSchema,
  });

  return {
    text: `Here's a ${tone} draft to ${doc.issuer} with the subject "${draft.subject}". Want me to change anything?`,
    structuredContent: {
      document: { id: doc.id, title: doc.title, issuer: doc.issuer, type: doc.type },
      intent: input.intent,
      tone,
      ...draft,
    },
  };
}
