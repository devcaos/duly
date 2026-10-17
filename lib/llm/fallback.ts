import { LlmUnavailableError } from "./types";
import type { GenerateJsonRequest, LlmAdapter } from "./types";

export interface NamedLlm {
  name: string;
  // Created only when needed, so a missing API key never breaks the other provider.
  create: () => LlmAdapter;
}

// Uses the primary provider; if it is throttled, unavailable or times out, retries
// the same request with the fallback provider (when there is one). Logs who answered.
export class FallbackLlm implements LlmAdapter {
  private fallback: LlmAdapter | undefined;

  constructor(
    private primary: LlmAdapter,
    private primaryName: string,
    private fallbackProvider?: NamedLlm,
  ) {}

  async generateJson<T>(req: GenerateJsonRequest<T>): Promise<T> {
    try {
      const result = await this.primary.generateJson(req);
      console.info(`[llm] answered by ${this.primaryName}`);
      return result;
    } catch (error) {
      if (!this.fallbackProvider || !(error instanceof LlmUnavailableError)) throw error;
      console.warn(`[llm] ${this.primaryName} unavailable (${error.code}), retrying with ${this.fallbackProvider.name}`);
    }
    this.fallback ??= this.fallbackProvider.create();
    const result = await this.fallback.generateJson(req);
    console.info(`[llm] answered by ${this.fallbackProvider.name} (fallback)`);
    return result;
  }
}
