// Host allowlists shared by the internal token logic (lib/agent/mcpClient.ts) and the Host check
// on /api/mcp (app/api/mcp/route.ts).

// A host with an optional port: "localhost", "duly.vercel.app:443", "[::1]:3000". Group 1 is the
// hostname. Anything else (userinfo like "evil.com@localhost", paths, spaces) doesn't match.
const HOST_PATTERN = /^(\[[0-9a-f:.]+\]|[a-z0-9.-]+)(?::\d{1,5})?$/;

// Hostname of a lowercased "host[:port]" value, or undefined if it isn't a plain host.
function hostnameOf(host: string): string | undefined {
  return HOST_PATTERN.exec(host)?.[1];
}

// localhost and this deployment's own Vercel hosts (lowercased, without scheme or port).
export function ownHosts(): Set<string> {
  const hosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
  for (const value of [
    process.env.VERCEL_URL,
    process.env.VERCEL_BRANCH_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
  ]) {
    // These are bare hosts ("duly-git-main-team.vercel.app"), without a scheme.
    if (value) hosts.add(value.toLowerCase().replace(/^https?:\/\//, "").replace(/[:/].*$/, ""));
  }
  return hosts;
}

// Hosts /api/mcp answers on: ownHosts() plus the comma-separated MCP_ALLOWED_HOSTS (for a custom
// domain or a LAN IP). Entries may carry a scheme, a port or a path; only the hostname is kept.
export function allowedMcpHosts(): Set<string> {
  const hosts = ownHosts();
  for (const entry of (process.env.MCP_ALLOWED_HOSTS ?? "").split(",")) {
    const host = entry.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    const hostname = host ? hostnameOf(host) : undefined;
    if (hostname) hosts.add(hostname);
  }
  return hosts;
}

// 403 for a request whose Host header is missing, malformed or not in allowedMcpHosts(); undefined
// when the host is allowed. Only reads the header, never the body.
export function forbiddenHostResponse(req: Request): Response | undefined {
  // Host is case-insensitive: "Duly-Home.vercel.app" is the same host as "duly-home.vercel.app".
  const host = req.headers.get("host")?.trim().toLowerCase() ?? "";
  const hostname = hostnameOf(host);
  if (hostname && allowedMcpHosts().has(hostname)) return undefined;
  return Response.json(
    { jsonrpc: "2.0", id: null, error: { code: -32000, message: "Forbidden host." } },
    { status: 403 },
  );
}
