# CLAUDE.md – Duly

Read `SPEC.md` before any task. It is the source of truth; if a request conflicts with it, say so before coding.

## How to work
- Start every non-trivial task with a short plan and wait for approval.
- Small steps: make one thing work, test it, then move on. Don't build features not in SPEC.md.
- Before using a library, check its current docs (versions change: mcp-handler v2, MCP SDK v2, zod v4, AWS SDK v3).
- After changes: run `npm run build` and `npm run lint`; fix errors before saying you're done.
- Never commit secrets. Keys live in `.env.local` (gitignored). Keep `.env.example` updated with variable names only.
- Commit on a feature branch with clear messages; don't push to `main` directly.
- If something blocks you for more than two attempts, stop and explain the problem instead of looping.

## Stack
- Next.js (App Router) + TypeScript, deployed on Vercel.
- MCP: `mcp-handler` + official MCP TypeScript SDK, Streamable HTTP at `/api/mcp`.
- AWS SDK v3: Bedrock Runtime (Converse), DynamoDB, S3, Polly. Region from `AWS_REGION`.
- Storage adapter (`memory` | `aws`) and LLM adapter (`bedrock` | `gemini`), chosen by env vars.

## Commands
- `npm run dev` – local server at http://localhost:3000
- `npx @modelcontextprotocol/inspector` – test the MCP server (Streamable HTTP, URL `http://localhost:3000/api/mcp`)

## Friction log
When something in an Amazon/AWS/MCP tool, SDK or doc causes friction (confusing error, missing docs, unexpected behavior), add an entry to `FRICTION.md` using its template.
