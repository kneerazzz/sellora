# Local performance baseline — packets 13A/13B

**Measured:** 2026-10-18. Synthetic text and deterministic model adapters only.
Run from `apps/server`:

```sh
node scripts/integration/runDisposable.mjs --performance-only
```

The runner owns a fresh loopback-only pgvector/pg15 container, deploys migrations
twice, writes [raw summaries and plan nodes](evidence/performance-raw.json), then
removes its database and container. The benchmark temporarily removes the new text
index to capture the baseline, recreates it for the candidate, and verifies exact
result IDs plus organization, explicit document, retired-version and deleted-source
filters. No customer data, model download, live provider, or ambient `DATABASE_URL`
is used.

## Workloads and configuration

The manifest records Node v22.23.3, Linux 7.2.9-arch1-1, AMD Ryzen 5 7520U,
8 logical CPUs and 15.996 GB system memory. All cases use one synthetic TXT
document per organization, one active version, 768-dimensional fixed vectors,
the question `What is the refund policy?`, and 12, 160 or 1,200 chunks. The
small, medium and largest completed TXT inputs have 2,000, 100,000 and 250,000
characters. The first run is cold within the process; the next three are warm.
These are local cases, not a buyer workload or supported upload allowance.

| Case | TXT parse cold / warm ms | Structure chunk cold / warm ms | Search cold / warm ms | SQL plan baseline / GIN ms |
| --- | ---: | ---: | ---: | ---: |
| 2,000 characters, 12 chunks | 0.05 / 0.019–0.029 | 6.12 / 1.84–3.02 | 130.64 / 2.98–3.80 | 0.31–0.58 / 0.31–0.34 |
| 100,000 characters, 160 chunks | 0.03 / 0.045–0.124 | 3,272.81 / 3,206.00–3,238.35 | 19.78 / 5.22–6.13 | 1.87–2.28 / 1.13–2.40 |
| 250,000 characters, 1,200 chunks | 0.16 / 0.208–0.238 | 22,485.05 / 22,847.48–25,711.28 | 38.25 / 16.80–18.28 | 15.34–15.85 / 8.15–9.20 |

TXT parsing is a UTF-8 decode; PDF/DOCX parser latency is not represented. The
chunker dominates these runs. An earlier 1,000,000-character synthetic attempt
timed out after 600 seconds, with its disposable container cleaned; no completed
per-phase result exists for that size. The configured 1,000,000-character extracted
text ceiling is therefore **not a validated supported workload**. Prior 06D small
PDF evidence is separate and cannot establish a production capacity limit.

The deterministic answer path measured retrieval at 3.2–5.4 ms (small),
5.0–6.3 ms (medium), and 17.2–17.6 ms (large). Embedding, reranker and generation
adapters returned fixed values locally; their measured overhead was below 0.12 ms
per call and says nothing about model latency, quality, or cost. Full answer time
also includes usage reservation, trace and interaction writes: warm ranges were
26–33 ms, 23–25 ms and 34–39 ms. The script records process RSS per phase; this
process loaded the application and parsers, so RSS is not incremental memory per
document. Search used one SQL round trip per invocation. Synthetic bulk insertion
used one SQL round trip per case; it is not an ingestion write benchmark. Provider
request counts and monetary costs are unknown, not zero.

## Retrieval query decision

`searchSimilarChunks` fuses semantic and keyword candidates. Both branches already
filter organization, active version, nondeleted document and optional document ID.
The baseline keyword branch scanned chunks or used the version/chunk index.
The candidate GIN index on `to_tsvector('english', text)` appeared in medium and
large `EXPLAIN (ANALYZE, BUFFERS)` plans. PostgreSQL kept a sequential scan for
the tiny case. On the 1,200-chunk case, three baseline executions took
15.34–15.85 ms and three indexed executions took 8.15–9.20 ms. This measured
benefit justifies the single forward index migration. Candidate result IDs matched
the baseline exactly; foreign, empty-scope, retired and deleted reads returned no
chunks. The full disposable HTTP/SQL suite passed after the migration.

The migration uses a regular index build, so it may block writes while it runs on
a populated database. No client database was migrated. A later deployment needs
a maintenance window and a fresh measurement on its own data.

The index adds storage and write work; neither was measured on a real ingestion
workload. No vector index, candidate-count rewrite, batched production write or
query-filter change was made. Revisit those only with a representative corpus and
an agreed latency/resource target. The pending Astra review and live/client
acceptance remain separate gates.
