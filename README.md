# Duly
Alexa+ MCP server that turns your household paperwork into answers: deadlines, warranties and plain-language explanations.

## Try it

Duly is a standard remote MCP server (Streamable HTTP, no sign-in). Production endpoint:

```
https://<your-project>.vercel.app/api/mcp
```

It comes with 14 fictional sample documents (marked SAMPLE): an electricity bill, a car insurance renewal, a dishwasher receipt with warranty, a parking notice, a gym auto-renewal and a school field-trip form, plus four more warranties (a TV, a fridge that is about to run out, an expired washing machine and a laptop) and two earlier electricity and water bills each, so bills can be compared. All dates are relative to today, so deadlines are always upcoming; the earlier bills are already paid and never show up as deadlines.

### Tools

| Tool | What it does | Uses the LLM |
| --- | --- | --- |
| `add_document` | Saves a bill, letter, warranty... from text or a photo/PDF and extracts its deadlines. | yes |
| `list_deadlines` | Upcoming deadlines sorted by date, with amounts ("what do I need to pay this month?"). | no |
| `explain_document` | Plain-language explanation, what happens if you ignore it, next step. | yes |
| `check_warranty` | One product's warranty (days left, how to claim) or every warranty with its status: active, expiring soon or expired. | no |
| `draft_reply` | Short letter or email that uses the document's real numbers and dates. | yes |
| `search_documents` | Finds stored documents by keywords. | no |
| `compare_bills` | Latest bill from a company vs the previous one and vs the usual (average) amount, with percentages ("is my Brightwave bill higher than usual?"). Only states the numbers, never a reason. | no |
| `weekly_brief` | The next 7 days (or `days`), most urgent first: deadlines with amounts, renewals you can still cancel, warranties ending within 60 days and bills at least 15% above usual. | no |

When a company has several bills, search, explanations and drafts always use the latest one.

> **Demo storage:** with `STORAGE=aws`, documents live in Amazon DynamoDB and survive restarts (the demo household is reset to the sample documents with `npm run seed:aws`). With `STORAGE=memory`, documents you add with `add_document` can disappear when the server restarts; the sample documents always come back. Requests are rate-limited per IP.

### Echo Show simulator (demo web)

Open the app's home page (`/`, or http://localhost:3000 with `npm run dev`). It looks like an Echo Show in a kitchen and shows how Alexa+ would use Duly:

- Press the **mic** and ask a question (Web Speech API, `en-US`, Chrome or Edge), or **type** it. The suggestion chips run the demo questions.
- **Add document** uploads a photo or PDF (JPEG, PNG or PDF, max 3 MB) and saves it with `add_document`.
- The reply is spoken with **Amazon Polly** (neural voice). If Polly is unavailable, the browser's own voice reads it.
- The screen shows result cards: deadlines, the saved document, the warranty, or a letter draft with **Copy** and **Make it firmer**.

How it works: [`app/api/chat/route.ts`](app/api/chat/route.ts) asks Amazon Bedrock (Converse API with tool use, model `BEDROCK_MODEL_ID`) which Duly tool to call and with which arguments. The app is an **MCP client of Duly's own `/api/mcp`** ([`lib/agent/mcpClient.ts`](lib/agent/mcpClient.ts), official MCP TypeScript SDK, Streamable HTTP): it lists the tools over MCP, hands them to the model, and calls the chosen tool over MCP, the same way Alexa+ would. What Alexa says is the tool's own spoken sentence; the model never writes the reply, so it can't leak ids or JSON or claim actions it didn't take. If the model answers with text instead of choosing a tool, the app asks once more with `toolChoice: any` (a tool call is required) before giving a help sentence. A safety filter ([`lib/speech.ts`](lib/speech.ts)) still removes ids and JSON and turns ISO dates into spoken dates. The home screen's "Coming up" list, uploads and the **Make it firmer** button call `list_deadlines`, `add_document` and `draft_reply` directly, without the model (a model can't copy a whole file into a tool call). Replies go through [`app/api/speak/route.ts`](app/api/speak/route.ts) (Polly). Set `MCP_URL` to point the app at another Duly server.

