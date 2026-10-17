import type { FileMimeType } from "@/lib/llm";
import { ToolError } from "@/lib/tools/resolveDocument";

// 3 MB decoded ≈ 4 MB base64, under Vercel's 4.5 MB request body limit (SPEC.md section 4).
export const MAX_FILE_BYTES = 3 * 1024 * 1024;

// Standard base64 only: no spaces, no "data:" prefix, correct "=" padding.
const BASE64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

// The first bytes ("magic bytes") of each file type.
const SIGNATURES: Record<FileMimeType, { label: string; bytes: number[] }> = {
  "image/jpeg": { label: "a JPEG image", bytes: [0xff, 0xd8, 0xff] },
  "image/png": { label: "a PNG image", bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  "application/pdf": { label: "a PDF", bytes: [0x25, 0x50, 0x44, 0x46, 0x2d] }, // "%PDF-"
};

// Decodes the file and checks it really is the type it claims to be.
export function decodeFile(base64: string, mimeType: FileMimeType): Buffer {
  if (base64.length === 0 || !BASE64_RE.test(base64)) {
    throw new ToolError("The file isn't valid base64. Please send it again.");
  }
  const bytes = Buffer.from(base64, "base64");
  if (bytes.length > MAX_FILE_BYTES) {
    throw new ToolError("That file is too big. The limit is 3 MB.");
  }
  const signature = SIGNATURES[mimeType];
  if (!signature.bytes.every((byte, i) => bytes[i] === byte)) {
    throw new ToolError(`That file doesn't look like ${signature.label}. Please check the file type.`);
  }
  return bytes;
}
