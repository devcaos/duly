import type { z } from "zod";

export type FileMimeType = "image/jpeg" | "image/png" | "application/pdf";

export interface LlmFile {
  base64: string;
  mimeType: FileMimeType;
}

export interface GenerateJsonRequest<T> {
  system: string;
  prompt: string;
  file?: LlmFile;
  // Used twice: sent to the model as a JSON schema, then used to validate its answer.
  schema: z.ZodType<T>;
  maxOutputTokens?: number;
}

// Every LLM backend (gemini, bedrock) implements this interface,
// so the tools never need to know which provider answers.
export interface LlmAdapter {
  generateJson<T>(req: GenerateJsonRequest<T>): Promise<T>;
}

// Error with a short message that is safe to speak back to the user.
export class LlmError extends Error {}

// The provider can't answer right now (throttling, service unavailable, timeout).
// Only this error makes the fallback provider retry the request.
export class LlmUnavailableError extends LlmError {
  constructor(
    message: string,
    readonly provider: string,
    readonly code: string,
  ) {
    super(message);
  }
}
