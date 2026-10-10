---
name: sellora-verification
description: Verify a Sellora packet or audit its recorded evidence using appropriate static, mocked, disposable database, HTTP or browser checks without overstating acceptance.
---

# Sellora verification

Read README.md, AGENTS.md, docs/DEVELOPMENT.md and the selected roadmap/playbook
acceptance. Resolve the exact candidate: base/head commits and any named staged,
unstaged or untracked files. A clean working tree does not mean a committed repair
has no diff. Record pre-existing changes, particularly bulkIngest.ts.

For an evidence audit, inspect source/records without running mutating integration
checks or repairing code. For verification, map acceptance criteria to existing
assertions or named missing tests before executing.

## Choose relevant checks

| Change | Check and working directory |
| --- | --- |
| Docs/config only | Root: git -c core.fsmonitor=false diff --check; parse changed configuration and inspect links/instruction consistency |
| Server behavior | apps/server: npm run typecheck; npm test; targeted node --import tsx --test paths during iteration |
| SQL, migrations, HTTP, concurrent state | apps/server: npm run test:db; inspect scripts/integration/runDisposable.mjs to ensure new cases actually run |
| Dashboard | apps/web: npm run build; behavior-specific browser acceptance when required |
| Client refresh | apps/server: node --import tsx --test ../web/test/clientRefresh.test.ts |
| Widget when in scope | apps/copilot: npm run build; browser security acceptance separately |

Read docs/SESSION_POLICY.md, docs/AUTHORIZATION.md, docs/ACCOUNT_OPERATIONS.md and
docs/BROWSER_SECURITY.md for touched auth boundaries. Read
docs/KNOWLEDGE_UPGRADE.md and docs/EVIDENCE_POLICY.md for touched knowledge paths.
Do not reread unrelated runbooks or repeat passing suites without a new reason.

## Environment and reporting

The DB wrapper owns a new labelled pgvector container and cleans its resources.
Never substitute an ambient DATABASE_URL, run db push, reuse regular Compose
storage or start a worker against an unknown queue. Inspect cleanup after a failed
run; do not stop unrelated services. Use deterministic providers; never expose
environment values. Operational scripts are not setup checks.

Report command, cwd, candidate revision/tree, exit result, assertions and cleanup.
Separate fresh execution from dated records. Distinguish source, mocks, real SQL,
HTTP, browser, live provider and buyer evidence. A build is not a browser journey;
synthetic model output does not establish quality. Missing checks stay UNRUN or
BLOCKED. Do not assume a browser command exists; inspect current tooling first.

Return pass/fail/unrun per criterion, failures with paths and remaining checks.
The lead updates report → plan → README and owns commits. Verification alone
never claims an Astra review or buyer acceptance.
