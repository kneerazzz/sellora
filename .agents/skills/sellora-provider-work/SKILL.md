---
name: sellora-provider-work
description: Implement or review Sellora Part 05 provider deadlines, cancellation, bounded retries, workload reservations and honest usage accounting within a selected packet.
---

# Sellora provider work

Read README.md, AGENTS.md and the selected Part 05 roadmap/playbook card plus
SEL-OPS-001 and SEL-COST-001 in PROJECT_REPORT.md. Follow the current review gate;
installing this skill does not start Part 05. Paths below are repository-relative;
inspect current code before assuming a planned module exists.

## Route by packet

- **05A transport:** trace utils/llm.ts, utils/aiExtraction.ts,
  utils/embeddings.ts, utils/reranker.ts and modules/ai/providers/embedding/
  under apps/server/src. Include model loading, callers, fallbacks and SDK retry
  layers. Define one operation deadline, propagated cancellation, bounded total
  attempts and validated output. Promise.race alone does not cancel underlying
  work; record limitations for local compute that cannot be aborted. Do not
  retry cancellation, authentication or validation errors. Backoff/Retry-After
  must fit the remaining deadline; avoid multiplied nested retries. Preserve
  refusal/local-fallback identity and expose failed work honestly.
- **05B admission:** inspect document, answer, extraction, webhook and worker
  entry points. Enforce shared organization reservations for JWT and API keys;
  reserve atomically before costly work. Bound expanded content and uploaded
  bytes. Keep provider work outside database transactions. Test failure,
  cancellation and abandoned reservations; unknown cost cannot mean free work.
- **05C accounting:** correlate every attempt with org/request/run/operation and
  provider/model. Distinguish measured, estimated and unknown quantities;
  unknown is nullable, not zero. Include retries/failures and reconcile once.
  Separate provider usage from local compute, storage and human support costs.
- **05D controls:** enforce pause/exhaustion in shared admission, scope operator
  permissions and show missing measurements. An alert event is not delivered
  notification, and the usage screen is not a verified invoice.

Preserve Nomic/768 and Part 03 refusal/source regressions. Read
docs/EVIDENCE_POLICY.md for fallback/answer changes, docs/AUTHORIZATION.md for
access changes and docs/DEVELOPMENT.md for checks. Do not add another provider,
queue or generic agent framework merely to consolidate helpers. Engineering
defaults are not buyer allowances.

## Acceptance

Use injected transport/clock/sleep for hangs, abort, late responses, 429,
temporary errors, malformed output and exhaustion. Assert dispatch counts and
cleanup, not only error strings. Run server typecheck/tests from apps/server.
For reservations/ledger changes, extend and run the owned disposable DB suite
with concurrency, isolation and idempotency cases. Mocks do not prove SQL races.

Return changed behavior, actual commands/results and remaining limits to the
lead. Follow report → plan → README when owning closure. Live providers need an
agreed target and usage limit; no live call or model download is a default check.
