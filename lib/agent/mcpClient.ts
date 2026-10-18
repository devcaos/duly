import { Client, ProtocolError, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import type { Tool } from "@modelcontextprotocol/client";
import { ownHosts } from "@/lib/hosts";
import { INTERNAL_TOKEN_HEADER, internalToken } from "@/lib/rateLimit";

// The demo web talks to Duly exactly like Alexa+ would: as an MCP client of our own
// /api/mcp endpoint, over Streamable HTTP, with the official MCP TypeScript SDK.

export interface ToolCallResult {
  name: string;
  input: Record<string, unknown>;
  // The short spoken sentence (first text block of the MCP result).
  text: string;
  structuredContent?: Record<string, unknown>;
  isError: boolean;
}

// Where to connect and whether this call may carry the internal token (see canSendToken).
export interface McpTarget {
  url: string;
  sendToken: boolean;
}

interface Connection {
  client: Client;
  tools: Tool[];
}

// One connection per server instance, reused across requests. The Duly server is
// stateless, so a connection never goes stale.
let connection: Promise<Connection> | undefined;
let connectedKey: string | undefined;

async function connect({ url, sendToken }: McpTarget): Promise<Connection> {
  // "auto" speaks the 2026-07-28 protocol (one server/discover request instead of the
  // initialize handshake) and falls back to the 2025 handshake if the server is older.
  const client = new Client({ name: "duly-echo-web", version: "1.0.0" }, { versionNegotiation: { mode: "auto" } });
  // The internal token lets /api/mcp skip its per-IP limit: /api/chat limits each user itself.
  const token = sendToken ? internalToken() : undefined;
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: token ? { headers: { [INTERNAL_TOKEN_HEADER]: token } } : undefined,
  });
  await client.connect(transport);
  const { tools } = await client.listTools();
  return { client, tools };
}

// The token is a secret, so it is only attached when the MCP server is certainly this same
// deployment: the target host must equal the host of the incoming request AND be one of this
// deployment's own Vercel hosts or localhost. An MCP_URL that points anywhere else, and any other
// *.vercel.app host, gets the request without the token.
export function canSendToken(targetUrl: string, requestUrl: string): boolean {
  const target = new URL(targetUrl);
  if (target.host.toLowerCase() !== new URL(requestUrl).host.toLowerCase()) return false;
  // ownHosts() on purpose, not allowedMcpHosts(): MCP_ALLOWED_HOSTS never receives the token.
  return ownHosts().has(target.hostname.toLowerCase());
}

function getConnection(target: McpTarget): Promise<Connection> {
  // The token decision is part of the key, so a connection with the token is never reused
  // for a call that must go without it.
  const key = `${target.url}|${target.sendToken}`;
  if (!connection || connectedKey !== key) {
    connectedKey = key;
    connection = connect(target);
    // A failed connection must not be cached.
    connection.catch(() => {
      connection = undefined;
    });
  }
  return connection;
}

// Drops the cached connection so the next call reconnects.
async function resetConnection() {
  const old = connection;
  connection = undefined;
  await old?.then((c) => c.client.close()).catch(() => {});
}

// Runs fn with a connected client. If the transport fails (e.g. the server restarted),
// reconnects once and tries again. A JSON-RPC error from the server is not retried.
async function withConnection<T>(target: McpTarget, fn: (c: Connection) => Promise<T>): Promise<T> {
  try {
    return await fn(await getConnection(target));
  } catch (error) {
    if (error instanceof ProtocolError) throw error;
    console.warn(`[chat] MCP call failed, reconnecting (${error instanceof Error ? error.message : error})`);
    await resetConnection();
    return fn(await getConnection(target));
  }
}

export function listMcpTools(target: McpTarget): Promise<Tool[]> {
  return withConnection(target, async (c) => c.tools);
}

export async function callMcpTool(
  target: McpTarget,
  name: string,
  input: Record<string, unknown>,
): Promise<ToolCallResult> {
  const result = await withConnection(target, (c) => c.client.callTool({ name, arguments: input }));
  const firstText = result.content.find((block) => block.type === "text");
  return {
    name,
    input,
    text: firstText?.type === "text" ? firstText.text : "",
    structuredContent: result.structuredContent as Record<string, unknown> | undefined,
    isError: result.isError === true,
  };
}
