# Sellora — start here

**Current state:** reconciled through packet 00C on **2026-10-02**.
The detailed `PROJECT_REPORT.md` and `SELLORA_BUILD_PLAN.md` are local operator records excluded from Git. This README is the repository restart guide.

## What we are building

Sellora uses a company's documents to draft answers to buyer questions and extract sales information from emails/transcripts. It has an Express/TypeScript API, PostgreSQL/pgvector, a React staff dashboard, a Preact chat widget, and example n8n workflows.

The user wants to sell it as a **managed automation service for small companies**: paid setup plus ongoing maintenance. No prospect or specific industry is identified. The working first offer is a staff-reviewed, sourced reply-drafting workflow, followed by one email integration. Small B2B software/IT-service teams are an assistant recommendation, not validated demand.

The goal is to try for one paid engagement in roughly two months; the original planning window ends **2026-11-25**. The user's **$1,000 setup + $500–660/month** idea is provisional. Costs, support effort, account ownership and willingness to pay remain unmeasured. Do not promise unlimited usage or assume all API/tool bills fit the fee.

## Current state

**Useful prototype; not client-ready. Packets 00A–00B have reviewed the existing patch and established a fresh local application baseline.**

- The working tree contains reviewed retrieval/refusal, embedding-contract, transactional ingestion, session-authorization, and staff-draft UI repairs. Server typecheck/tests and both frontend production builds pass on the current tree.
- A forward migration preserves previous vectors and requires explicit re-ingestion; it has not been applied to a client database in this work.
- The dashboard now has a sourced, editable draft/copy screen. Its edits and review checkbox are session-only; durable approval and approved answers remain missing.
- Limits, usage accounting, worker recovery, document versions/deletion, integrations, and client operations remain incomplete. The public widget remains outside the first offer because its credential/rendering issues are open.
- CRM remains a payload preview; saved n8n workflows are not verified production integrations.

**Evidence boundary:** packet 00B passed server typecheck, 12/12 server test files, and both frontend builds. Packet 00C passed real disposable PostgreSQL migration preservation, vector search/isolation, rollback and refresh-race checks with deterministic providers. Both identified test containers and their disposable storage were removed; regular services remained. HTTP/browser journeys, Prisma migration bookkeeping, provider quality and client acceptance remain unverified.

## Next work

Begin **00D — baseline handoff**: consolidate issue limits and migration/re-ingestion implications before moving to offer scope and reproducible setup. Preserve `apps/server/scripts/bulkIngest.ts`.

Then: baseline verification → reproducible setup/cleanup → knowledge correctness and access → limits/recovery/usage → document lifecycle and durable review → approved answers/staff UI → one email integration and conditional questionnaires → measured optimization → operations, evaluation, and paid-pilot packaging. The roadmap divides this into 18 parts with dependencies and acceptance gates.

## Code map and checks

- `apps/server/src/modules/`: auth, documents, answers, extraction, events/runs, CRM preview.
- `apps/server/src/utils/`: vector search, reranker, LLM calls and helpers.
- `apps/server/prisma/`: schema and migrations; `src/workers/workflowWorker.ts`: database-polling worker.
- `apps/web/`: staff dashboard. `apps/copilot/`: widget source; copied browser artifact also exists in `apps/web/public/`.
- `n8n/`: integration examples. `docker-compose.yml`: development infrastructure only.

Run from the project root:

```bash
(cd apps/server && npm run typecheck)
(cd apps/server && npm test)
(cd apps/web && npm run build)
(cd apps/copilot && npm run build)
```

Root `npm test` is a placeholder. Clean installation remains unverified; reconcile the preceding disposable migration evidence in Part 00. Do not use `prisma db push` as a replacement for repairing migrations. Existing environment files can point to persistent services: choose an explicitly disposable target before integration tests. Local embeddings still require compute; generation can send document text to external providers. OpenAI embeddings are currently a stub. The separate worker is launched with `npm run worker:workflows` in `apps/server`; starting it processes queued work.

## Continuity

Read this file, the local `AGENTS.md`, the selected `SELLORA_BUILD_PLAN.md` packet, and relevant `PROJECT_REPORT.md` issues. Do not load every old summary. The report distinguishes user decisions, recommendations, source findings and verification. Writing a plan does not authorize deployment, purchases, or outreach.
