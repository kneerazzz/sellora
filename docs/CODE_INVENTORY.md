# Bounded code inventory — October 2, 2026

Searched runtime imports, route registration, scripts, package manifests, tests,
Compose, UI entrypoints, workflow examples and docs. No client data or applied
migrations were cleanup targets. Remaining candidates require separate evidence.

| Candidate | Classification / action | Reason and remaining gate |
| --- | --- | --- |
| `types/queue.types.ts` | Unused; removed | Both exported job payload types had no import/consumer; current worker uses database workflow types |
| `OpenAIEmbeddingProvider.ts` | Unimplemented/superseded stub; removed | Only factory reference removed in 02B; supported schema now rejects this configuration before work begins |
| Widget bootstrap in web `index.html` | Outside staff offer; removed from staff shell | Bootstrapped a deferred widget and substituted browser API credentials; staff workflow uses authenticated `/draft` |
| `apps/copilot` and copied `apps/web/public/sellora-widget.js` | Deferred; retained | Separate widget development remains possible; copied artifact remains publicly servable until release packaging excludes/audits it. Removing bootstrap does not repair widget security |
| CRM routes and preview UI | Deferred/retained | Routes and payload tests are active; previews are not execution and cannot be deleted as dead code |
| `utils/llm.ts` and `utils/aiExtraction.ts` | Active duplicated transport; retained | Both have callers; consolidate bounded transport with usage/deadline contracts in 05A |
| `llamaindex`, `@llamaindex/ollama`, Transformers | Active; retained | Chunking, embeddings and reranker imports exist; not unused despite large install footprint |
| `nodemon`, `@types/connect`, `@types/bcryptjs` | Possible dependency cleanup; retained | Not needed by current dev command, but removal offers little immediate benefit; review transitive/tool ownership separately |
| Redis Compose service | Legacy development-only; retained profile | API/worker do not consume Redis; opt-in `legacy-redis` preserves older local workflows |
| Pinecone migration references | Historical/applied; retained | They describe database history and are necessary for replay, not dead runtime code |
| `bulkIngest.ts`, crawler, cleanup/vector scripts, answer/RFP scripts | Operational/development-only; retained | Not included in validation; bulk-ingest user edit preserved. These can affect data/providers and were not executed |
| n8n workflows | Integration examples; retained | Contract/real-channel acceptance remains 11/12, not implied by filenames |

Validation: server typecheck and web production build; source searches confirmed
no remaining imports of the two deleted modules. Git retains the removed source
and bootstrap for recovery. No routes, migrations, uploaded originals or records
were removed.

## October 18 critical-path review — 13D

The RFP parser logged extracted question text through `DEBUG_GROQ_OUTPUT`.
The local embedding adapter logged an unexpected SDK error and placed its raw
message in the HTTP error. Both could expose document content, so those outputs
were removed. An adapter test asserts the returned error omits secret text.
Provider validation and the typed `ProviderOperationError` path remain intact.

The touched embedding, document and retrieval paths were checked for broad
`any`, unbounded loops, unsafe SQL, hidden fallbacks and DTO changes. The
existing vector write uses `$executeRawUnsafe` with fixed SQL and bound `$1`/`$2`
parameters; the retrieval query uses `Prisma.sql` parameters. Both stayed as-is.
The ingestion loop is bounded by document limits; the embedding request remains
bounded by `PROVIDER_INPUT_MAX_CHARS`. Parser normalization and model instance
typing still contain `any`; a narrow type rewrite would not remove a measured
maintenance defect here. No helper, route, DTO or import was removed.
