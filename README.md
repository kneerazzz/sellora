# Sellora — start here

**Current state:** Parts 00/02/03/04/05/07/08/09/12/13 and packets 06A–06C, 10A–10D, 11A–11C complete locally as of **2026-10-18**; 06D queued ingestion deferred after local measurement. 14A [deployment design](docs/DEPLOYMENT.md) is prepared; provider, region and first-client ownership remain undecided. 14B [operational visibility](docs/OPERATIONS.md) passed local checks, including two-organization mock routing to operator and separate client Slack channels, but real webhook delivery remains open. [Gmail intake](docs/EMAIL_CONTRACT.md) is selected for one client-owned, read-only, 50-test-email/day inbox with client-owned n8n/OAuth and Sellora-only output. Its authenticated route and worker create one local review draft per event under lease/idempotency guards. [11D's live sandbox runbook](docs/evidence/email-sandbox.md) is prepared but unrun. [Questionnaire jobs](docs/QUESTIONNAIRE_CONTRACT.md) persist bounded CSV/text rows with recovery, cancellation and retry; answered rows now link to the staff draft review and an ordered, formula-safe CSV export. [Performance evidence](docs/PERFORMANCE.md) records the synthetic baseline, measured text index, request-local embedding dedupe and smaller initial staff bundle; the full 25-migration disposable suite and focused 26-migration operations suite passed. The configured 1,000,000-character case timed out and is not a validated capacity limit. Historical pre-12C answer rows still need a draft-link migration for review; pilot formats/limits remain unagreed in 01C. No live account is connected. 01A scope written; buyer discovery and broader pilot agreement pending. Part 05/06/07/08/09/10/11/12/13 Astra review remains pending. See [baseline evidence](docs/BASELINE.md), [evidence policy](docs/EVIDENCE_POLICY.md) and [development contract](docs/DEVELOPMENT.md).
The detailed `PROJECT_REPORT.md` and `SELLORA_BUILD_PLAN.md` are local operator records excluded from Git. This README is the repository restart guide.

## What we are building

Sellora uses a company's documents to draft answers to buyer questions and extract sales information from emails/transcripts. It has an Express/TypeScript API, PostgreSQL/pgvector, a React staff dashboard, a Preact chat widget, and example n8n workflows.

The user wants to sell it as a **managed automation service for small companies**: paid setup plus ongoing maintenance. No prospect or specific industry is identified. The working first offer is a staff-reviewed, sourced reply-drafting workflow, followed by one email integration. Small B2B software/IT-service teams are an assistant recommendation, not validated demand.

The goal is to try for one paid engagement in roughly two months; the original planning window ends **2026-11-25**. The user's **$1,000 setup + $500–660/month** idea is provisional. Costs, support effort, account ownership and willingness to pay remain unmeasured. Do not promise unlimited usage or assume all API/tool bills fit the fee.

## Current state

**Useful prototype; not client-ready. Packets 00A–00D established a reviewed application and disposable-database baseline.**

- Committed repairs cover retrieval/refusal, embedding contracts, transactional ingestion, sessions and the staff draft UI. Baseline server checks and frontend production builds passed; see dated evidence below.
- A forward migration preserves previous vectors and requires explicit re-ingestion; it has not been applied to a client database in this work.
- The server persists organization-scoped drafts and an [approved-answer library](docs/APPROVED_ANSWER_CONTRACT.md); the staff dashboard now has saved draft/review and library workflows. The 10D local Firefox matrix passed over the disposable API/database; Astra, deployed-browser and client acceptance remain open.
- Versioned replacement/deletion and the Knowledge UI now pass local checks; client retention decisions and physical erasure remain open. Integrations, invoice reconciliation and client operations remain incomplete. The public widget remains outside the first offer because its credential/rendering issues are open.
- CRM remains a payload preview; saved n8n workflows are not verified production integrations.

**Evidence boundary:** Part 02 passed clean app installs/client generation, server typecheck, 13/13 test files and both frontend builds. Disposable pgvector/pg15 tests passed Prisma deployment/repeat deployment, API health/401 boundary, empty-queue worker startup/shutdown, migration preservation, vector isolation, rollback and refresh races. Test containers/storage were removed; regular services remained. Hosted CI, authenticated upload/browser journeys, worker recovery, provider quality and client acceptance remain unverified.

Part 03 added real authenticated HTTP TXT/Markdown/PDF/DOCX upload/search, duplicate/retry/concurrent conflict, vector/count rejection and SQL rollback acceptance on disposable targets. Server typecheck and 14/14 test files passed; the [26-question synthetic corpus](apps/server/test/fixtures/knowledge/README.md) passed both offline paths. Disposable resources were removed. Authenticated uploads are now locally verified; browser journeys, production workload and live answer quality remain unverified. The [upgrade runbook](docs/KNOWLEDGE_UPGRADE.md) covers supported shapes and rebuild limits. Astra review is pending.

04A passed real HTTP refresh/replay/cookie/expiry/rollback and current-user checks, focused offline client refresh tests, server typecheck and web build. Bootstrap and 401 retries now share one rotation per tab. [Session policy](docs/SESSION_POLICY.md) records logout JWT delay, organization-move revocation requirements and multi-tab limitations. The route matrix and account lifecycle were subsequently verified in 04B/04C; real browser/production-cookie acceptance was not run.

04B passed the [authorization matrix](docs/AUTHORIZATION.md): all 41 protected routes across seven caller kinds, plus tenant/source/session/public-capability boundaries (404 HTTP assertions). READ_ONLY keys cannot invoke answer/extraction POSTs; body organization overrides are rejected; foreign session IDs return 404. Server typecheck, 14/14 test files and the full disposable suite/cleanup passed. Provider responses were synthetic; no browser/live-provider acceptance or Astra review is claimed.

04C.1 added a PostgreSQL-backed account-attempt limiter shared across processes. Cross-process concurrency, restart persistence, expiry, hashed bucket identity, parallel HTTP 429/Retry-After behavior and forwarding-header spoof resistance passed in the disposable suite. Its 60-attempt/15-minute default is an engineering setting, not a client allowance.

04C.2 passed real invite, recovery, password/session invalidation and staff-offboarding races. Its repair serializes API-key creation with offboarding, enforces bcrypt's 72-byte input boundary on every password-setting path, forces refresh/login lifecycle races, and executes the break-glass script's success/failure paths. [Account operations](docs/ACCOUNT_OPERATIONS.md) documents manual private capability delivery, the no-email boundary and organization-wide API-key rotation during offboarding. The ADMIN routes deny staff, machine scopes and foreign targets. Email delivery, organization-owner transfer and production browser topology remain unverified.

04C.3 passed the supported local [browser security topology](docs/BROWSER_SECURITY.md): exact-origin credentialed CORS, unsafe cookie Origin/Fetch Metadata enforcement, aligned refresh lifetime, production Secure policy, preflight and matching cookie deletion. Server typecheck, 15/15 test files, web build and the final disposable suite/cleanup passed. Deployed TLS/proxy/domain and real-browser acceptance remain unverified.

05A passed deterministic provider-boundary acceptance: one operation deadline, propagated HTTP/client-disconnect cancellation, capped retries/backoff, typed attempt outcomes and validated generation/extraction/embedding/reranker output. Server typecheck and 21/21 test files passed. Local embedding/reranker SDK work cannot be force-aborted, so Sellora reports that limit and stops waiting; no live provider/model download, usage reconciliation or workload limit is claimed.

05B adds configurable provider I/O, input, upload, extracted-text, page and question ceilings plus real PostgreSQL reservations at shared service boundaries. Two-process concurrency/restart/expiry, unused versus attempted-unknown accounting, and denial-before-work passed. Real HTTP/SQL acceptance proved JWT, FULL_ACCESS API-key and integration-originated internal worker processing share the organization allowance. The defaults are engineering limits, not buyer allowances or billing truth; providers were synthetic and no client workload/browser was used.

05C adds durable organization-scoped usage traces and per-attempt outcomes, including retries, failures, cancellation, nullable unknown quantities and request/run correlation. Legacy AI usage backfills as unknown; local compute, storage, infrastructure, automation and support remain separate categories. The current rate snapshot is unpriced. Server tests and disposable migration/HTTP/SQL checks passed with synthetic providers; no invoice or client workload was measured.

05D adds an ADMIN pause/resume switch and an ADMIN/MANAGER usage view with remaining engineering allowance, unknown measurements, failed/costly work and stored alert events. Shared admission blocks new expensive JWT/API-key/worker work when paused or exhausted. Real disposable HTTP/SQL and cross-process checks plus a headless Firefox journey against a synthetic API passed. The screen is not a customer invoice, and alert delivery remains open.

06A separates workflow processing from human review and external delivery, preserves legacy review/failure records in a forward migration, and rejects unsupported CRM intake. Server tests and a full disposable migration/HTTP/SQL suite passed. A completed run is not approved or sent.

06B adds PostgreSQL lease claims, heartbeats, stale-owner fencing, bounded retry/backoff and sequential worker polling. A disposable two-process claim race and killed-claimant restart passed; the full thirteen-migration suite and cleanup passed. The crash fixture uses claim-only processes, not a live-provider job.

06C adds organization/source/event-scoped webhook idempotency, payload mismatch conflicts, retained result checkpoints, scoped retry/cancel/detail activity and staff controls. Final server typecheck, 22/22 tests, web build, a synthetic-API Firefox UI check, and the fourteen-migration disposable HTTP/SQL suite passed, including concurrent duplicates, stale-owner fencing, retry/cancel races, historical activity and cleanup. No external send or live provider was exercised.

06D disposition is **deferred**: small deterministic upload samples passed synchronously, but a first PDF parse took about 1.13 seconds and raised test-process RSS from 680 to 932 MiB. These are not capacity limits or client workload evidence. Keep synchronous ingestion for Part 07 and revisit queueing/parser isolation with representative files, concurrency and an agreed latency/resource threshold before larger client uploads.

07A/07B add the [source version contract](docs/SOURCE_CONTRACT.md), immutable hashed versions, legacy backfill, actual PDF page locations, active-only retrieval, scoped text/file replacement, failed-version retry and tombstone deletion. Server typecheck and 22/22 test files, web build, and the final 15-migration disposable HTTP/SQL suite passed, including populated upgrade, two-candidate conflict, deletion during embedding, 49-route authorization and cleanup. Historical retention/erasure and approval/export rechecks remain future work; no live provider or client acceptance was exercised.

07C adds the [retention contract](docs/RETENTION.md), scoped current/stale/unavailable reference reads, active-only passage inspection, and an ADMIN erasure dry run for owned database and original-file artifacts. The final disposable suite passed 52 protected routes, foreign/deleted text exclusion and cleanup. Client retention decisions, full erasure and later approval/export rechecks remain open.

07D adds a Knowledge screen for version/error inspection, actual page/section location, upload, replace, failed-version retry and confirmed deletion. A headless Firefox journey against a synthetic local API passed duplicate-name display, successful upload, replacement, parser failure, retry, deletion and cancellation state; web build and the server's real disposable HTTP/SQL suite passed separately. This is not a client or live-provider session.

08A–08D add the [durable draft contract](docs/DRAFT_CONTRACT.md), exact-revision approval, and revision-aware export/copy audit. Approval is ADMIN/MANAGER-only with self-review denied as a local safety default; it rechecks current sources. Export records the exact immutable revision, approval/source status and optional source labels. Copy success is recorded separately after the browser clipboard call; delivery remains `NOT_REQUESTED`. The final server typecheck and 22/22 test files passed. The 17-migration disposable suite passed fresh/repeat and populated replay, 60 protected routes across seven caller kinds with 570 HTTP assertions, concurrent edit/approval and source invalidation, stale-source handling, requester-only copy confirmation, tenant constraints and cleanup. The web production build passed. Providers were deterministic; the existing ephemeral Draft page is not wired to these APIs, no browser journey was run, and Astra review is pending.

09A–09C add organization-owned approved-answer records with exact draft revision/approval lineage, immutable answer revisions and source references, stable duplicate save, paginated search/detail, optimistic edit/archive and exact-revision reapproval. Current/relevant suggestions can create an idempotent new unapproved draft with exact answer/revision lineage and no inherited approval. Source replacement/deletion and answer edits append invalidation audit events and place affected entries in a paginated review queue; current-reference revision and exact reapproval restore eligibility without erasing history. Final server typecheck and 22/22 test files passed. The 20-migration disposable suite passed 69 protected routes across seven caller kinds with 641 HTTP assertions, dedicated library/reuse/invalidation HTTP/SQL acceptance, historical replay and cleanup. No approved-answer UI, browser/live-provider/client acceptance or Astra review was performed.

10A/10B connect the persistent staff draft and approved-answer screens. Current cited passages, including ones beyond the first 100 chunks, are inspectable; source retirement removes their text. On **2026-10-17**, server typecheck and 22/22 tests, web production build, a synthetic Firefox check and the full disposable 20-migration suite passed. The suite included a real Firefox journey over the seeded API/database for login, draft creation and reload, source inspection, approval/export/copy, edit conflict recovery, library review and unapproved reuse; its owned container/storage was removed. 10C/10D then passed focused staff navigation and the broader [browser matrix](docs/STAFF_ACCEPTANCE.md), including upload, refusal, failures, session recovery, stale sources and a real two-tab conflict. Deployed/client acceptance and Astra review remain open.

## Next work

Next action: finish 14A when the first-client hosting owner, provider, region and terms are chosen; finish 14B with a private Slack webhook and bounded real delivery test. Then complete 14C restore/rollback. The pending **Part 05/06/07/08/09/10/11/12/13 Astra review gate** remains separate. The 01C buyer decision still controls actual questionnaire formats and limits. Packet 11D remains open for the real client-owned test account, connector operations runbook, verified read-only OAuth grant, enforced daily stop, client retention/hosting agreement and live acceptance cases. The local approval safety default reserves approval for ADMIN/MANAGER and denies self-review; buyer policy remains TBD. A `gpt-6-astra` read-only review accepted the 04C.2 repair on **2026-10-10** with one low-priority break-glass exclusivity regression left as a follow-up. The local operator plan contains bounded task cards and checks.

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

Project-local [agents and skills](docs/AGENT_WORKFLOW.md) provide packet execution,
Part 05 provider guidance, verification and read-only review. The guide includes
copy-paste prompts and role responsibilities. Start with `$sellora-packet-runner`
for authorized continuation; it follows the current next action and review gates.

Read this file, the local `AGENTS.md`, the selected `SELLORA_BUILD_PLAN.md` packet, and relevant `PROJECT_REPORT.md` issues. Do not load every old summary. The report distinguishes user decisions, recommendations, source findings and verification. Writing a plan does not authorize deployment, purchases, or outreach.
