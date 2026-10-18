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

### Nova 2 Lite doesn't support Bedrock structured outputs
- **Tool / API / SDK:** Amazon Bedrock Converse API (`@aws-sdk/client-bedrock-runtime` v3), Amazon Nova 2 Lite
- **Task I attempted:** Get strict JSON (document extraction) from Nova 2 Lite, validated with zod.
- **Steps I took:** Read the Bedrock "structured outputs" guide, which shows `outputConfig.textFormat` with a JSON schema for the Converse API, and planned to use it.
- **Expected:** Amazon's own newest Lite model to support Bedrock's structured outputs feature.
- **What actually happened:** The Nova 2 Lite model card lists "Structured outputs" under **Not supported**. The structured outputs guide has no model list; it sends you to the model cards, so you only find out after opening the right one. The working pattern is in a different guide (Nova user guide, "Using tools"): define one tool whose input schema is your output format and force it with `toolChoice: { tool: { name } }`.
- **Severity:** minor
- **Workaround:** Forced tool call with `temperature: 0`, then validate `toolUse.input` with zod (`lib/llm/bedrock.ts`). Works for text, PNG and PDF input.
- **Suggestion:** Add a "supported models" table to the structured outputs page, and link the Nova forced-tool pattern from there.

### Bedrock Runtime and Polly clients only speak HTTP/2: "Protocol error" against a local mock
- **Tool / API / SDK:** AWS SDK for JavaScript v3 (3.1152), `@aws-sdk/client-bedrock-runtime` (Converse) and `@aws-sdk/client-polly`, `AWS_ENDPOINT_URL_BEDROCK_RUNTIME` / `AWS_ENDPOINT_URL_POLLY`
- **Task I attempted:** Test the demo web without AWS credentials by pointing the SDK at a small local mock of the Converse and SynthesizeSpeech APIs.
- **Steps I took:** Started a Node `http` server that answers `POST /model/{modelId}/converse`, set `AWS_ENDPOINT_URL_BEDROCK_RUNTIME=http://localhost:4010` and fake credentials, then called `ConverseCommand`.
- **Expected:** The requests reach the mock, as they would with any HTTP endpoint.
- **What actually happened:** Every call failed with a bare `Error: Protocol error` (no status, no hint). Both clients use an HTTP/2 request handler (`NodeHttp2Handler`), even for plain `Converse` and `SynthesizeSpeech`, so they can't talk to an HTTP/1.1 endpoint. This isn't mentioned in the endpoint-override docs, and I first assumed only Bedrock (which has bidirectional streaming) was affected.
- **Severity:** minor
- **Workaround:** Serve the mock with `node:http2` (`createServer`, plaintext h2c), one port for both services (`scripts/mock-aws.mjs`).
- **Suggestion:** Wrap the HTTP/2 failure in a clearer error ("endpoint does not support HTTP/2"), and note in the service-specific endpoints docs that some clients require HTTP/2.

### MCP `subscriptions/listen` streams never close on a serverless deploy
- **Tool / API / SDK:** MCP TypeScript SDK v2 (`@modelcontextprotocol/server` 2.3.1) via `mcp-handler` 2.3.0, Streamable HTTP, spec 2026-07-28, on Vercel
- **Task I attempted:** Run Duly's stateless MCP endpoint on Vercel with `maxDuration = 60`.
- **Steps I took:** Deployed, connected modern (2026-07-28) clients, then read the Vercel logs.
- **Expected:** Every request to a stateless server finishes in a few seconds.
- **What actually happened:** Almost every minute a `POST /api/mcp` ended in "Task timed out after 60 seconds". Modern clients send a `subscriptions/listen` request, and the server answers with an SSE stream that it keeps open forever (keep-alive every 15 s) because `McpServer` advertises `tools.listChanged: true` by default once a tool is registered. Vercel kills the function at `maxDuration`, the client listens again, and the cycle repeats. Nothing in the `mcp-handler` README mentions this.
- **Severity:** major (wasted function time, noisy error logs)
- **Workaround:** Duly's tools never change, so the handler advertises `capabilities: { tools: { listChanged: false } }`. The SDK then acknowledges the listen request and closes the stream at once (`app/api/mcp/route.ts`). Verified locally: the listen POST went from staying open indefinitely to 10 ms.
- **Suggestion:** Default `listChanged` to false unless the server actually changes its tool list, or have serverless adapters like `mcp-handler` warn and cap listen streams below the platform timeout.

