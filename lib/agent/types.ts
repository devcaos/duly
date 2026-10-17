// Shapes shared by /api/chat and the Echo Show simulator page (no server-only imports here).

// One earlier exchange, sent back by the page so follow-ups like "make it firmer" work.
export interface ChatTurn {
  user: string;
  assistant: string;
  tools: { name: string; input: Record<string, unknown>; result: string }[];
}

// What the screen shows next to the spoken answer. `data` is the tool's structuredContent.
export type CardKind = "deadlines" | "document" | "warranty" | "draft" | "explanation" | "matches";

export interface Card {
  kind: CardKind;
  data: Record<string, unknown>;
}

export interface ChatResponse {
  reply: string;
  cards: Card[];
  turn: ChatTurn;
  error?: boolean;
}

// Tools the page may call directly, without the model: the home screen's "Coming up"
// list, and uploads (a model can't copy megabytes of base64 into a tool call).
export const DIRECT_TOOLS = ["list_deadlines", "add_document"] as const;
export type DirectTool = (typeof DIRECT_TOOLS)[number];

export const MAX_HISTORY_TURNS = 4;
export const MAX_MESSAGE_CHARS = 500;
