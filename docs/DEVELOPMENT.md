# Local development

## Installation contract

Supported baseline: Node 22 (at least 22.12), npm 12. Verified versions are pinned
in `.nvmrc` and root `packageManager`. Each app owns its package.json and lockfile;
this repository is not an npm workspace. Root scripts only coordinate checks.
Do not depend on root/global packages to run an app.

From the repository root:

```sh
npm ci
npm --prefix apps/server ci
npm --prefix apps/web ci --allow-remote=all
npm --prefix apps/copilot ci
```

Generate the Prisma client before server compilation. Generation needs a URL for
config parsing but makes no database connection; an explicit dummy target is safe:

```sh
cd apps/server
DATABASE_URL=postgresql://unused:unused@127.0.0.1:1/sellora_test_generate npm run db:generate
```

Do not commit `.env`, provider keys, connection strings, uploaded files or client
documents. Do not use `db push` to repair migration drift. `db:deploy` changes the
selected database and must only run against an intentionally chosen target.

## Checks

At the repository root, `npm test` runs server unit/mocked tests. `npm run check`
runs server typecheck/tests and both frontend production builds. These do not run
operational scripts, start the worker, contact a model, or test a live database.

The separately selected `npm run test:integration` in `apps/server` requires
`SELLORA_DISPOSABLE_DATABASE_URL`: a fresh, empty localhost `sellora_test_*`
database with pgvector. It rejects missing/remote/non-test/nonempty targets and
uses deterministic vectors/generation. Never point it at an existing `.env` URL.
It executes historical SQL directly, so migration deployment is an additional
check, not implied by this harness. Tests intentionally leave fixtures for
inspection; remove only the specifically created disposable service afterwards.

Install/build failures must be reported, not bypassed with stale `node_modules`.
Model downloads, model quality and browser/client acceptance are separate gates.

npm 12 uses explicit `allowScripts` policies in each app: native build/runtime
dependencies are allowed; optional fsevents and protobufjs's informational
postinstall are denied. The web install explicitly allows URL dependencies because
Tailwind's locked optional WASM fallback is a registry tarball URL. This flag is
per command, not a change to global npm configuration; review lockfile changes.

## Supported configuration and processes

Run the API/worker from `apps/server` so dotenv and relative document storage use
that app directory. Supply configuration through a private app `.env` or the
process environment. Compose reads its separate root `.env`; it does not inject
settings into apps started on the host. Secrets below are listed by name only.

| Setting | Purpose / supported behavior |
| --- | --- |
| `DATABASE_URL` | Required PostgreSQL connection with pgvector; choose the target deliberately |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | Required distinct random secrets, at least 32 characters each |
| `JWT_ACCESS_EXPIRES_IN`, `JWT_REFRESH_EXPIRES_IN` | Defaults 15m / 7d |
| `NODE_ENV`, `PORT` | development/test/production; API defaults to port 4000 |
| `CLIENT_URL` | Exact dashboard origin for credentialed CORS; local default localhost:3000 |
| `DOCUMENT_STORAGE_DIR` | Defaults to `uploads/documents` relative to the server working directory; use persistent writable storage for real data |
| `DOCUMENT_UPLOAD_MAX_BYTES` | Positive integer; current default 25 MiB is an implementation setting, not a verified workload allowance |
| `EMBEDDING_PROVIDER` | Only `local` is supported; other values fail startup |
| `LOCAL_EMBEDDING_SERVICE_URL` | Ollama endpoint; local default loopback port 11435 |
| `AI_PROVIDER` | Generation/extraction: groq (default) or openai |
| `GROQ_API_KEY`, `GROQ_EXTRACTION_MODEL` | Groq generation credentials/model override |
| `OPENAI_API_KEY`, `OPENAI_EXTRACTION_MODEL` | OpenAI generation credentials/model override; does not enable OpenAI embeddings |
| `WORKFLOW_WORKER_POLL_INTERVAL_MS`, `WORKFLOW_WORKER_BATCH_SIZE` | Worker controls, defaults 10000 ms / 5; use positive integers |
| `VITE_API_URL` | Optional dashboard API base, default `/api/v1`; Vite values are public, never secrets |

Extraction's legacy `OPENAI_MODEL`/`GROQ_MODEL` aliases still exist; use the explicit
`*_EXTRACTION_MODEL` names consistently. Provider keys are optional for compile,
tests and startup; actual generation requires the selected provider configuration.
Missing provider calls/fallbacks are not proof of answer quality.

Development infrastructure: Compose `postgres` uses pgvector/pg15, configured by
`POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `POSTGRES_PORT`; `ollama` maps
`OLLAMA_PORT` (default 11435). For an explicitly chosen local development target,
start only `docker compose up -d postgres ollama`, then run `npm run db:deploy`
from the server with that target selected. Existing data needs the 03B upgrade
procedure first. Compose is not a production deployment.

Install Nomic explicitly on the chosen local Ollama service with
`docker compose exec ollama ollama pull nomic-embed-text` before real ingestion.
This downloads model data and uses disk/compute; it is not part of default checks
and was not run for this packet. Vectors must be Nomic/768. The reranker downloads
`Xenova/bge-reranker-base` on first real use; plan its cache/network access. Local
embedding/reranking does not prevent generation from sending text to a provider.

Start separate terminals: `npm run dev` in `apps/server`, `npm run dev` in
`apps/web`, and only when deliberately processing that database's queue,
`npm run worker:workflows` in `apps/server`. Vite proxies `/api` to localhost:4000;
keep the proxy and API port aligned if changing ports. `/health` is liveness only.
The widget remains deferred and its demo is not the staff workflow.

Redis is unused by the present API and PostgreSQL-polling worker: `REDIS_URL` is
no longer required. Its Compose service is retained behind `legacy-redis` for
older local setups; this change does not stop or delete any running Redis service.

## Tooling and CI

Use existing TypeScript/ES module conventions, two spaces in touched code, and
`git diff --check` before handoff. Typechecks include the integration harnesses.
There is no repository-wide formatting rewrite or new lint baseline in this part.

`npm --prefix apps/server run test:db` is an explicit Docker-backed check. It
creates a uniquely named, labelled pgvector/pg15 container with loopback-only
dynamic port and tmpfs storage; deploys migrations twice on a new database;
checks actual API startup/health/unauthenticated rejection and worker startup on
an empty queue; then runs the historical-upgrade/vector/session harness on a
second fresh database. It removes its own container/storage in `finally`, even
when checks fail. It never reuses `DATABASE_URL` or dotenv files. A forced kill or
host crash may require inspecting `sellora.disposable=true` containers manually.

Docker access and an image download may be required. Default `npm run check`
does **not** run this database check; run both for a foundation acceptance. CI in
`.github/workflows/checks.yml` requires both with no silent integration skip and
no provider credentials. CI configuration is local until pushed by the user; a
local pass is not a hosted GitHub Actions pass. Startup smoke does not establish
worker crash recovery, authenticated staff journeys or live model quality.
