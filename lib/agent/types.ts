// Shapes shared by /api/chat and the Echo Show simulator page (no server-only imports here).

// One earlier exchange, sent back by the page so follow-ups like "make it firmer" work.
export interface ChatTurn {
  user: string;
  assistant: string;
  // documentId lets follow-ups ("what does this letter mean?") find the document.
  tools: { name: string; input: Record<string, unknown>; result: string; documentId?: string }[];
}

// What the screen shows next to the spoken answer. `data` is the tool's structuredContent.
export type CardKind = "deadlines" | "document" | "warranty" | "draft" | "explanation" | "matches";

export interface Card {
  kind: CardKind;
  data: Record<string, unknown>;
}

// How /api/chat chose the tool: Nova picked it ("model"), Nova was asked again requiring the
// keyword tool or any tool ("forced-keyword", "forced-any"), or the server called the keyword
// tool itself with default arguments ("server-default").
export type ChatRoute = "model" | "forced-keyword" | "forced-any" | "server-default";

export interface ChatResponse {
  reply: string;
  cards: Card[];
  turn: ChatTurn;
  // Only for questions answered by the agent (not direct tool calls).
  route?: ChatRoute;
  error?: boolean;
}

// Tools the page may call directly, without the model: the home screen's "Coming up"
// list, uploads (a model can't copy megabytes of base64 into a tool call) and the
// "Make it firmer" button (same document and intent, firm tone).
export const DIRECT_TOOLS = ["list_deadlines", "add_document", "draft_reply"] as const;
export type DirectTool = (typeof DIRECT_TOOLS)[number];

export const MAX_HISTORY_TURNS = 4;
export const MAX_MESSAGE_CHARS = 500;
