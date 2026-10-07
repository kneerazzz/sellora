# Sellora — start here

**Current state:** Parts 00/02/03/04 complete locally as of **2026-10-07**; 01A scope written, buyer discovery pending. See [baseline evidence](docs/BASELINE.md), [evidence policy](docs/EVIDENCE_POLICY.md) and [development contract](docs/DEVELOPMENT.md).
The detailed `PROJECT_REPORT.md` and `SELLORA_BUILD_PLAN.md` are local operator records excluded from Git. This README is the repository restart guide.

## What we are building

Sellora uses a company's documents to draft answers to buyer questions and extract sales information from emails/transcripts. It has an Express/TypeScript API, PostgreSQL/pgvector, a React staff dashboard, a Preact chat widget, and example n8n workflows.

The user wants to sell it as a **managed automation service for small companies**: paid setup plus ongoing maintenance. No prospect or specific industry is identified. The working first offer is a staff-reviewed, sourced reply-drafting workflow, followed by one email integration. Small B2B software/IT-service teams are an assistant recommendation, not validated demand.

The goal is to try for one paid engagement in roughly two months; the original planning window ends **2026-11-25**. The user's **$1,000 setup + $500–660/month** idea is provisional. Costs, support effort, account ownership and willingness to pay remain unmeasured. Do not promise unlimited usage or assume all API/tool bills fit the fee.

## Current state

**Useful prototype; not client-ready. Packets 00A–00D established a reviewed application and disposable-database baseline.**

- Committed repairs cover retrieval/refusal, embedding contracts, transactional ingestion, sessions and the staff draft UI. Baseline server checks and frontend production builds passed; see dated evidence below.
- A forward migration preserves previous vectors and requires explicit re-ingestion; it has not been applied to a client database in this work.
- The dashboard now has a sourced, editable draft/copy screen. Its edits and review checkbox are session-only; durable approval and approved answers remain missing.
- Limits, usage accounting, worker recovery, document versions/deletion, integrations, and client operations remain incomplete. The public widget remains outside the first offer because its credential/rendering issues are open.
- CRM remains a payload preview; saved n8n workflows are not verified production integrations.

**Evidence boundary:** Part 02 passed clean app installs/client generation, server typecheck, 13/13 test files and both frontend builds. Disposable pgvector/pg15 tests passed Prisma deployment/repeat deployment, API health/401 boundary, empty-queue worker startup/shutdown, migration preservation, vector isolation, rollback and refresh races. Test containers/storage were removed; regular services remained. Hosted CI, authenticated upload/browser journeys, worker recovery, provider quality and client acceptance remain unverified.

Part 03 added real authenticated HTTP TXT/Markdown/PDF/DOCX upload/search, duplicate/retry/concurrent conflict, vector/count rejection and SQL rollback acceptance on disposable targets. Server typecheck and 14/14 test files passed; the [26-question synthetic corpus](apps/server/test/fixtures/knowledge/README.md) passed both offline paths. Disposable resources were removed. Authenticated uploads are now locally verified; browser journeys, production workload and live answer quality remain unverified. The [upgrade runbook](docs/KNOWLEDGE_UPGRADE.md) covers supported shapes and rebuild limits. Astra review is pending.

04A passed real HTTP refresh/replay/cookie/expiry/rollback and current-user checks, focused offline client refresh tests, server typecheck and web build. Bootstrap and 401 retries now share one rotation per tab. [Session policy](docs/SESSION_POLICY.md) records logout JWT delay, organization-move revocation requirements and multi-tab limitations. The route matrix and account lifecycle were subsequently verified in 04B/04C; real browser/production-cookie acceptance was not run.

04B passed the [authorization matrix](docs/AUTHORIZATION.md): all 41 protected routes across seven caller kinds, plus tenant/source/session/public-capability boundaries (404 HTTP assertions). READ_ONLY keys cannot invoke answer/extraction POSTs; body organization overrides are rejected; foreign session IDs return 404. Server typecheck, 14/14 test files and the full disposable suite/cleanup passed. Provider responses were synthetic; no browser/live-provider acceptance or Astra review is claimed.

04C.1 added a PostgreSQL-backed account-attempt limiter shared across processes. Cross-process concurrency, restart persistence, expiry, hashed bucket identity, parallel HTTP 429/Retry-After behavior and forwarding-header spoof resistance passed in the disposable suite. Its 60-attempt/15-minute default is an engineering setting, not a client allowance.

04C.2 passed real invite, recovery, password/session invalidation and staff-offboarding races. Its repair serializes API-key creation with offboarding, enforces bcrypt's 72-byte input boundary on every password-setting path, forces refresh/login lifecycle races, and executes the break-glass script's success/failure paths. [Account operations](docs/ACCOUNT_OPERATIONS.md) documents manual private capability delivery, the no-email boundary and organization-wide API-key rotation during offboarding. The ADMIN routes deny staff, machine scopes and foreign targets. Email delivery, organization-owner transfer and production browser topology remain unverified.

04C.3 passed the supported local [browser security topology](docs/BROWSER_SECURITY.md): exact-origin credentialed CORS, unsafe cookie Origin/Fetch Metadata enforcement, aligned refresh lifetime, production Secure policy, preflight and matching cookie deletion. Server typecheck, 15/15 test files, web build and the final disposable suite/cleanup passed. Deployed TLS/proxy/domain and real-browser acceptance remain unverified.

## Next work

Next action: **Astra review of the 04C.2 repair**, then **05A — provider transport contract** after that review passes. Part 04 is verified locally. The local operator plan contains bounded task cards, checks, and the review handoff.

[01A's working offer sheet](docs/FIRST_OFFER.md) is complete; 01B discovery and 01C pilot boundaries await user/buyer evidence. Preserve `apps/server/scripts/bulkIngest.ts`. Update status after each packet; commit only owned work locally after complete parts, without pushing. The October 3 planning expansion changes documentation only; no new application checks or acceptance are claimed.

Then: complete knowledge correctness and access → limits/recovery/usage → document lifecycle and durable review → approved answers/staff UI → one email integration and conditional questionnaires → measured optimization → operations, evaluation, and paid-pilot packaging. The roadmap divides this into 18 parts with dependencies and acceptance gates.

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

Root `npm test` runs server tests; `npm run check` runs the four checks above. Follow [DEVELOPMENT.md](docs/DEVELOPMENT.md) for clean installation and explicit `npm --prefix apps/server run test:db` (requires Docker; owns/cleans a fresh disposable target). Do not use `prisma db push` to repair migrations. Existing environment files can point to persistent services. Local embeddings require compute; generation can send text externally. Only local Nomic/768 embeddings are accepted at startup. The separate `worker:workflows` command processes the selected database's queue; Redis is not required. CI is configured but has not run on GitHub.

## Continuity

Read this file, the local `AGENTS.md`, the selected `SELLORA_BUILD_PLAN.md` packet, and relevant `PROJECT_REPORT.md` issues. Do not load every old summary. The report distinguishes user decisions, recommendations, source findings and verification. Writing a plan does not authorize deployment, purchases, or outreach.
