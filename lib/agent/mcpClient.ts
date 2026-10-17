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

// The MCP URL always uses the host of the incoming request (so Vercel Authentication on
// deployment URLs never gets in the way), but the secret is only attached for hosts that are
// certainly ours: this deployment's own Vercel hosts, localhost, or an explicitly set MCP_URL.
// Any other host, including other *.vercel.app hosts, gets the request without the token.
export function canSendToken(url: string): boolean {
  const host = new URL(url).hostname.toLowerCase();
  const allowed = new Set(["localhost", "127.0.0.1", "[::1]"]);
  for (const value of [
    process.env.VERCEL_URL,
    process.env.VERCEL_BRANCH_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
  ]) {
    // These are bare hosts ("duly-git-main-team.vercel.app"), without a scheme.
    if (value) allowed.add(value.toLowerCase().replace(/^https?:\/\//, "").replace(/[:/].*$/, ""));
  }
  if (process.env.MCP_URL) allowed.add(new URL(process.env.MCP_URL).hostname.toLowerCase());
  return allowed.has(host);
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
