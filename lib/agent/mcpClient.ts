import { Client, ProtocolError, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import type { Tool } from "@modelcontextprotocol/client";

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
// stateless, so a connection never goes stale; connecting again costs 4 HTTP requests.
let connection: Promise<Connection> | undefined;
let connectedUrl: string | undefined;

async function connect(url: string): Promise<Connection> {
  const client = new Client({ name: "duly-echo-web", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(url)));
  const { tools } = await client.listTools();
  return { client, tools };
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
