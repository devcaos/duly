import { z } from "zod";
import { getLlm } from "@/lib/llm";
import { addDays, formatLongDate, formatMoney, todayISO } from "@/lib/dates";
import { documentRefSchema } from "@/lib/schemas";
import type { Document, ToolResult } from "@/lib/types";
import { documentForPrompt } from "./explainDocument";
import { resolveDocument } from "./resolveDocument";

export const TONES = ["polite", "firm"] as const;
export type Tone = (typeof TONES)[number];

// What the model writes. The greeting and sign-off are added by the server, so they are
// always there and always the same.
const draftSchema = z.object({
  subject: z.string().describe("Short email subject line"),
  body: z
    .string()
    .describe("Only the paragraphs between the greeting and the sign-off: no 'Dear ...', no 'Sincerely', no name"),
});

// What the tool returns: `body` is the complete letter, greeting and sign-off included.
export const draftReplyOutput = draftSchema.extend({
  document: documentRefSchema,
  intent: z.string(),
  tone: z.enum(TONES),
});

const SIGN_OFF = "Sincerely,\n[Your name]";

const SYSTEM_PROMPT = `You write short replies (letters or emails) to companies and organizations on behalf of a household.
Rules:
- Use only facts, figures, dates and reference numbers that are in the document data. Never state a reason, complaint, fact or figure that isn't there, and don't propose new amounts or time periods.
- To push back or question a charge, ask for a review and an itemized breakdown. Don't claim errors or give reasons.
- Use reference numbers exactly as listed, with the label they have (an account number is never a bill or invoice number).
- Write dates like "October 5, 2026", never as YYYY-MM-DD.
- body: only the paragraphs. No greeting ("Dear ...") and no sign-off ("Sincerely", your name): they are added automatically.
- Never invent personal data: use placeholders like [Your address] or [Your phone] if needed.
- Under 120 words. Plain text, no markdown, English. A blank line between paragraphs.`;

// What each tone means. Firm must read clearly different from polite, without threats.
const TONE_RULES: Record<Tone, (replyBy: string) => string> = {
  polite: (replyBy) =>
    `Tone: polite and warm. Courteous and appreciative; it's fine to thank them. You may ask for a reply by ${replyBy}.`,
  firm: (replyBy) =>
    `Tone: firm. Direct and businesslike:
- State the request plainly in the first sentence ("I am requesting...", "I need...").
- No apologies or softeners: never write "kindly", "I hope", "I would be grateful", "if possible", "sorry".
- Ask for a written answer by ${replyBy}, using that exact date.
- Stay respectful: no threats, no legal claims, no ultimatums, no invented consequences.`,
};

interface Reference {
  label: string; // "Account number"
  value: string; // "BW-4471-2209"
}

interface Draft {
  subject: string;
  body: string;
}

export async function runDraftReply(input: {
  document_id?: string;
  query?: string;
  issuer?: string;
  intent: string;
  tone?: Tone;
}): Promise<ToolResult<z.infer<typeof draftReplyOutput>>> {
  const doc = await resolveDocument(input);
  const tone = input.tone ?? "polite";
  const today = todayISO();
  const replyBy = formatLongDate(addDays(today, 7));
  const references = findReferences(doc);

  const referenceList =
    references.length > 0
      ? `Reference numbers in this document (use each only with this label; there are no others):\n` +
        references.map((ref) => `- ${ref.label}: ${ref.value}`).join("\n")
      : "This document has no reference numbers: don't mention any.";
  const prompt =
    `Today's date: ${formatLongDate(today)}.\n\nDocument:\n${documentForPrompt(doc)}\n\n${referenceList}\n\n` +
    `${TONE_RULES[tone](replyBy)}\n\nWrite a ${tone} reply to ${doc.issuer}. Goal: ${input.intent}`;
  // Every figure the letter may contain comes from here.
  const allowedNumbers = numbersIn(`${documentForPrompt(doc)} ${input.intent} ${replyBy} ${formatLongDate(today)}`);

  let draft = normalize(await getLlm().generateJson({ system: SYSTEM_PROMPT, prompt, schema: draftSchema }));
  let problems = findProblems(draft, allowedNumbers, references);
  if (problems.length > 0) {
    // One retry, telling the model exactly what was wrong.
    console.warn(`[draft_reply] retrying: ${problems.length} problem(s) in the first draft`);
    const feedback = `Your previous draft had these problems:\n${problems.map((p) => `- ${p}`).join("\n")}\nRewrite it and fix them.`;
    draft = normalize(
      await getLlm().generateJson({ system: SYSTEM_PROMPT, prompt: `${prompt}\n\n${feedback}`, schema: draftSchema }),
    );
    problems = findProblems(draft, allowedNumbers, references);
  }
  if (problems.length > 0) {
    // Still wrong: send a plain letter built only from the document data instead.
    console.warn(`[draft_reply] using the template letter: ${problems.length} problem(s) after the retry`);
    draft = templateDraft(doc, input.intent, tone, references, replyBy);
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
      subject: draft.subject,
      body: `Dear ${doc.issuer},\n\n${draft.body}\n\n${SIGN_OFF}`,
    },
  };
}

// ---------- Reference numbers ----------

