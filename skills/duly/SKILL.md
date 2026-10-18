---
name: duly
description: Use the Duly MCP server to answer household paperwork questions by voice or chat. Use it when the user asks what they need to pay, about upcoming deadlines or renewals, whether a product is still under warranty, what a bill or letter means, to draft a reply to a company, whether a bill is higher than usual, for a weekly brief, or to save a new bill, letter or warranty.
---

# Duly

Duly is a household paperwork manager exposed as an MCP server: "Paperwork, duly handled." It stores bills, insurance, warranties, official letters, contracts, subscriptions and school forms, and answers questions about them with short sentences meant to be spoken.

## Connect

- Transport: Streamable HTTP, URL `https://duly-home.vercel.app/api/mcp`
- Auth: none. One demo household with fictional sample data only (documents marked SAMPLE). Never ask the user for real personal or financial data.
- Requests are rate-limited per IP. The tools that use an LLM (`add_document`, `explain_document`, `draft_reply`) have a lower limit.

Every successful result has two text blocks plus `structuredContent`:

1. The **spoken sentence** (1-3 sentences, no ids, no JSON, dates in words). This is the answer.
2. The same data as `structuredContent`, serialized as JSON, for clients that only read text. Use it for screens and follow-up calls (ids, amounts), never read it aloud.

An error result (`isError: true`) has one short text that is safe to say to the user.

## Tools

### list_deadlines
- **When:** "What do I need to pay this month?", "what's due this week?", "when does the car insurance renew?".
- **Inputs:** `from`, `to` (YYYY-MM-DD; default today through the next 30 days), `kind` (`payment_due`, `renewal`, `reply_by`, `warranty_ends`, `appointment`, `other`), `payable` (boolean). For questions about paying, use `payable: true`, not `kind`: it returns every deadline with an amount (bills, renewals, fees).
- **Returns:** deadlines sorted by date, each with date, kind, description, amount, days left, document id, title and issuer. Speaks the count, the total (with `payable`) and the next one.
- **Example:** "What do I need to pay this month?" → `{ payable: true, from: <today>, to: <last day of the month> }`

### check_warranty
- **When:** "Is my dishwasher still under warranty?", "which of my warranties are still active?".
- **Inputs:** `product` (optional). Leave it out to list every warranty.
- **Returns:** the best match with end date, days remaining, status (`active`, `expiring_soon` = 60 days or less, `expired`) and how to claim; or every warranty, soonest end first. Says "I couldn't find a warranty for ..." when there is none.
- **Example:** "Is my fridge still under warranty?" → `{ product: "fridge" }`

### search_documents
- **When:** only when the user asks to find or list documents: "find my insurance documents".
- **Inputs:** `query` (required keywords).
- **Returns:** top matches with id, title, issuer and type.
- **Don't** call it before `explain_document`, `draft_reply` or `check_warranty`: they find the document themselves.
- **Example:** "Do I have anything from Northpoint Mutual?" → `{ query: "Northpoint Mutual" }`

### add_document
- **When:** the user shows or pastes a new bill, letter, receipt or form: "save this".
- **Inputs:** `text`, or `file_base64` with `mime_type` (`image/jpeg`, `image/png`, `application/pdf`; max 3 MB). At least one of the two. Optional `hint`, e.g. "this is my car insurance".
- **Returns:** the stored document (type, issuer, amounts, deadlines, summary, action items). Speaks one confirmation, e.g. "Saved: Brightwave Energy bill, $84.20 due November 14. Duly noted."
- **Example:** "Save this water bill." (with a photo) → `{ file_base64: "...", mime_type: "image/jpeg", hint: "water bill" }`

