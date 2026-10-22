# Friction log

One entry per problem with an Amazon/AWS/MCP tool, SDK or doc.

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
- **Update (reproduced in isolation):** Reproduced with mcp-bedrock-bridge's `npm run test:bedrock` (minimal in-process MCP server, `eu.amazon.nova-2-lite-v1:0`, `eu-west-1`, temperature 0, same numbers in 3 runs). Same history, only the `toolResult` shape changed: single `json` block → 1,170 input tokens and a `toolUse`; `[text, json]` → 90 input tokens, `stopReason: end_turn`, no `toolUse` with `toolChoice` `auto` or `any`. The model wrote the tool arguments as text (`{"order_id":"B-7"}`) and then said it couldn't find the order. Still no error from Bedrock.

### Nova 2 docs leave out the tool schema and tool result rules (while building mcp-bedrock-bridge, Duly's companion library)
- **Tool / API / SDK:** Amazon Nova 2 User Guide ("Using tools") vs Amazon Nova (v1) User Guide ("Defining a tool", "Returning tool results")
- **Task I attempted:** Write down, with sources, which tool schemas and `toolResult` contents Nova 2 Lite accepts.
- **Steps I took:** Read the Nova 2 "Using tools" page, the Nova v1 tool-use pages and the Bedrock API Reference.
- **Expected:** The Nova 2 page states the rules for Nova 2 models.
- **What actually happened:** Two rules are only in the v1 guide: "only type, properties and required at the root" and "The contents of the ToolResultBlock should be either a single JSON or a mix of text and images". The Nova 2 page only shows single-`json` examples, and its schema example uses `minimum`/`maximum` and `["number","null"]`, so it isn't clear which keywords Nova 2 accepts.
- **Severity:** minor
- **Workaround:** Follow the v1 rules conservatively and verify with real calls (`npm run test:bedrock` in mcp-bedrock-bridge).
- **Suggestion:** Add a "Tool schema and tool result constraints" section to the Nova 2 guide with the accepted JSON Schema keywords and allowed content combinations.
- **Update (untyped properties):** The docs also don't say whether a property in a tool schema needs a `"type"` (for example zod's `z.any()`). The Nova v1 docs only restrict the root (`type`, `properties`, `required`) and the Nova 2 docs say nothing about property keywords. mcp-bedrock-bridge added a live probe: Nova 2 Lite accepted an untyped property in one run, which isn't a guarantee, so the library keeps such properties with an untyped-schema warning, throws under `onUnsafeSchema: "throw"` and marks them as unverified.

### MCP SDK v1: `callTool` returns a union with the legacy format (while building mcp-bedrock-bridge, Duly's companion library)
- **Tool / API / SDK:** `@modelcontextprotocol/sdk` 1.32.1, `Client.callTool`
- **Task I attempted:** Pass the result of `client.callTool(...)` to a function that reads `content` and `structuredContent`.
- **Steps I took:** Called `client.callTool(...)` and passed the result to that function.
- **Expected:** `callTool` returns `CallToolResult`.
- **What actually happened:** The return type is `CallToolResult | { toolResult: unknown }` (pre-2025 format), so `result.content` doesn't type-check without a guard or a cast, even against current servers.
- **Severity:** minor
- **Workaround:** mcp-bedrock-bridge also accepts the legacy shape and treats `toolResult` like `structuredContent`.
- **Suggestion:** An overload that returns only `CallToolResult` when the negotiated protocol is current, or a type guard exported by the SDK.

### The Bedrock API reference doesn't list image limits for tool results (while building mcp-bedrock-bridge, Duly's companion library)
- **Tool / API / SDK:** Amazon Bedrock Converse API reference (`ImageBlock`, `ImageSource`, `ToolResultContentBlock`)
- **Task I attempted:** Document size and count limits for images that mcp-bedrock-bridge puts in a `toolResult`.
- **Steps I took:** Read the `ImageBlock`, `ImageSource` and `ToolResultContentBlock` pages.
- **Expected:** Maximum image size, dimensions and number of images per request, next to the fields.
- **What actually happened:** Only `bytes` "Minimum length of 1" and the formats (`png`, `jpeg`, `gif`, `webp`). No maximums, so the bridge README marks the limits as unverified.
- **Severity:** minor
- **Workaround:** Don't cap images in the library; turn empty images (0 bytes) into text markers, because the minimum is documented.
- **Suggestion:** Put the image limits on the API reference pages, or link to them from there.

