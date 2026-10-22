import { formatSpokenDate, plainDollars } from "@/lib/dates";

// "fridge warranty ends" → "Fridge warranty ends": for sentences built from item names.
export function capitalizeFirst(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// Spoken replies must be 1-3 sentences (SPEC.md section 4).
// This is a safety net in case the model writes more.
export function limitSentences(text: string, max = 3): string {
  // Split after . ! or ? followed by a space, so "$84.20" stays in one piece.
  return text.trim().split(/(?<=[.!?])\s+/).slice(0, max).join(" ");
}

const ISO_DATE = /\b\d{4}-\d{2}-\d{2}\b/g;

// Safety filter for anything read aloud: removes internal ids, raw JSON and "(SAMPLE)", turns
// ISO dates into spoken dates ("October 17"; the year only when it isn't this year), fixes
// missing spaces between sentences ("Team,I"), writes "$45 USD" as "$45", starts every sentence
// with a capital letter, drops repeated sentences and keeps 1-3 sentences.
export function cleanSpoken(text: string, maxSentences = 3): string {
  let cleaned = stripJson(plainDollars(text).replace(/\(?\s*document_id\s*[:=]\s*[\w-]+\s*\)?/gi, " "))
    .replace(ISO_DATE, (iso) => formatSpokenDate(iso))
    // Sample documents are marked "(SAMPLE)" on screen; it isn't read aloud.
    .replace(/\s*\(SAMPLE\)/gi, "")
    .replace(/([,;:!?])(?=[A-Za-z])/g, "$1 ")
    .replace(/([a-z])\.(?=[A-Z])/g, "$1. ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();

  const seen = new Set<string>();
  const sentences = cleaned.split(/(?<=[.!?])\s+/).filter((sentence) => {
    const key = sentence.toLowerCase().replace(/[^a-z0-9$]+/g, "");
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  cleaned = sentences.slice(0, maxSentences).map(capitalizeFirst).join(" ");
  return cleaned;
}

// Removes JSON objects and arrays (anything in braces or brackets that holds a quoted key or
// value, or nothing at all), innermost first, so nested JSON goes away completely.
function stripJson(text: string): string {
  const json = /\{[^{}]*"[^{}]*\}|\[[^[\]]*"[^[\]]*\]|\{[\s,:]*\}|\[[\s,]*\]/g;
  let previous: string;
  let current = text;
  do {
    previous = current;
    current = current.replace(json, " ");
  } while (current !== previous);
  return current;
}
