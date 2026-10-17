import { Client, ProtocolError, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import type { Tool } from "@modelcontextprotocol/client";
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

interface Connection {
  client: Client;
  tools: Tool[];
}

// One connection per server instance, reused across requests. The Duly server is
// stateless, so a connection never goes stale.
let connection: Promise<Connection> | undefined;
let connectedUrl: string | undefined;

async function connect(url: string): Promise<Connection> {
  // "auto" speaks the 2026-07-28 protocol (one server/discover request instead of the
  // initialize handshake) and falls back to the 2025 handshake if the server is older.
  const client = new Client({ name: "duly-echo-web", version: "1.0.0" }, { versionNegotiation: { mode: "auto" } });
  // The internal token lets /api/mcp skip its per-IP limit: /api/chat limits each user itself.
  const token = canSendToken(url) ? internalToken() : undefined;
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: token ? { headers: { [INTERNAL_TOKEN_HEADER]: token } } : undefined,
  });
  await client.connect(transport);
  const { tools } = await client.listTools();
  return { client, tools };
}

// The default MCP URL comes from the request's Host header. On Vercel (which only routes our
// own domains here), on localhost or with an explicit MCP_URL that's safe; anywhere else a
// forged Host header could send the secret to another server, so it is not attached.
function canSendToken(url: string): boolean {
  if (process.env.MCP_URL || process.env.VERCEL === "1") return true;
  const { hostname } = new URL(url);
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function getConnection(url: string): Promise<Connection> {
  if (!connection || connectedUrl !== url) {
    connectedUrl = url;
    connection = connect(url);
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
async function withConnection<T>(url: string, fn: (c: Connection) => Promise<T>): Promise<T> {
  try {
    return await fn(await getConnection(url));
  } catch (error) {
    if (error instanceof ProtocolError) throw error;
    console.warn(`[chat] MCP call failed, reconnecting (${error instanceof Error ? error.message : error})`);
    await resetConnection();
    return fn(await getConnection(url));
  }
}

export function listMcpTools(url: string): Promise<Tool[]> {
  return withConnection(url, async (c) => c.tools);
}

export async function callMcpTool(
  url: string,
  name: string,
  input: Record<string, unknown>,
): Promise<ToolCallResult> {
  const result = await withConnection(url, (c) => c.client.callTool({ name, arguments: input }));
  const firstText = result.content.find((block) => block.type === "text");
  return {
    name,
    input,
    text: firstText?.type === "text" ? firstText.text : "",
    structuredContent: result.structuredContent as Record<string, unknown> | undefined,
    isError: result.isError === true,
  };
}
