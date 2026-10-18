import { PollyClient, SynthesizeSpeechCommand } from "@aws-sdk/client-polly";
import type { VoiceId } from "@aws-sdk/client-polly";
import { z } from "zod";
import { awsRegion, summarizeError } from "@/lib/aws";
import { allowRequest, getClientIp } from "@/lib/rateLimit";

// Spoken replies for the Echo Show simulator, with an Amazon Polly neural voice.
// When Polly fails, the page falls back to the browser's speechSynthesis.

const DEFAULT_VOICE = "Joanna"; // neural, en-US
// Spoken replies are 1-3 short sentences (Polly bills per character).
const MAX_TEXT_CHARS = 600;
// Request body size we accept: the text plus a little JSON around it.
const MAX_BODY_CHARS = 4_000;
// Requests per IP per minute: about one per answer, with room for retries.
const SPEAK_LIMIT_PER_MIN = 20;

const bodySchema = z.object({ text: z.string().trim().min(1).max(MAX_TEXT_CHARS) });

let polly: PollyClient | undefined;

export async function POST(req: Request): Promise<Response> {
  if (!allowRequest("speak", getClientIp(req), SPEAK_LIMIT_PER_MIN)) {
    return Response.json({ error: "Too many requests." }, { status: 429 });
  }
  // Check the declared size first so a huge body is never read into memory.
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_CHARS) {
    return Response.json({ error: "Text too long." }, { status: 413 });
  }
  const raw = await req.text();
  if (raw.length > MAX_BODY_CHARS) return Response.json({ error: "Text too long." }, { status: 413 });
  let json: unknown = null;
  try {
    json = JSON.parse(raw);
  } catch {
    // Invalid JSON: answered as an invalid request below.
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return Response.json({ error: "Invalid request." }, { status: 400 });

  try {
    polly ??= new PollyClient({ region: awsRegion(), maxAttempts: 2 });
    const result = await polly.send(
      new SynthesizeSpeechCommand({
        Engine: "neural",
        LanguageCode: "en-US",
        OutputFormat: "mp3",
        Text: parsed.data.text,
        VoiceId: (process.env.POLLY_VOICE_ID || DEFAULT_VOICE) as VoiceId,
      }),
    );
    if (!result.AudioStream) throw new Error("Polly returned no audio.");
    const audio = await result.AudioStream.transformToByteArray();
    return new Response(Buffer.from(audio), {
      headers: { "Content-Type": result.ContentType ?? "audio/mpeg", "Cache-Control": "no-store" },
    });
  } catch (error) {
    // 503 tells the page to use the browser voice instead.
    console.error(`[speak] Polly failed (${summarizeError(error)})`);
    return Response.json({ error: "Speech is unavailable right now." }, { status: 503 });
  }
}
