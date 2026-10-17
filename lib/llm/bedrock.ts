import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import type { ContentBlock, ToolInputSchema } from "@aws-sdk/client-bedrock-runtime";
import { z } from "zod";
import { awsRegion } from "@/lib/aws";
import { LlmError, LlmUnavailableError } from "./types";
import type { GenerateJsonRequest, LlmAdapter, LlmFile } from "./types";

const DEFAULT_MODEL = "eu.amazon.nova-2-lite-v1:0";
const TOOL_NAME = "return_result";

// Errors that mean "Bedrock can't answer right now": the fallback provider may retry.
const UNAVAILABLE_ERRORS = new Set(["ThrottlingException", "ServiceQuotaExceededException", "AccessDeniedException"]);

// Amazon Bedrock Converse API (default model: Amazon Nova 2 Lite).
// Nova 2 Lite doesn't support Bedrock "structured outputs", so we use the pattern from the
// Nova docs: one tool whose input schema is the answer format, and force the model to call it.
export class BedrockLlm implements LlmAdapter {
  private client: BedrockRuntimeClient;
  private model: string;

  constructor() {
    // Only 2 attempts, so a throttled request falls back to Gemini quickly.
    this.client = new BedrockRuntimeClient({ region: awsRegion(), maxAttempts: 2 });
    this.model = process.env.BEDROCK_MODEL_ID || DEFAULT_MODEL;
  }

  async generateJson<T>(req: GenerateJsonRequest<T>): Promise<T> {
    const jsonSchema: Record<string, unknown> = z.toJSONSchema(req.schema);
    delete jsonSchema.$schema; // Bedrock only needs the schema itself.

    const content: ContentBlock[] = [{ text: req.prompt }, ...(req.file ? [fileBlock(req.file)] : [])];

    // Try twice: small models sometimes return JSON that doesn't match the schema.
    let lastError: unknown;
    for (let attempt = 1; attempt <= 2; attempt++) {
      let output: unknown;
      try {
        const response = await this.client.send(
          new ConverseCommand({
            modelId: this.model,
            system: [{ text: req.system }],
            messages: [{ role: "user", content }],
            toolConfig: {
              tools: [
                {
                  toolSpec: {
                    name: TOOL_NAME,
                    description: "Return the result in the required format.",
                    inputSchema: { json: jsonSchema } as ToolInputSchema,
                  },
                },
              ],
              toolChoice: { tool: { name: TOOL_NAME } },
            },
            inferenceConfig: { temperature: 0, maxTokens: req.maxOutputTokens ?? 2048 },
          }),
        );
        output = response.output?.message?.content?.find((block) => block.toolUse)?.toolUse?.input;
      } catch (error) {
        const name = error instanceof Error ? error.name : "UnknownError";
        console.error(`Bedrock request failed (${name}):`, error instanceof Error ? error.message : error);
        if (UNAVAILABLE_ERRORS.has(name)) {
          throw new LlmUnavailableError("The AI service is busy right now. Please try again in a moment.", "bedrock", name);
        }
        throw new LlmError("I couldn't reach the AI service. Please try again in a moment.");
      }

      try {
        return req.schema.parse(output);
      } catch (error) {
        lastError = error;
        console.warn(`Bedrock returned invalid JSON (attempt ${attempt}).`);
      }
    }
    console.error("Bedrock JSON validation failed:", lastError);
    throw new LlmError("The AI service returned an answer I couldn't understand. Please try again.");
  }
}

// Image or PDF content block. Bedrock wants the raw bytes, not base64.
function fileBlock(file: LlmFile): ContentBlock {
  const bytes = Buffer.from(file.base64, "base64");
  if (file.mimeType === "application/pdf") {
    // A neutral name: Bedrock warns the model may read the name as instructions.
    return { document: { format: "pdf", name: "document", source: { bytes } } };
  }
  return { image: { format: file.mimeType === "image/png" ? "png" : "jpeg", source: { bytes } } };
}
