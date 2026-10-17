import { AwsStorage } from "./aws";
import { MemoryStorage } from "./memory";
import type { StorageAdapter } from "./types";

export type { StorageAdapter } from "./types";

// Single demo household (no auth in the hackathon demo, see SPEC.md section 4).
export const HOUSEHOLD_ID = "demo";

let instance: StorageAdapter | undefined;

// Picks the storage backend from the STORAGE env var ("memory" by default).
export function getStorage(): StorageAdapter {
  if (instance) return instance;
  const kind = process.env.STORAGE ?? "memory";
  switch (kind) {
    case "memory":
      instance = new MemoryStorage();
      break;
    case "aws":
      instance = new AwsStorage();
      break;
    default:
      throw new Error(`Unknown STORAGE "${kind}". Use "memory" or "aws".`);
  }
  return instance;
}
