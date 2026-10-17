import { BedrockLlm } from "./bedrock";
import { FallbackLlm } from "./fallback";
import type { NamedLlm } from "./fallback";
import { GeminiLlm } from "./gemini";
import type { LlmAdapter } from "./types";

export type { LlmAdapter, LlmFile, FileMimeType } from "./types";
export { LlmError } from "./types";

const PROVIDERS: Record<string, NamedLlm> = {
  bedrock: { name: "bedrock", create: () => new BedrockLlm() },
  gemini: { name: "gemini", create: () => new GeminiLlm() },
};

let instance: LlmAdapter | undefined;

// Picks the LLM backend from the LLM_PROVIDER env var ("gemini" by default).
// LLM_FALLBACK (optional) names a second provider that answers when the first one
// is throttled, unavailable or times out, e.g. LLM_PROVIDER=bedrock + LLM_FALLBACK=gemini.
// It never covers access or validation errors: those mean the setup is wrong.
export function getLlm(): LlmAdapter {
  if (instance) return instance;
  const primary = findProvider("LLM_PROVIDER", process.env.LLM_PROVIDER ?? "gemini");
  const fallbackName = process.env.LLM_FALLBACK;
  const fallback = fallbackName ? findProvider("LLM_FALLBACK", fallbackName) : undefined;
  instance = new FallbackLlm(primary.create(), primary.name, fallback === primary ? undefined : fallback);
  return instance;
}

function findProvider(envVar: string, name: string): NamedLlm {
  const provider = PROVIDERS[name];
  // A plain Error, not an LlmError: configuration details go to the server log only,
  // tool callers just get the generic "Something went wrong" message.
  if (!provider) throw new Error(`Unknown ${envVar} "${name}". Use "gemini" or "bedrock".`);
  return provider;
}