Rate limits: `/api/chat` and `/api/speak` limit each visitor by IP. Set `DULY_INTERNAL_TOKEN` (see `.env.example`) so the app's own calls to `/api/mcp` skip the per-IP limit there; without it, every visitor shares the server's IP bucket on `/api/mcp`. The internal call goes to the host the visitor used, and the token is only attached when that host is this deployment's own (`VERCEL_URL`, `VERCEL_BRANCH_URL` or `VERCEL_PROJECT_PRODUCTION_URL`) or `localhost`. An `MCP_URL` that points to any other host is called without the token (so it uses that server's normal per-IP limit); setting `MCP_URL` never makes the app send the secret elsewhere. The in-memory limiter tracks at most 10,000 keys; when it is full, expired keys go first and then the oldest.

### MCP Inspector

1. Run `npx @modelcontextprotocol/inspector` (it opens in your browser).
2. Set **Transport Type** to `Streamable HTTP` and **URL** to the production endpoint above.
3. Click **Connect**, open **Tools**, click **List Tools** and run any of the 8 tools, for example `list_deadlines` with no arguments or `check_warranty` with `product: "dishwasher"`.

From a terminal, you can also call every tool in one go:

```bash
MCP_URL=https://<your-project>.vercel.app/api/mcp npm run tools
```

### Claude (custom connector)

1. In Claude, go to **Customize > Connectors**, click **+ Add**, then **Add custom connector**.
2. Name it `Duly`, paste the production endpoint URL and click **Continue**.
3. Under **Authentication**, choose **No sign in**, then click **Add**.
4. In a chat, click **+** at the lower left, open **Connectors** and turn on **Duly**.

Then ask, for example:

- "What do I need to pay this month?"
- "Is my dishwasher still under warranty?"
- "What happens if I ignore the parking notice?"
- "Write a polite email to Brightwave Energy asking for a two-week payment extension."
- "When does the car insurance renew?"

Duly explains documents; it does not give legal or financial advice.

### Known limitations

