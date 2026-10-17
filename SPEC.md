# PaperTrail – Product & Technical Spec

> Hackathon: Build, Ship, Shape – Amazon Developer Hackathon (Devpost)
> Track: **Alexa+** (self-hosted MCP server, Streamable HTTP) · Mini challenge: **AWS Builder**
> Deadline: Oct 23, 2026, 12:00 PDT. Code freeze: Oct 21, 23:59 CEST.

## 1. One-liner

PaperTrail turns Alexa+ into your household's paperwork brain: show it a bill, a letter or a warranty, and it remembers every deadline, explains the fine print and tells you what to do next.

## 2. Problem

Households lose money and sleep over paperwork: late fees, auto-renewals nobody noticed, warranties that expired a week ago, official letters nobody understood. The papers pile up in the kitchen, right where the Echo Show sits. Today no voice assistant can answer "what do I have to pay this month?" or "is the dishwasher still under warranty?" because it has never seen the documents.

## 3. Users and core scenarios

Primary user: an adult who manages a household (bills, insurance, kids' school, appliances).

| # | User says | PaperTrail does |
|---|-----------|-----------------|
| S1 | "Alexa, what do I need to pay this month?" | Lists upcoming deadlines sorted by date, with amounts. |
| S2 | (shows a photo/PDF of a letter) "Save this." | Extracts type, issuer, amounts, deadlines, action items; stores it; confirms in one sentence. |
| S3 | "What does this letter mean? What happens if I ignore it?" | Plain-language explanation, consequences, recommended next step. |
| S4 | "Is my dishwasher still under warranty?" | Finds the warranty, days remaining, how to claim. |
| S5 | "Write a reply asking for a payment extension." | Drafts a short, polite letter/email referencing the document. |
| S6 | "When does the car insurance renew?" | Answers from stored documents (search). |

Out of scope for the hackathon: real payments, multi-user accounts, OAuth, email inbox scanning, legal advice (PaperTrail explains; it does not give legal advice and says so when relevant).

## 4. MCP server

- Endpoint: `/api/mcp` on the Next.js app, **Streamable HTTP**, spec **2025-11-25 or later**.
- Library: `mcp-handler` (v2) + official MCP TypeScript SDK + `zod`. Verify current versions and API in their docs before coding.
- Auth: none for the demo (single demo household `demo`). Mitigations: max upload size 5 MB, basic rate limiting, AWS Budget alert, demo data only.
- Every tool returns a short `text` content suitable to be **spoken** (1–3 sentences) plus `structuredContent` with the full data for screens.

### Tools

1. `add_document`
   - Input: `{ text?: string, file_base64?: string, mime_type?: "image/jpeg"|"image/png"|"application/pdf", hint?: string }` (at least one of `text` or `file_base64`).
   - Behavior: send to the LLM (Bedrock) with a strict JSON extraction prompt → validate with zod → store original in S3 and record in DynamoDB.
   - Output: the stored `Document` + spoken summary ("Saved: Brightwave Energy bill, $84.20 due November 14.").
2. `list_deadlines`
   - Input: `{ from?: ISODate, to?: ISODate, kind?: DeadlineKind }` (default: today → +30 days).
   - Output: deadlines sorted ascending, each with document title, issuer, amount, days left.
3. `explain_document`
   - Input: `{ document_id?: string, query?: string, question?: string }` (find by id or by search).
   - Output: plain-language explanation, consequences of inaction, recommended next step, disclaimer when legal/financial.
4. `check_warranty`
   - Input: `{ product: string }`.
   - Output: matching warranty, end date, days remaining, how to claim (from the document), or "no warranty found".
5. `draft_reply`
   - Input: `{ document_id?: string, query?: string, intent: string, tone?: "polite"|"firm" }`.
   - Output: subject + body draft referencing the document's numbers and dates.
6. `search_documents` (helper)
   - Input: `{ query: string }`. Output: top matches (id, title, issuer, type).

## 5. Data model

```ts
type DocType = "bill" | "insurance" | "warranty" | "official_letter" | "contract" | "subscription" | "school" | "other";
type DeadlineKind = "payment_due" | "renewal" | "reply_by" | "warranty_ends" | "appointment" | "other";

interface Deadline { date: string /* YYYY-MM-DD */; kind: DeadlineKind; description: string; amount?: number; currency?: string; }

interface Document {
  id: string; householdId: string; type: DocType; title: string; issuer: string;
  issueDate?: string; amount?: number; currency?: string;
  deadlines: Deadline[]; summary: string; actionItems: string[];
  product?: string; // for warranties/receipts
  rawText: string; fileKey?: string; createdAt: string;
}
```

DynamoDB single table `papertrail`: `pk = HOUSEHOLD#<id>`, `sk = DOC#<id>`. Small dataset → scan/filter in code is fine.

## 6. Architecture

- **Next.js (App Router, TypeScript)** on **Vercel**: hosts `/api/mcp`, the demo web and its API routes.
- **Amazon Bedrock** (Converse API, `@aws-sdk/client-bedrock-runtime`): document extraction (multimodal) and explanations. Default model: **Amazon Nova 2 Lite** via the EU cross-region inference profile `eu.amazon.nova-2-lite-v1:0` with `AWS_REGION=eu-west-1` (configurable via `BEDROCK_MODEL_ID`; in-region calls to the bare model ID are not supported in eu-west-1).
- **Amazon DynamoDB**: documents and deadlines. **Amazon S3**: original files. **Amazon Polly** (neural voice): spoken replies in the demo web.
- Storage adapter interface with two implementations: `memory` (local dev, seeded with sample docs) and `aws` (DynamoDB + S3). Selected with `STORAGE=memory|aws`.
- LLM adapter with `LLM_PROVIDER=bedrock|gemini` (Gemini = fallback if Bedrock quota fails).

## 7. Demo web: "Echo Show simulator" (`/`)

A page that looks like an Echo Show screen (landscape, rounded bezel, big readable cards).

- Mic button → Web Speech API (`en-US`, Chrome) → transcript sent to `/api/chat`.
- `/api/chat`: an agent loop (Bedrock Converse with tool use) that connects as an **MCP client to our own `/api/mcp`** and calls its tools. This proves the MCP server works the way Alexa+ would use it.
- Reply: spoken via `/api/speak` (Polly), with `speechSynthesis` fallback; result cards (deadline list, document card, warranty card, draft letter).
- Camera/upload button → `add_document`.
- Typed input fallback (for recording reliability).
- Banner: "Simulated Alexa+ experience – PaperTrail runs as a standard MCP server."

## 8. Sample data

Six clearly fictional documents (fictional brands, marked SAMPLE), in English, generated as PNG/PDF in `/samples`: electricity bill (Brightwave Energy), car insurance renewal (Northpoint Mutual), dishwasher receipt with 2-year warranty (HomeHub Appliances), city parking/tax notice (City of Maplewood), gym auto-renewal (PeakFit), school field-trip form with fee (Maplewood Elementary). Dates relative to the demo week so deadlines are always upcoming.

## 9. Agent Skill

`skills/papertrail/SKILL.md`: tells any agent when and how to use the PaperTrail tools (voice-first, short answers, confirm before drafting, never give legal advice).

## 10. Definition of done

- [ ] MCP Inspector lists all tools and each returns valid results.
- [ ] Works as a custom connector in Claude (remote MCP URL on Vercel).
- [ ] Demo web runs scenarios S1–S5 end to end with voice.
- [ ] README: what it is, architecture diagram, how to run, **AWS integration section** (Bedrock, DynamoDB, S3, Polly with file paths), MIT license.
- [ ] No secrets in the repo.
