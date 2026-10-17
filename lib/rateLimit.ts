import { timingSafeEqual } from "node:crypto";

// Basic per-IP rate limiting (SPEC.md section 4: demo mitigations).
// The counters live in memory, so they are per server instance: each Vercel
// instance has its own counters and they reset when the instance restarts.
// That's acceptable for the demo; a shared store would be needed for production.

const WINDOW_MS = 60_000;
const MAX_TRACKED_KEYS = 10_000;

// key ("<bucket>:<ip>") -> timestamps of recent hits
const hits = new Map<string, number[]>();

function readLimit(envName: string, fallback: number): number {
  const value = Number.parseInt(process.env[envName] ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

// All requests to /api/mcp, per IP per minute.
export function requestLimitPerMinute(): number {
  return readLimit("RATE_LIMIT_PER_MIN", 30);
}

// Calls to tools that use the LLM, per IP per minute.
export function llmLimitPerMinute(): number {
  return readLimit("LLM_RATE_LIMIT_PER_MIN", 10);
}

// On Vercel these headers are set by the platform, which overwrites any
// client-supplied X-Forwarded-For to prevent IP spoofing
// (https://vercel.com/docs/headers/request-headers). Locally they can be faked,
// which is fine for testing.
export function getClientIp(req?: Request): string {
  const first = (name: string) => req?.headers.get(name)?.split(",")[0]?.trim();
  return first("x-vercel-forwarded-for") || first("x-forwarded-for") || first("x-real-ip") || "unknown";
}

// Records one hit and returns false if the limit for this minute is exceeded.
export function allowRequest(bucket: string, ip: string, limit: number): boolean {
  const now = Date.now();
  if (hits.size > MAX_TRACKED_KEYS) removeExpired(now);

  const key = `${bucket}:${ip}`;
  const recent = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= limit) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  return true;
}

function removeExpired(now: number) {
  for (const [key, times] of hits) {
    if (times.every((t) => now - t >= WINDOW_MS)) hits.delete(key);
  }
}

// Header that the demo web's /api/chat sends on its own calls to /api/mcp. /api/chat already
// rate-limits each user by their real IP, so those internal calls skip the per-IP limits here
// (otherwise every visitor would share the server's own IP bucket).
export const INTERNAL_TOKEN_HEADER = "x-duly-internal-token";
const MIN_TOKEN_CHARS = 16;

export function internalToken(): string | undefined {
  const token = process.env.DULY_INTERNAL_TOKEN;
  return token && token.length >= MIN_TOKEN_CHARS ? token : undefined;
}

// True only when DULY_INTERNAL_TOKEN is set and the request carries exactly that value.
export function isInternalRequest(req?: Request): boolean {
  const expected = internalToken();
  const received = req?.headers.get(INTERNAL_TOKEN_HEADER);
  if (!expected || !received) return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  // Constant-time comparison, so the token can't be guessed one character at a time.
  return a.length === b.length && timingSafeEqual(a, b);
}
