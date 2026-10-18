import { z } from "zod";
import { getLlm } from "@/lib/llm";
import { todayISO } from "@/lib/dates";
import { documentRefSchema } from "@/lib/schemas";
import { limitSentences } from "@/lib/speech";
import type { Document, ToolResult } from "@/lib/types";
import { resolveDocument } from "./resolveDocument";

export const DISCLAIMER = "Duly explains documents but does not give legal or financial advice.";
const SPOKEN_DISCLAIMER = "This isn't legal advice.";

const explanationSchema = z.object({
  spokenAnswer: z.string().describe("1-2 short sentences to be read aloud, answering the question"),
  explanation: z.string().describe("Plain-language explanation of the document"),
  consequencesOfInaction: z.string().describe("What happens if the household ignores it"),
  recommendedNextStep: z.string().describe("One concrete next step"),
  legalOrFinancial: z.boolean().describe("True if the topic involves legal or financial risk"),
});

export const explainDocumentOutput = explanationSchema.extend({
  document: documentRefSchema,
  question: z.string(),
  disclaimer: z.string().optional(),
});

const SYSTEM_PROMPT = `You explain household paperwork in plain, friendly English to a non-expert.
Rules:
- Base everything on the document data given. Never invent amounts, dates or rules.
- Consequences (consequencesOfInaction and spokenAnswer) must come from the document data, e.g. "the fine goes up to $90 after the deadline". Never add consequences it doesn't state, such as collection actions, court, credit scores or extra fees. If the data says nothing about what happens, say the document doesn't say and suggest asking the issuer.
- spokenAnswer is for voice: at most 2 short sentences, no lists, no markdown.
- Do not give legal advice. Explain, and recommend contacting the issuer or a professional when appropriate.`;

export async function runExplainDocument(input: {
  document_id?: string;
  query?: string;
  issuer?: string;
  question?: string;
}): Promise<ToolResult<z.infer<typeof explainDocumentOutput>>> {
  // With nothing else to go on, the question itself ("explain the parking fine letter") is the search.
  const hasReference = input.document_id || input.query || input.issuer;
  const doc = await resolveDocument(hasReference ? input : { query: input.question });
  const question = input.question ?? "What does this document mean and what should I do?";

  const result = await getLlm().generateJson({
    system: SYSTEM_PROMPT,
    prompt: `Today's date: ${todayISO()}.\n\nDocument:\n${documentForPrompt(doc)}\n\nQuestion: ${question}`,
    schema: explanationSchema,
  });

  const needsDisclaimer =
    result.legalOrFinancial || ["official_letter", "contract", "insurance"].includes(doc.type);
  const spoken = limitSentences(result.spokenAnswer, needsDisclaimer ? 2 : 3);

  return {
    text: needsDisclaimer ? `${spoken} ${SPOKEN_DISCLAIMER}` : spoken,
    structuredContent: {
      document: { id: doc.id, title: doc.title, issuer: doc.issuer, type: doc.type },
      question,
      ...result,
      disclaimer: needsDisclaimer ? DISCLAIMER : undefined,
    },
  };
}

// The stored document as JSON, without fields the LLM doesn't need.
export function documentForPrompt(doc: Document): string {
  const hidden = new Set(["householdId", "fileKey", "createdAt"]);
  return JSON.stringify(doc, (key, value) => (hidden.has(key) ? undefined : value), 2);
}
