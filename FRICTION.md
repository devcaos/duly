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

### Bedrock blocked by "account is being verified" on a new AWS account
- **Tool / API / SDK:** Amazon Bedrock Runtime (Converse API), new AWS account, Basic support plan
- **Task I attempted:** Call Amazon Nova 2 Lite (`eu.amazon.nova-2-lite-v1:0`, `eu-west-1`) for document extraction during the hackathon.
- **Steps I took:** Created a new AWS account, then called Bedrock. The error message says to email aws-verification@amazon.com, so I did.
- **Expected:** Bedrock usable shortly after sign-up, or a clear timeline and a working contact.
- **What actually happened:** Bedrock returned `AccessDeniedException`: "Your account is currently being verified", still more than 6 hours after sign-up. The email address in the error auto-replies that it is not monitored. Chat support isn't available on the Basic plan, so I had to open a support case (Account Activation > Bedrock Allowlisting) and wait. This blocked all Bedrock work during the hackathon.
- **Severity:** blocker
- **Workaround:** Gemini fallback through Duly's LLM adapter (`LLM_PROVIDER=gemini`), so the rest of the app could be built and deployed while waiting. Switch back to `bedrock` once the account is verified.
- **Suggestion:** Show the expected verification time and the correct support path (case category) in the error message, remove the unmonitored email address, and let new accounts check verification status in the console.