### explain_document
- **When:** "Explain the parking fine letter", "what does this letter mean?", "summarize this letter", "what happens if I ignore it?".
- **Inputs:** `query` (keywords) or `issuer` (sender) or `document_id` (from an earlier result), plus `question` (the user's question).
- **Returns:** plain-language explanation, consequences of inaction, recommended next step, and a disclaimer. For official letters, contracts, insurance or any legal/financial topic the spoken text ends with "This isn't legal advice."
- **Example:** "What happens if I ignore the parking notice?" → `{ query: "parking notice", question: "What happens if I ignore it?" }`

### draft_reply
- **When:** "Write a reply to Brightwave Energy asking for a payment extension", "make it firmer".
- **Inputs:** `intent` (required: what the reply should achieve), `query` / `issuer` / `document_id`, `tone` (`polite` default, or `firm`).
- **Returns:** `subject` and a full `body` (greeting and sign-off included) that only uses the document's own numbers, dates and reference numbers. The spoken text never reads the letter: "Here's a polite draft to Brightwave Energy. Say "make it firmer" to change the tone."
- **Changing the tone:** call it again with the same `document_id` and `intent` and the new `tone`.
- **Example:** "Write a polite email to Brightwave Energy asking for a two-week payment extension." → `{ issuer: "Brightwave Energy", intent: "ask for a two-week payment extension" }`

### compare_bills
- **When:** "Is my Brightwave bill higher than usual?", "compare my water bill", "are any of my bills higher than usual?".
- **Inputs:** `issuer` or `query`. Leave both out to compare every company that has earlier bills.
- **Returns:** the company's latest bill vs the previous one and vs the average of the earlier ones (difference and percentage), and a trend (`higher`, `lower`, `about_the_same` within 5%, `no_history`). Numbers only, no reasons. No LLM.
- **Example:** "Is my electricity bill higher than usual?" → `{ query: "electricity" }`

### weekly_brief
- **When:** "Give me my weekly brief", "what's my week looking like?", "summarize my week".
- **Inputs:** `days` (1-60, default 7). Set it only if the user says how many days.
- **Returns:** deadlines in the period with amounts, renewals that can still be cancelled, warranties ending within 60 days, and latest bills at least 15% above usual that still have an open deadline. Spoken: at most 3 sentences, most urgent first. No LLM.
- **Example:** "What do the next two weeks look like?" → `{ days: 14 }`

## Routing

Call exactly one tool per question. Never invent document ids: reuse one from an earlier result or pass keywords in `query`.

| The user says | Tool | Why |
| --- | --- | --- |
| "What's due this week?" | `list_deadlines` (`from` today, `to` Sunday) | A list of deadlines for a period. |
| "What do I need to pay this week?" | `list_deadlines` with `payable: true` | Paying = deadlines with an amount. |
| "Weekly brief", "what's my week looking like?", "summarize my week" | `weekly_brief` | An overview across deadlines, renewals, warranties and bills. |
| "Summarize this letter", "what does it mean?" | `explain_document` | About one document, not the week. |
| "Higher than usual", "more than last time", "compare my bill" | `compare_bills` | Not `list_deadlines`, even though it mentions a bill. |
| "My warranties", "which warranties are active?" | `check_warranty` without `product` | |
| "Write", "reply", "draft", "make it firmer / more polite" | `draft_reply` | Action words win over the topic. |
| "Find my car insurance documents" | `search_documents` | Only for finding or listing. |
| "When does my car insurance renew?" | `list_deadlines` with `kind: "renewal"` | A date question. |

## Voice rules

- Say the tool's spoken sentence (the first text block). Don't rephrase it into something longer.
- 1-3 sentences. No markdown, lists, ids, JSON or links in speech.
- Say amounts and dates exactly as the tool states them. Don't round, convert or recalculate.
- On a screen, show the details from `structuredContent` (deadline list, warranty, comparison, letter draft) as cards.
- If a tool returns an error, say its short message. Don't retry in a loop.

## Safety and honesty

- Only state facts returned by the tools. If Duly has no data, say so; don't guess.
- Never invent a reason for a bill increase. `compare_bills` gives numbers only; neither should you.
- No legal or financial advice. Duly explains documents; keep the "This isn't legal advice." disclaimer and suggest contacting the issuer or a professional when it matters.
- `draft_reply` only drafts. It sends nothing; the user reviews and sends the letter. Never say it was sent. If the user didn't say what the reply should achieve, ask before drafting.
- When a company has several bills, the latest one wins. Lookups (search, explain, draft) and comparisons already use it; never answer about an earlier, already paid bill as if it were current.

## Example conversation

The demo questions from `scripts/smoke-bedrock.mjs`, in one conversation with the sample data:

1. **User:** "Explain the parking fine letter."
   → `explain_document { query: "parking fine letter" }`
   Duly speaks a short explanation of the City of Maplewood notice, ending with "This isn't legal advice."
2. **User:** "Is my Brightwave bill higher than usual?"
   → `compare_bills { issuer: "Brightwave Energy" }`
   "Your Brightwave Energy bill is $84.20, about 22% higher than your usual $69. That's $14.10 more than your previous bill of $70.10."
3. **User:** "Is my dishwasher still under warranty?"
   → `check_warranty { product: "dishwasher" }`
   Duly says until when it is covered, how many days are left and how to claim.
4. **User:** "Which of my warranties are still active?"
   → `check_warranty {}`
   Duly gives the count by status, then mentions the fridge warranty (expiring soon) and the washing machine warranty (expired).
5. **User:** "What do I need to pay this month?"
   → `list_deadlines { payable: true, from: <today>, to: <last day of the month> }`
   Duly gives the number of payments, the total and the next one. Earlier Brightwave bills never appear.
6. **User:** "Write a reply to Brightwave Energy disputing my electricity bill."
   → `draft_reply { issuer: "Brightwave Energy", intent: "dispute my electricity bill" }`
   "Here's a polite draft to Brightwave Energy. Say "make it firmer" to change the tone." The letter (for the latest bill) is shown, not read.
7. **User:** "Make it firmer."
   → `draft_reply { document_id: <same id as step 6>, intent: "dispute my electricity bill", tone: "firm" }`
   "Here's a firmer draft to Brightwave Energy. Check it before you send it."