### Alexa+ MCP Toolkit: the quickstart reads as self-service, but access is partner-only
- **Tool / API / SDK:** Alexa+ MCP Toolkit (`@alexa-ai/cli`), Alexa+ add-ons developer console and web simulator
- **Task I attempted:** Register the deployed Duly MCP server (`https://duly-home.vercel.app/api/mcp`, Streamable HTTP, spec 2025-11-25) as an Alexa+ add-on and test it in the official web simulator, so the demo could show real Alexa+ instead of my own simulated Echo Show.
- **Steps I took:** Followed the MCP toolkit quickstart, "Set Up Your Development Environment" and "Test in the Web Simulator". On Oct 19, 2026 I created an Amazon developer account and opened the add-ons console and the simulator. Checked `@alexa-ai/cli` on the public npm registry. Then searched the hackathon forum.
- **Expected:** The quickstart and test pages describe a self-service flow: install the CLI, `alexa-ai configure`, `alexa-ai deploy` to the development stage, test in the simulator. Nothing on those pages says access is restricted.
- **What actually happened:** Both console pages (`/alexa/console/ask/addons` and `/alexa/console/ask/addons/simulator`) only show "Coming Soon". `@alexa-ai/cli` returns 404 on the public npm registry. The setup page installs it from a private CodeArtifact registry after assuming a role in an Amazon-owned account (`AddOn3PDeveloperToolsRead`) with "the AWS account that you provided to the Alexa Solutions Architect", and lists only macOS and Ubuntu (I develop on Windows 11). Only the docs home says the toolkit is for select partners. The organizers confirmed on the hackathon forum that the toolkit and simulator are in preview with select partners and won't be opened to participants. Several participants lost time on the same `AssumeRole` AccessDenied.
- **Severity:** blocker (for testing on real Alexa+; the hackathon doesn't require it)
- **Workaround:** Followed the Alexa+ track guidance: a simulated Alexa+ experience in a web app. Duly's Echo Show-style page runs a Bedrock Nova agent that is a real MCP client of `/api/mcp`, and the same server works in third-party MCP clients (Claude connector, MCP Inspector). The server already meets the toolkit's transport requirements (Streamable HTTP, spec 2025-11-25, remote HTTPS URL).
- **Suggestion:** Show a "preview: select partners only" banner on every MCP toolkit page, not just the docs home; make the console explain why it shows "Coming Soon" and how to request access; give hackathon entrants a sandbox or hosted simulator that can point at any public MCP URL; document Windows (or WSL) support; and state whether a public MCP server with no user login needs any authentication, and whether the 500 ms latency target applies to each tool call.

### Nova 2 Lite puts `<br>` tags in a field the prompt asked to be plain text
- **Tool / API / SDK:** Amazon Bedrock Converse API, Amazon Nova 2 Lite (`eu.amazon.nova-2-lite-v1:0`), JSON output through a forced tool (`toolChoice: { tool: { name } }`)
- **Task I attempted:** Generate the letter for `draft_reply`: a JSON object with `subject` and `body` strings, shown in the Echo Show letter card and returned to every MCP client.
- **Steps I took:** The system prompt said "Plain text, no markdown, English. A blank line between paragraphs." On Oct 21, 2026, while recording the demo against production, I asked "Write a reply to Brightwave Energy disputing my electricity bill."
- **Expected:** Plain text in `body`, with `\n\n` between paragraphs.
- **What actually happened:** The body had literal HTML line breaks, e.g. "...send an itemized breakdown.<br><br>Thank you for your attention to this matter.", and the card showed the tags as text. No error, and the JSON was valid. It doesn't happen every time: the same question and "Make it firmer" came back clean in later runs, so a mock or a few test calls won't catch it.
- **Severity:** minor (visible in the demo, no data problem)
- **Workaround:** Normalize the model's text on the server before validating it: `<br>` variants and block tags become line breaks, other HTML tags are removed (only real tag names, so "<5 days" stays), and extra blank lines are collapsed. The prompt now also says "no HTML tags (never <br>)" and asks for `\n\n` between paragraphs. The smoke test fails if a letter contains HTML tags.
- **Suggestion:** Say in the Nova prompting guide what "plain text" output looks like for string fields in tool/JSON output, and whether Nova may use HTML or markdown for line breaks inside JSON strings, so apps know to sanitize them.

### Nova 2 Lite throttles a short test burst, and the 429 doesn't say which limit
- **Tool / API / SDK:** Amazon Bedrock Converse API, Amazon Nova 2 Lite through the EU cross-region inference profile (`eu.amazon.nova-2-lite-v1:0`, `eu-west-1`)
- **Task I attempted:** Run Duly's pre-PR checks on Oct 22, 2026 against a local server with real Bedrock and no fallback provider: `smoke:bedrock` (17 questions), `npm run tools` and a few letter drafts, one after another.
- **Steps I took:** Ran the scripts back to back; each question makes one or two Converse calls (tool choice, then the tool's own call; a draft that fails its checks makes one more).
- **Expected:** A few dozen calls over several minutes to stay within the default quota, or a 429 that names the quota that was hit.
- **What actually happened:** One `draft_reply` call near the end got `ThrottlingException` (HTTP 429, "Too many requests, please wait before trying again."). The message doesn't say whether it was requests or tokens per minute, or whether the limit belongs to the inference profile or the account. The same call worked about 20 seconds later.
- **Severity:** minor (a test run, not a user-facing outage)
- **Workaround:** Retry after a short pause. In production Duly's `LLM_FALLBACK` answers when Bedrock is throttled; for these checks the fallback was off on purpose so every answer came from Bedrock.
- **Suggestion:** Name the quota (and its current value) in the `ThrottlingException` message, and document the default per-minute quotas for Nova 2 Lite cross-region inference profiles next to the model card.
