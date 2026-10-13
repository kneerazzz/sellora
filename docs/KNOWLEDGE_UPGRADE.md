# Knowledge upgrade and bounded rebuild

**Historical Part 03 runbook:** the rebuild instructions below describe the
pre-versioned schema. Part 07A/07B now preserves chunk versions and changes
`ingest-text` into a versioned replacement. Consult [the source contract](SOURCE_CONTRACT.md)
and current migration history before any future upgrade; do not apply the
pre-versioned index, chunk-replacement or status assumptions below to a Part 07
database.

Supported paths: a new empty PostgreSQL/pgvector database replaying all migrations,
or an existing database whose applied history ends at
`20260626000000_add_webhook_idempotency_key` and whose active embedding column is
`vector(384)`. Part 00/02 disposable tests exercise these shapes. An ad hoc
`db push` database, older Pinecone-only deployment or manually altered 768-column
database is not a supported in-place upgrade: inspect and design a separate
preservation migration on a disposable copy first. Do not drop a column to fit.

## Before changing an agreed target

1. Confirm database/organization, operator permission, source ownership and a
   maintenance window. Pause writes, ingestion and workers. This runbook does not
   authorize a client upgrade or paid model use.
2. Back up database and original files together. Record counts, document IDs,
   storage references, embedding dimensions, applied migration names and checksums.
   Restore a copy in isolation before proceeding. Actual client restore is Part 14.
3. Inspect `_prisma_migrations` and `format_type(atttypid, atttypmod)` for
   `document_chunks.embedding`; compare with the supported shape above. Inventory
   `pg_indexes` on `document_chunks`. The checked-in history adds no vector ANN
   index; retain the primary and `(documentId,chunkIndex)` unique indexes. Treat
   extra deployment-specific indexes as drift requiring review.
4. Validate Nomic/768 on the deliberately selected Ollama target and agree a
   bounded document/compute allowance. Model download/embedding work is not free
   merely because it is local. Do not call generation to rebuild vectors.

## Apply and inspect

From `apps/server`, run `npm run db:deploy` with the explicitly chosen database.
The forward migration renames `embedding` to `legacyEmbedding`, retains its
384-dimensional values, creates empty `embedding vector(768)`, and marks previously
COMPLETED documents FAILED with a re-ingestion message. Source paths, chunks and
old model metadata are preserved at this point. Generate the matching client with
`npm run db:generate`; do not advertise the corpus as ready until rebuilt.

Inspect column types and counts after the upgrade. Prisma schema declares the
active 768-vector and 384-dimensional legacy vector because legacy is retained for
compatibility. Do not normalize/pad vectors from another model. The real SQL
harness tests stored legacy values as well as dimensions and original references.

## Rebuild one document at a time

Use an authenticated admin/manager from the owning organization. Page through
`GET /api/v1/documents?status=FAILED&limit=20` and select only records with the
embedding-upgrade message. Keep an operator progress sheet containing organization,
document ID, original checksum, start/end, status and sanitized error—no source text.
Choose a small explicit batch; do not run an unrestricted bulk script.

For each ID, recover text from the approved original using the matching parser.
For text/Markdown, retain the original content. PDF/DOCX extraction needs inspection;
page provenance is not fixed by this procedure. Submit the exact text through
`POST /api/v1/documents/:id/ingest-text` with `{ "text": "<approved original text>" }`.
The server chooses the supported embedding model; a client-supplied model name
cannot substitute different vectors. Existing storage references are not rewritten
by this endpoint, so this operation is a rebuild of that original, not a source
replacement feature. Source replacement/versioning remains Part 07.

Poll the document detail. Only COMPLETED with nonempty chunks and Nomic model
metadata is success. Inspect a known supported question/source before moving on.
On FAILED, preserve the progress entry, identify the cause and retry that ID after
repair; never loop indefinitely. On PROCESSING, do not issue concurrent rebuilds.
A crashed process can leave PROCESSING stranded: pause and escalate to the operator
recovery procedure; automatic stale-job recovery remains Part 06.

Successful re-ingestion replaces old chunk rows and therefore removes their legacy
vectors from the active tables. The pre-upgrade backup is required to preserve
those old rows and historical references beyond rebuild. The migration alone is
non-destructive; do not claim that rebuilding keeps every old vector in place.
There is no durable source-version history until Part 07.

## Recovery and acceptance

Failed transactional chunk/vector replacement rolls back those writes. A failed
service operation pauses the document as FAILED, excluding it from new retrieval.
Do not reverse the forward migration or run old vector-alteration scripts. Restore
the matched database/original backup into a separate environment to investigate;
choose restoration or a forward fix with the operator before resuming service.

Local `npm run test:db` checks clean Prisma deploy/no-op replay, pre-forward upgrade,
legacy preservation, explicit rebuild, vector dimensions/indexes, paused-document
exclusion and rollback. Its deterministic vectors prove SQL/transaction behavior,
not model usefulness or production capacity. HTTP/parser acceptance is 03C; live
quality, customer workload and backup/restore acceptance remain separate gates.
