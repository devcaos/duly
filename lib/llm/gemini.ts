import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { LlmError } from "./types";
import type { GenerateJsonRequest, LlmAdapter } from "./types";

const DEFAULT_MODEL = "gemini-3.5-flash-lite";

// Gemini via the Interactions API (@google/genai v2).
export class GeminiLlm implements LlmAdapter {
  private client: GoogleGenAI;
  private model: string;

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new LlmError("GEMINI_API_KEY is not set in .env.local.");
    }
    this.client = new GoogleGenAI({ apiKey });
    this.model = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  }

  async generateJson<T>(req: GenerateJsonRequest<T>): Promise<T> {
    const jsonSchema: Record<string, unknown> = z.toJSONSchema(req.schema);
    delete jsonSchema.$schema; // Gemini only needs the schema itself.

    const input = [
      { type: "text" as const, text: req.prompt },
      ...(req.file
        ? [
            req.file.mimeType === "application/pdf"
              ? { type: "document" as const, data: req.file.base64, mime_type: req.file.mimeType }
              : { type: "image" as const, data: req.file.base64, mime_type: req.file.mimeType },
          ]
        : []),
    ];

    // Try twice: small models sometimes return JSON that doesn't match the schema.
    let lastError: unknown;
    for (let attempt = 1; attempt <= 2; attempt++) {
      let outputText: string | undefined;
      try {
        const interaction = await this.client.interactions.create({
          model: this.model,
          system_instruction: req.system,
          input,
          store: false,
          response_format: { type: "text", mime_type: "application/json", schema: jsonSchema },
          generation_config: {
            thinking_level: "low",
            max_output_tokens: req.maxOutputTokens ?? 2048,
          },
        });
        outputText = interaction.output_text;
      } catch (error) {
        console.error("Gemini request failed:", error instanceof Error ? error.message : error);
        throw new LlmError("I couldn't reach the AI service. Please try again in a moment.");
      }

      try {
        return req.schema.parse(JSON.parse(outputText ?? ""));
      } catch (error) {
        lastError = error;
        console.warn(`Gemini returned invalid JSON (attempt ${attempt}).`);
      }
    }
    console.error("Gemini JSON validation failed:", lastError);
    throw new LlmError("The AI service returned an answer I couldn't understand. Please try again.");
  }
}