const LABELS: [RegExp, string][] = [
  [/^account/i, "Account number"],
  [/^policy/i, "Policy number"],
  [/^notice/i, "Notice number"],
  [/^receipt/i, "Receipt number"],
  [/^invoice/i, "Invoice number"],
  [/^bill/i, "Bill number"],
  [/^member/i, "Member ID"],
  [/^reference|^ref/i, "Reference number"],
  [/^order/i, "Order number"],
  [/^case/i, "Case number"],
];
const LABEL_WORDS = "account|policy|notice|receipt|invoice|bill|member(?:ship)?|reference|ref|order|case";
// "Account BW-4471-2209", "Policy NM-88213", "receipt number HH-55021", "Member ID PF-7730"
const REFERENCE = new RegExp(
  `\\b(${LABEL_WORDS})(?:\\s+(?:number|no\\.?|id|#))?\\s*:?\\s*([A-Z]{1,5}-[A-Z0-9-]*\\d[A-Z0-9-]*)`,
  "gi",
);

function labelFor(word: string): string | undefined {
  return LABELS.find(([pattern]) => pattern.test(word))?.[1];
}

// Labeled reference numbers in the document text, first label wins for each number.
function findReferences(doc: Document): Reference[] {
  const text = [doc.rawText, doc.summary, ...doc.actionItems].join("\n");
  const found = new Map<string, Reference>();
  for (const match of text.matchAll(REFERENCE)) {
    const label = labelFor(match[1]);
    const value = match[2].replace(/-+$/, "");
    if (label && !found.has(value)) found.set(value, { label, value });
  }
  return [...found.values()];
}

// ---------- Validation ----------

// Numbers as values ("84.20" and "84.2" are the same; commas ignored).
function numbersIn(text: string): Set<string> {
  const numbers = new Set<string>();
  for (const match of text.replace(/(\d),(\d)/g, "$1$2").matchAll(/\d+(?:\.\d+)?/g)) {
    numbers.add(String(Number(match[0])));
  }
  return numbers;
}

// Only two checks, both objective: figures that aren't in the data, and reference numbers
// written with the wrong label.
function findProblems(draft: Draft, allowedNumbers: Set<string>, references: Reference[]): string[] {
  const text = `${draft.subject}\n${draft.body}`;
  const problems: string[] = [];

  const unknown = [...numbersIn(text)].filter((n) => !allowedNumbers.has(n));
  if (unknown.length > 0) {
    problems.push(`It contains figures that are not in the document data: ${unknown.join(", ")}. Remove them.`);
  }

  for (const ref of references) {
    let index = text.indexOf(ref.value);
    while (index !== -1) {
      // The last label word written just before the number.
      const before = text.slice(Math.max(0, index - 30), index);
      const words = [...before.matchAll(new RegExp(`\\b(${LABEL_WORDS})\\b`, "gi"))];
      const written = words.length > 0 ? labelFor(words[words.length - 1][1]) : undefined;
      if (written && written !== ref.label) {
        problems.push(`${ref.value} is the ${ref.label.toLowerCase()}, not a ${written.toLowerCase()}.`);
        break;
      }
      index = text.indexOf(ref.value, index + ref.value.length);
    }
  }
  return problems;
}

// ---------- Formatting ----------

const ISO_DATE = /\b\d{4}-\d{2}-\d{2}\b/g;
const GREETING = /^\s*(dear|hello|hi|to whom)\b[^\n]*\n+/i;
const SIGN_OFF_LINE =
  /\n\s*(sincerely|regards|kind regards|best regards|best|yours (?:truly|sincerely|faithfully)|thank you|thanks|respectfully)\s*[,.!]?\s*(\n[\s\S]*)?$/i;

// Dates in words, no greeting or sign-off from the model, and words glued after punctuation
// ("Team,I", "date.We") separated.
function normalize(draft: Draft): Draft {
  const tidy = (text: string) =>
    text
      .replace(ISO_DATE, (iso) => formatLongDate(iso))
      .replace(/([,;])(?=[A-Za-z])/g, "$1 ")
      .replace(/([a-z])\.(?=[A-Z])/g, "$1. ")
      .replace(/[ \t]+$/gm, "")
      .trim();
  const body = tidy(draft.body).replace(GREETING, "").replace(SIGN_OFF_LINE, "").trim();
  return { subject: tidy(draft.subject).replace(/\s+/g, " "), body };
}

// ---------- Fallback ----------

// A plain letter for this intent and tone, built only from the document data
// (issuer, labeled references, amount, dates and the requested reply date).
function templateDraft(doc: Document, intent: string, tone: Tone, references: Reference[], replyBy: string): Draft {
  const goal = intent.trim().replace(/^to\s+/i, "").replace(/[.!]+$/, "");
  const title = doc.title.replace(/\s*\(SAMPLE\)/i, "");
  const refs = references.map((ref) => `${ref.label} ${ref.value}`).join(", ");
  const about = refs ? `${title} (${refs})` : title;

  const deadline = [...doc.deadlines].sort((a, b) => a.date.localeCompare(b.date)).find((d) => d.amount !== undefined);
  const amount = deadline?.amount ?? doc.amount;
  const currency = deadline?.currency ?? doc.currency;
  const amountSentence =
    amount === undefined
      ? ""
      : ` It shows ${formatMoney(amount, currency)}${deadline ? ` with a deadline of ${formatLongDate(deadline.date)}` : ""}.`;

  const capitalized = goal.charAt(0).toUpperCase() + goal.slice(1);
  const body =
    tone === "firm"
      ? `I am writing to ${goal} regarding ${about}.${amountSentence}\n\n` +
        `Please review the account and send me an itemized breakdown of the amount.\n\n` +
        `Please reply in writing by ${replyBy}.`
      : `I am writing to ${goal} regarding ${about}.${amountSentence}\n\n` +
        `Could you please let me know what options are available?\n\n` +
        `Thank you for your help. I would appreciate a reply by ${replyBy}.`;
  return { subject: `${capitalized}: ${about}`, body };
}
