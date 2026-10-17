// Spoken replies must be 1-3 sentences (SPEC.md section 4).
// This is a safety net in case the model writes more.
export function limitSentences(text: string, max = 3): string {
  // Split after . ! or ? followed by a space, so "$84.20" stays in one piece.
  return text.trim().split(/(?<=[.!?])\s+/).slice(0, max).join(" ");
}
