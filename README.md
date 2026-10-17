# Duly
Alexa+ MCP server that turns your household paperwork into answers: deadlines, warranties and plain-language explanations.

## Try it

Duly is a standard remote MCP server (Streamable HTTP, no sign-in). Production endpoint:

```
https://<your-project>.vercel.app/api/mcp
```

It comes with 6 fictional sample documents (marked SAMPLE): an electricity bill, a car insurance renewal, a dishwasher receipt with warranty, a parking notice, a gym auto-renewal and a school field-trip form. All dates are relative to today, so deadlines are always upcoming.

> **Demo storage:** with `STORAGE=aws`, documents live in Amazon DynamoDB and survive restarts (the demo household is reset to the 6 samples with `npm run seed:aws`). With `STORAGE=memory`, documents you add with `add_document` can disappear when the server restarts; the sample documents always come back. Requests are rate-limited per IP.

### MCP Inspector

1. Run `npx @modelcontextprotocol/inspector` (it opens in your browser).
2. Set **Transport Type** to `Streamable HTTP` and **URL** to the production endpoint above.
3. Click **Connect**, open **Tools**, click **List Tools** and run any of the 6 tools, for example `list_deadlines` with no arguments or `check_warranty` with `product: "dishwasher"`.

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

## AWS integration

Duly runs on AWS when `STORAGE=aws` and `LLM_PROVIDER=bedrock` (region `eu-west-1`).

| AWS service | What it does in Duly | Files |
|---|---|---|
| **Amazon Bedrock** (Converse API, model **Amazon Nova 2 Lite** via the EU cross-region inference profile `eu.amazon.nova-2-lite-v1:0`) | Reads photos (PNG/JPEG) and PDFs of household paperwork and extracts type, issuer, amounts, deadlines and action items as validated JSON (`add_document`). Writes plain-language explanations (`explain_document`) and reply drafts (`draft_reply`). Uses a forced tool call so the answer always matches the zod schema. | [`lib/llm/bedrock.ts`](lib/llm/bedrock.ts), [`lib/llm/index.ts`](lib/llm/index.ts), [`lib/llm/fallback.ts`](lib/llm/fallback.ts) |
| **Amazon DynamoDB** (on-demand table `duly`, keys `pk = HOUSEHOLD#<id>`, `sk = DOC#<id>`) | Stores every document and its deadlines. All tools read from it (`list_deadlines`, `check_warranty`, `search_documents`...). | [`lib/storage/aws.ts`](lib/storage/aws.ts), [`lib/aws.ts`](lib/aws.ts) |
| **Amazon S3** (private bucket `duly-devcaos-files`, all public access blocked) | Keeps the original uploaded file of each document (`households/<id>/<doc-id>.pdf`); its key is saved in `Document.fileKey`. | [`lib/storage/aws.ts`](lib/storage/aws.ts), [`lib/tools/addDocument.ts`](lib/tools/addDocument.ts) |
| **Amazon Polly** (neural voice) | Planned: spoken replies in the demo web (`/api/speak`). | – |

Setup scripts (AWS SDK for JavaScript v3):

- [`scripts/setup-aws.ts`](scripts/setup-aws.ts) – `npm run setup:aws` creates the DynamoDB table and the private S3 bucket. Safe to run again.
- [`scripts/seed-aws.ts`](scripts/seed-aws.ts) – `npm run seed:aws` resets the demo household to the 6 sample documents, with dates relative to today.

If Bedrock is throttled, temporarily unavailable or times out, `LLM_FALLBACK=gemini` retries the same request with Google Gemini, and the server log says which provider answered (`[llm] answered by bedrock`). The fallback is **not** used for `AccessDenied`, validation or other client errors: those mean the AWS setup is wrong, so Duly logs `AWS is misconfigured` and returns a generic error. Logs only contain the error name, HTTP status and a short message (ARNs, account IDs and request IDs are masked), and tool callers never see configuration details.

### IAM permissions (least privilege)

[`docs/iam-policy.json`](docs/iam-policy.json) is the exact policy of the IAM user that Duly runs with. Replace `ACCOUNT_ID` with your AWS account ID.

| Statement | Allows | Used by |
|---|---|---|
| `BedrockInvokeNova2Lite` | `InvokeModel` / `InvokeModelWithResponseStream` on Nova 2 Lite: the `eu` inference profile in `eu-west-1` and the foundation model in the EU regions that profile routes to | `lib/llm/bedrock.ts` |
| `DynamoDbDulyTable` | Item access (`GetItem`, `PutItem`, `UpdateItem`, `DeleteItem`, `Query`, `Scan`) and `DescribeTable` on the `duly` table only | `lib/storage/aws.ts`, `scripts/seed-aws.ts` |
| `S3DulyBucket` / `S3DulyObjects` | `PutObject` / `GetObject` on the objects of `duly-devcaos-files`, plus bucket-level `ListBucket` and `GetBucketLocation` | `lib/storage/aws.ts` |
| `PollySpeech` | `SynthesizeSpeech` (Polly has no resource-level permissions, so `Resource` is `*`) | planned demo web |

Three actions are only needed by `npm run setup:aws`: **`dynamodb:CreateTable`**, **`s3:CreateBucket`** and **`s3:PutBucketPublicAccessBlock`**. After the table and bucket exist you can remove them from the policy; the running server and `npm run seed:aws` don't use them.

> **The bucket must stay private.** `setup:aws` blocks all public access on every run. Never add a bucket policy, ACL or CloudFront rule that makes `duly-devcaos-files` public: it holds the original documents people upload.

### Run it on AWS

1. Put `AWS_REGION=eu-west-1`, `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` in `.env.local` (see `.env.example`). The IAM user needs the policy above.
2. `npm run setup:aws`, then `npm run seed:aws`.
3. Set `STORAGE=aws`, `LLM_PROVIDER=bedrock` (and optionally `LLM_FALLBACK=gemini`) in `.env.local`, then `npm run dev`.
4. `npm run tools -- samples/07-riverside-water-bill.pdf` calls every tool, including `add_document` with a PDF.
