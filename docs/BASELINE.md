# Baseline — October 2, 2026

Part 00 is complete. This is a useful prototype, not a client-ready service.

The reviewed retrieval, ingestion, embedding, auth and staff-screen patches are in
`2c37e2a`; the original bulk-ingest edit is already in that commit and remains
untouched. Patch dependencies and limitations are recorded in the local report.
History was not rewritten to split that existing commit.

## Verified evidence

- 00B (`1835dc4`): server typecheck, 12/12 unit/mocked test files, web and copilot
  production builds passed from their app directories.
- 00C (`9bb4491`): fresh pgvector/pg16 database passed historical SQL migration
  replay and legacy-vector preservation, Nomic/768 persistence and search, tenant
  isolation, interrupted ingestion rollback, deterministic answers/refusals,
  concurrent refresh single winner/401 loser, replay safety, replacement rollback,
  current-role and deactivation checks. Server typecheck passed again.
- The previous and new disposable test containers and their storage were removed.
  Regular services were retained. Test fixtures can be regenerated.

## Upgrade implications

The forward migration retains 384-dimensional vectors in `legacyEmbedding`, adds
an empty 768-dimensional active vector column and marks completed documents FAILED
pending explicit re-ingestion with `nomic-embed-text`. Original storage references,
chunks and old model metadata remain. Old vectors cannot be converted by padding.

No client database was migrated. Before an agreed upgrade, preserve originals and
backups and validate the operator rebuild/restore procedure in packet 03B. The
00C harness executes SQL directly; Prisma migration deployment/bookkeeping and
HTTP upload are separate acceptance gates. Do not use `db push` or destructive
vector scripts as substitutes.

## Remaining gates

Real HTTP upload/parsers, concurrent ingestion, browser journeys and provider
quality remain unverified. Lexical evidence selection is provisional. Draft edits
and the review checkbox are session-only. Full authorization, abuse/usage limits,
worker recovery, source lifecycle, durable approvals, integrations and operations
remain incomplete. Public-widget credential/rendering issues remain open.

Next: write the working offer sheet, then reproducible setup. Buyer discovery and
pilot limits need actual user/buyer evidence and do not block local foundation work.
