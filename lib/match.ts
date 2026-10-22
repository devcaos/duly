import { tokenize } from "@/lib/search";
import type { Document } from "@/lib/types";

// Does a document match the item a question names ("car insurance", "PeakFit", "fridge")?
// Stricter than search: every word that names the item must be in the document, so
// "home insurance" never matches the car insurance and "coffee machine" never the washing machine.

// Words that ask about an item without naming it: "when does my stuff renew?" names nothing.
const FILLER = new Set(
  (
    "when what which where how long left until does did will is are was were be have has get got need " +
    "next upcoming due date dates day days renew renews renewed renewal renewals renewing expire expires expired " +
    "expiring expiry end ends ending pay paying payment payments owe deadline deadlines bill bills this month week " +
    "year today tomorrow still under warranty warranties guarantee covered stuff thing things anything something " +
    "everything mine all any coming soon later"
  ).split(" "),
);

// Words that name the same kind of thing ("auto insurance policy" is the car insurance).
const SYNONYMS: string[][] = [
  ["car", "auto", "vehicle", "motor"],
  ["fridge", "refrigerator"],
  ["tv", "television"],
  ["washer", "washing"],
  ["laptop", "computer", "notebook"],
  ["gym", "fitness"],
  ["electricity", "electric", "power", "energy"],
  ["phone", "mobile", "cell"],
  ["internet", "broadband", "wifi"],
  ["home", "house", "homeowners"],
  ["fine", "ticket", "penalty", "citation", "violation"],
  ["membership", "subscription"],
];

// Words that say which kind of item a document is about, when they come right before one of the
// ITEM_NOUNS: "home insurance", "phone bill", "fridge warranty" (but not "phone number").
// "fine" is left out: it is also an adjective ("is this letter fine?").
const TYPE_WORDS = new Set([
  ...SYNONYMS.flat().filter((word) => word !== "fine"),
  ..."life health pet travel dental renters gas water dishwasher".split(" "),
]);
const ITEM_NOUNS = new Set(
  (
    "insurance policy policies bill bills warranty warranties receipt letter notice plan contract membership " +
    "subscription coverage statement renewal invoice account service"
  ).split(" "),
);

const synonymsOf = (word: string) => SYNONYMS.find((group) => group.includes(word)) ?? [word];
// "renewals" matches "renewal", "bills" matches "bill".
const singular = (word: string) => (word.length > 3 && word.endsWith("s") ? word.slice(0, -1) : word);

// Lowercase words, where "auto-renewal" means automatic, not car: it never matches "car insurance".
function words(text: string): string[] {
  return tokenize(text.replace(/\bauto[-\s]?(renew)/gi, "$1"));
}

// The words of a question or filter that name an item (none for "when is my next payment due?").
export function itemWords(text: string): string[] {
  return words(text).filter((word) => !FILLER.has(word));
}

function documentWords(doc: Document): Set<string> {
  const fields = [
    doc.title,
    doc.issuer,
    doc.product ?? "",
    doc.type.replace("_", " "),
    doc.summary,
    ...doc.deadlines.map((d) => d.description),
  ];
  return new Set(words(fields.join(" ")).map(singular));
}

// Same word, a synonym or the singular. With `prefix`, words of 4+ letters also match the start
// of a longer word ("renew" finds "renewal"), but "car" never matches "card".
function hasWord(words: Set<string>, word: string, prefix: boolean): boolean {
  return synonymsOf(word).some((candidate) => {
    const wanted = singular(candidate);
    if (words.has(wanted)) return true;
    return prefix && wanted.length >= 4 && [...words].some((w) => w.startsWith(wanted));
  });
}

// True when every item word of `query` is in the document (also when it names no item).
// Two words written apart can match one ("dish washer" finds "dishwasher").
export function matchesItem(doc: Document, query: string): boolean {
  const item = itemWords(query);
  const fields = documentWords(doc);
  for (let i = 0; i < item.length; i++) {
    if (i + 1 < item.length && hasWord(fields, item[i] + item[i + 1], true)) {
      i++;
      continue;
    }
    if (!hasWord(fields, item[i], true)) return false;
  }
  return true;
}

// Words in `text` that say which kind of item it is about and that the document doesn't have:
// "my home insurance letter" against the car insurance gives ["home"]. Whole words only.
export function conflictingTypeWords(doc: Document, text: string): string[] {
  const fields = documentWords(doc);
  const all = words(text);
  return all.filter(
    (word, i) => TYPE_WORDS.has(word) && ITEM_NOUNS.has(all[i + 1] ?? "") && !hasWord(fields, word, false),
  );
}