### Nova 2 Lite answers in text instead of calling an obvious tool
- **Tool / API / SDK:** Amazon Bedrock Converse API, Amazon Nova 2 Lite (`eu.amazon.nova-2-lite-v1:0`), tool use with `toolChoice` auto, temperature 0
- **Task I attempted:** Route Echo Show questions ("Is my dishwasher still under warranty?") to the right Duly MCP tool in one Converse call.
- **Steps I took:** Sent the six Duly tools with their descriptions and a short routing prompt, `temperature: 0` as the Nova docs recommend for tool calling.
- **Expected:** A `toolUse` block for `check_warranty`, since the question matches its description almost word for word.
- **What actually happened:** In preview testing, the first two attempts came back as plain text with no tool call; only the third called `check_warranty`. The Nova docs also warn that the model may output text even when a tool choice is set. I couldn't open the AWS docs from the cloud sandbox I was coding in (its network policy blocks docs.aws.amazon.com), so I could only confirm from the indexed text of the official pages that Nova 2 accepts `toolChoice: { any: {} }`.
- **Severity:** major (the demo answered "I can help with..." to a clear question)
- **Workaround:** If the first call returns no tool, retry once with `toolChoice: { any: {} }` (forces at least one tool call), and only then fall back to a help sentence (`lib/agent/agent.ts`). Clearer tool descriptions ("use this for ...", "don't search first") also helped.
- **Suggestion:** Document how often `auto` skips tools on Nova 2 Lite, recommend `any` for router-style prompts, and add a model-specific tool-use example that shows the retry pattern.
- **Update (testing with real Bedrock):** most of these text answers had another cause: see the next entry. With that fixed, Nova 2 Lite picked the right tool on its own for all 10 smoke-test questions. The retry stays as a safety net.

### Bedrock silently drops the tools when a tool result mixes text and JSON
- **Tool / API / SDK:** Amazon Bedrock Converse API, Amazon Nova 2 Lite (`eu.amazon.nova-2-lite-v1:0`), `ToolResultBlock` in the conversation history
- **Task I attempted:** Send earlier exchanges back to Nova as real `toolUse` / `toolResult` messages, so follow-ups like "make it firmer" know which document they refer to. Each tool result had a `text` block (the spoken sentence) and a `json` block (`{ document_id }`).
- **Steps I took:** On the Vercel preview, asked "Explain the parking fine letter." and then "Is my dishwasher still under warranty?". Then reproduced it locally against real Bedrock, logging `stopReason` and `usage` for each call, and ran A/B tests with only the history shape changed.
- **Expected:** Either a `check_warranty` call, or a `ValidationException` if that content mix isn't allowed.
- **What actually happened:** No error. Nova answered in plain text (`stopReason: end_turn`), even with `toolChoice: { any: {} }`, which should force a tool call. `usage.inputTokens` fell from about 2,400 to 419: the six tool definitions were no longer in the prompt. Only the very first question of a conversation worked. Everything after a turn that returned a document failed, so it looked like Nova was unreliable. The Nova docs do say "The contents of the ToolResultBlock should be either a single JSON or a mix of text and images", but nothing warns that breaking this rule silently removes the tools. Our local Bedrock mock accepted the mixed result, so the bug passed every mock test.
- **Severity:** major (most demo questions got the "I can help with..." sentence)
- **Workaround:** A tool result with a document is now one `json` block, `{ result, document_id }`; other results are text only (`lib/agent/agent.ts`). A/B results: text + json → 419 input tokens, text answer; single json → 2,490 tokens, `check_warranty`. The mock (`scripts/mock-aws.mjs`) now copies the real behavior and answers in text when a tool result mixes the two. `npm run smoke:bedrock` sends questions that come after a document turn.
- **Suggestion:** Reject a `ToolResultBlock` that mixes `text` and `json` with a `ValidationException`, as Bedrock does for other invalid content, or at least warn about it. Say clearly on the Converse tool-use page which content combinations each model accepts.
