# Friction log

One entry per problem with an Amazon/AWS/MCP tool, SDK or doc. Write it when it happens; polish it on Friday.
(Devpost: submissions with friction logs can earn up to a 10% judging bonus.)

## Template

### [Short title]
- **Tool / API / SDK:**
- **Task I attempted:**
- **Steps I took:**
- **Expected:**
- **What actually happened:**
- **Severity:** blocker / major / minor
- **Workaround:**
- **Suggestion:**

---

## Entries

### MCP SDK v2 is a different package name
- **Tool / API / SDK:** MCP TypeScript SDK v2 + `mcp-handler` 2.x
- **Task I attempted:** Add a Streamable HTTP MCP endpoint to a Next.js app.
- **Steps I took:** Planned to install `@modelcontextprotocol/sdk@^2`, then read the `mcp-handler` README.
- **Expected:** SDK v2 published under the same `@modelcontextprotocol/sdk` name.
- **What actually happened:** v2 ships as `@modelcontextprotocol/server` (peer dependency of `mcp-handler` 2.x). Most tutorials still use `@modelcontextprotocol/sdk`, `server.tool(...)`, raw zod shapes and options like `basePath`/`maxDuration`/`redisUrl`, all removed in 2.x.
- **Severity:** minor
- **Workaround:** `npm install mcp-handler@^2 @modelcontextprotocol/server@^2 zod@^4`; use `server.registerTool(name, { inputSchema: z.object({...}) }, cb)`; mount the handler at `app/api/mcp/route.ts`.
- **Suggestion:** Deprecation notice on `@modelcontextprotocol/sdk` pointing to the new package, and a short "v1 → v2" table in the SDK README.