- Explanations are grounded by prompt rules (the model is told to use only the document's own facts), not by a full fact validator.

## AWS integration

Duly runs on AWS when `STORAGE=aws` and `LLM_PROVIDER=bedrock` (region `eu-west-1`).

| AWS service | What it does in Duly | Files |
|---|---|---|
| **Amazon Bedrock** (Converse API, model **Amazon Nova 2 Lite** via the EU cross-region inference profile `eu.amazon.nova-2-lite-v1:0`) | Reads photos (PNG/JPEG) and PDFs of household paperwork and extracts type, issuer, amounts, deadlines and action items as validated JSON (`add_document`). Writes plain-language explanations (`explain_document`) and reply drafts (`draft_reply`). Uses a forced tool call so the answer always matches the zod schema. In the demo web, it is also the agent that picks which Duly MCP tool to call (Converse tool use). | [`lib/llm/bedrock.ts`](lib/llm/bedrock.ts), [`lib/llm/index.ts`](lib/llm/index.ts), [`lib/llm/fallback.ts`](lib/llm/fallback.ts), [`lib/agent/agent.ts`](lib/agent/agent.ts) |
| **Amazon DynamoDB** (on-demand table `duly`, keys `pk = HOUSEHOLD#<id>`, `sk = DOC#<id>`) | Stores every document and its deadlines. All tools read from it (`list_deadlines`, `check_warranty`, `search_documents`...). | [`lib/storage/aws.ts`](lib/storage/aws.ts), [`lib/aws.ts`](lib/aws.ts) |
| **Amazon S3** (private bucket `duly-devcaos-files`, all public access blocked) | Keeps the original uploaded file of each document (`households/<id>/<doc-id>.pdf`); its key is saved in `Document.fileKey`. | [`lib/storage/aws.ts`](lib/storage/aws.ts), [`lib/tools/addDocument.ts`](lib/tools/addDocument.ts) |
| **Amazon Polly** (neural voice, `Joanna` en-US by default, `POLLY_VOICE_ID` to change it) | Speaks the demo web's replies (MP3). If Polly fails, the page falls back to the browser's `speechSynthesis`. | [`app/api/speak/route.ts`](app/api/speak/route.ts), [`components/echo/voice.ts`](components/echo/voice.ts) |

Setup scripts (AWS SDK for JavaScript v3):

- [`scripts/setup-aws.ts`](scripts/setup-aws.ts) – `npm run setup:aws` creates the DynamoDB table and the private S3 bucket. Safe to run again.
- [`scripts/seed-aws.ts`](scripts/seed-aws.ts) – `npm run seed:aws` resets the demo household to the sample documents (lib/storage/seed.ts), with dates relative to today.

If Bedrock is throttled, temporarily unavailable or times out, `LLM_FALLBACK=gemini` retries the same request with Google Gemini, and the server log says which provider answered (`[llm] answered by bedrock`). The fallback is **not** used for `AccessDenied`, validation or other client errors: those mean the AWS setup is wrong, so Duly logs `AWS is misconfigured` and returns a generic error. Logs only contain the error name, HTTP status and a short message (ARNs, account IDs and request IDs are masked), and tool callers never see configuration details.

### IAM permissions (least privilege)

[`docs/iam-policy.json`](docs/iam-policy.json) is the exact policy of the IAM user that Duly runs with. Replace `ACCOUNT_ID` with your AWS account ID.

| Statement | Allows | Used by |
|---|---|---|
| `BedrockInvokeNova2Lite` | `InvokeModel` / `InvokeModelWithResponseStream` on Nova 2 Lite: the `eu` inference profile in `eu-west-1` and the foundation model in the EU regions that profile routes to | `lib/llm/bedrock.ts`, `lib/agent/agent.ts` |
| `DynamoDbDulyTable` | Item access (`GetItem`, `PutItem`, `UpdateItem`, `DeleteItem`, `Query`, `Scan`) and `DescribeTable` on the `duly` table only | `lib/storage/aws.ts`, `scripts/seed-aws.ts` |
| `S3DulyBucket` / `S3DulyObjects` | `PutObject` / `GetObject` on the objects of `duly-devcaos-files`, plus bucket-level `ListBucket` and `GetBucketLocation` | `lib/storage/aws.ts` |
| `PollySpeech` | `SynthesizeSpeech` (Polly has no resource-level permissions, so `Resource` is `*`) | `app/api/speak/route.ts` |

Three actions are only needed by `npm run setup:aws`: **`dynamodb:CreateTable`**, **`s3:CreateBucket`** and **`s3:PutBucketPublicAccessBlock`**. After the table and bucket exist you can remove them from the policy; the running server and `npm run seed:aws` don't use them.

> **The bucket must stay private.** `setup:aws` blocks all public access on every run. Never add a bucket policy, ACL or CloudFront rule that makes `duly-devcaos-files` public: it holds the original documents people upload.

### Run it on AWS

1. Put `AWS_REGION=eu-west-1`, `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` in `.env.local` (see `.env.example`). The IAM user needs the policy above.
2. `npm run setup:aws`, then `npm run seed:aws`.
3. Set `STORAGE=aws`, `LLM_PROVIDER=bedrock` (and optionally `LLM_FALLBACK=gemini`) in `.env.local`, then `npm run dev`.
4. `npm run tools -- samples/07-riverside-water-bill.pdf` calls every tool, including `add_document` with a PDF.
5. `npm run smoke:bedrock` sends the demo questions to `/api/chat`, one by one and as a conversation. For each one it prints the tool chosen, the route (`model`: Nova picked it; `forced-keyword` / `forced-any`: asked again, requiring a tool; `server-default`: the server called the tool itself) and the spoken reply. Pass a base URL to test a deployment: `npm run smoke:bedrock -- https://<your-project>.vercel.app`.

### Test the demo web without AWS

[`scripts/mock-aws.mjs`](scripts/mock-aws.mjs) is a local stand-in for Bedrock and Polly with canned, keyword-based answers. The app code doesn't change: the AWS SDK sends its requests to the mock because of the `AWS_ENDPOINT_URL_*` variables.

1. In one terminal: `npm run mock:aws`.
2. In `.env.local`, set `LLM_PROVIDER=bedrock`, `AWS_ACCESS_KEY_ID=mock`, `AWS_SECRET_ACCESS_KEY=mock`, `AWS_ENDPOINT_URL_BEDROCK_RUNTIME=http://localhost:4010` and `AWS_ENDPOINT_URL_POLLY=http://localhost:4010` (and `STORAGE=memory`).
3. In another terminal: `npm run dev`, then open http://localhost:3000.

Like real Bedrock, the mock answers in text when a tool result in the history mixes text and JSON (see FRICTION.md). Test hooks in the mock: put `[text-first]` in a question to make the model answer in text first (tests the forced-tool retry), `[text-always]` to answer in text even when a tool is required, `[bad-input]` to send arguments the server rejects (both test the server-side default call), `[search-only]` to make it call only `search_documents` (tests the explain fallback), and `[bad-draft]` / `[bad-draft-twice]` in a `draft_reply` intent to test the letter validator's retry and the template letter.

The mock Polly plays a short chime instead of speech. Start it with `MOCK_POLLY=fail npm run mock:aws` to test the browser voice fallback. Remove the `AWS_ENDPOINT_URL_*` lines to use real AWS.
