import { GeminiLlm } from "./gemini";
import { LlmError } from "./types";
import type { LlmAdapter } from "./types";

export type { LlmAdapter, LlmFile, FileMimeType } from "./types";
export { LlmError } from "./types";

let instance: LlmAdapter | undefined;

// Picks the LLM backend from the LLM_PROVIDER env var ("gemini" for now).
export function getLlm(): LlmAdapter {
  if (instance) return instance;
  const provider = process.env.LLM_PROVIDER ?? "gemini";
  switch (provider) {
    case "gemini":
      instance = new GeminiLlm();
      break;
    case "bedrock":
      throw new LlmError('LLM_PROVIDER="bedrock" is not implemented yet. Use LLM_PROVIDER="gemini".');
    default:
      throw new LlmError(`Unknown LLM_PROVIDER "${provider}". Use "gemini" or "bedrock".`);
  }
  return instance;
}
