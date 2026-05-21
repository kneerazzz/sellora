# Codex Work Log

## Current Task

Start building the next backend steps for Sellora based on the project README.

Initial focus:

- API key authentication support for external workflows such as n8n.
- Webhook intake endpoints for events sent by n8n or external systems.
- Workflow run tracking for accepted webhook events.

## Changes Made

- Added an API key management module at `/api/v1/api-keys`.
- Added webhook intake routes at `/api/v1/webhooks`.
- Wired the new modules into the main API router.
- Fixed validation middleware so parsed query parameters are assigned back to `req.query`.
- Added `ignoreDeprecations` to the server TypeScript config so TypeScript 6 accepts the existing `baseUrl` setup.
- Regenerated Prisma Client so the existing schema models/enums for API keys, webhook events, workflow runs, and integrations are available to TypeScript.

## Project Progress

Done in this task:

- API key creation, listing, and revocation.
- API keys are generated securely.
- API keys are stored as SHA-256 hashes.
- Raw API keys are returned only once on creation.
- API key routes are protected by JWT auth.
- API key management is limited to `ADMIN` and `MANAGER` users.
- Webhook routes authenticate using the existing API-key middleware.
- Webhook requests are stored as `WebhookEvent` records.
- Each accepted webhook creates a queued `WorkflowRun`.
- TypeScript compilation passes.
- Prisma schema validation passes.

Still left from the README next steps:

- Add tests for API key and webhook modules.
- Add migrations if the deployed database is not already aligned with the Prisma schema.
- Add background workers to process queued workflow runs.
- Build the AI extraction service for email/call transcript summaries.
- Build document upload and ingestion.
- Add PDF/text parsing.
- Add embedding generation and vector storage.
- Add RAG answer endpoint with citations and refusal behavior.
- Add CRM writeback payload generation.
- Add n8n workflow examples or docs.
- Add frontend/admin UI for API keys, webhook logs, and workflow runs.

## Files Created

### `apps/server/src/modules/apiKeys/apiKeys.schema.ts`

Defines Zod schemas and TypeScript types for:

- creating API keys
- listing API keys
- validating API key IDs

### `apps/server/src/modules/apiKeys/apiKeys.service.ts`

Contains API key business logic:

- secure raw key generation
- SHA-256 key hashing
- database creation
- paginated listing
- revocation by setting `isActive` to `false`

### `apps/server/src/modules/apiKeys/apiKeys.controller.ts`

Handles HTTP responses for API key operations:

- create key
- list keys
- revoke key

### `apps/server/src/modules/apiKeys/apiKeys.router.ts`

Defines `/api/v1/api-keys` routes and protects them with:

- JWT authentication
- `ADMIN` / `MANAGER` authorization
- request validation

### `apps/server/src/modules/webhooks/webhooks.schema.ts`

Defines the webhook request body schema.

Webhook payloads must be JSON objects so they can be safely stored in Prisma JSON fields.

### `apps/server/src/modules/webhooks/webhooks.service.ts`

Stores incoming webhook events and creates queued workflow runs in a transaction.

It maps webhook event types to workflow run types such as:

- `SALES_EVENT_EXTRACTION`
- `GROUNDED_TECHNICAL_ANSWER`
- `CRM_UPDATE_PREPARATION`
- `CUSTOM`

### `apps/server/src/modules/webhooks/webhooks.controller.ts`

Creates reusable webhook intake handlers for each route.

Returns `202 Accepted` when the event is stored and queued.

### `apps/server/src/modules/webhooks/webhooks.router.ts`

Defines `/api/v1/webhooks` routes:

- `POST /email-received`
- `POST /call-transcript`
- `POST /crm-event`
- `POST /manual-question`

All routes require an API key with `WEBHOOK_ONLY` or `FULL_ACCESS` scope.

## Files Modified

### `apps/server/src/routes/index.ts`

Registered the new route modules:

- `/api-keys`
- `/webhooks`

### `apps/server/src/middleware/validate.middleware.ts`

Updated validation middleware to assign parsed query values back to `req.query`.

This makes coerced/defaulted query params available to controllers.

### `apps/server/tsconfig.json`

Added:

```json
"ignoreDeprecations": "6.0"
```

This lets the current TypeScript config continue compiling under TypeScript 6.

## Verification Run

Commands run:

```bash
npx prisma generate
npx prisma validate
npx tsc --noEmit
npm start
```

Results:

- Prisma Client generation passed.
- Prisma schema validation passed.
- TypeScript compilation passed.
- Server started and connected to PostgreSQL on `http://localhost:4000`.

Note:

- `tsx` could not run inside the default sandbox because it could not create its IPC pipe under `/tmp`.
- `npm start` succeeded after running outside the sandbox with approval.
- The quick `curl` smoke check did not complete because the server tool session ended before the requests connected.

## Next Recommended Task

Add automated tests for:

- API key creation/list/revocation.
- API key scope enforcement.
- Webhook event persistence.
- Workflow run creation.
- Organization isolation.

---

## Task: AI Extraction From Emails/Transcripts

Build the first real AI workflow for Sellora: extract structured sales intelligence from emails, call transcripts, CRM notes, and manual text.

## Changes Made

- Added a direct AI extraction endpoint.
- Added an OpenAI Responses API integration using Structured Outputs.
- Added strict Zod validation for extraction inputs and outputs.
- Added AI audit logging through the existing `AiInteraction` Prisma model.
- Added workflow-run processing for queued `SALES_EVENT_EXTRACTION` runs.
- Connected workflow processing to webhook-created workflow runs.
- Added `OPENAI_EXTRACTION_MODEL` to `apps/server/.env.sample`.
- Registered new route modules in the main API router.

## New Routes

### `POST /api/v1/ai/extractions/sales-event`

JWT-protected endpoint for direct manual extraction.

Input supports:

- `EMAIL`
- `CALL_TRANSCRIPT`
- `CRM_NOTE`
- `MANUAL`

Output includes:

- summary
- next steps
- buyer questions
- objections
- risk flags
- CRM update suggestion
- confidence
- confidence reason
- AI interaction ID

### `POST /api/v1/workflow-runs/:id/process`

JWT-protected endpoint for processing a queued workflow run.

Current support:

- `SALES_EVENT_EXTRACTION`

Behavior:

- marks the workflow run as `RUNNING`
- normalizes webhook payload into an extraction input
- calls the AI extraction service
- saves structured output to `WorkflowRun.output`
- saves confidence to `WorkflowRun.confidence`
- marks related `WebhookEvent` as `COMPLETED` or `FAILED`

## Files Created

### `apps/server/src/modules/aiExtractions/aiExtractions.schema.ts`

Defines request and response schemas for sales-event extraction.

### `apps/server/src/modules/aiExtractions/aiExtractions.service.ts`

Handles:

- OpenAI API calls
- Structured Outputs JSON schema
- extraction prompt construction
- output parsing and validation
- `AiInteraction` audit logging
- webhook payload normalization

### `apps/server/src/modules/aiExtractions/aiExtractions.controller.ts`

HTTP controller for direct sales-event extraction.

### `apps/server/src/modules/aiExtractions/aiExtractions.router.ts`

Defines the direct extraction route:

- `POST /sales-event`

### `apps/server/src/modules/workflowRuns/workflowRuns.schema.ts`

Defines route param validation for workflow run IDs.

### `apps/server/src/modules/workflowRuns/workflowRuns.service.ts`

Processes queued workflow runs and stores AI extraction results.

### `apps/server/src/modules/workflowRuns/workflowRuns.controller.ts`

HTTP controller for workflow-run processing.

### `apps/server/src/modules/workflowRuns/workflowRuns.router.ts`

Defines:

- `POST /:id/process`

## Files Modified

### `apps/server/src/routes/index.ts`

Registered:

- `/ai/extractions`
- `/workflow-runs`

### `apps/server/.env.sample`

Added:

```bash
OPENAI_EXTRACTION_MODEL=gpt-4o-mini
```

### `apps/server/tsconfig.json`

Restored:

```json
"ignoreDeprecations": "6.0"
```

This is needed for TypeScript 6 with the current path alias config.

## Verification Run

Commands run:

```bash
npx tsc --noEmit
npx prisma validate
```

Results:

- TypeScript compilation passed.
- Prisma schema validation passed.

Not run:

- Live OpenAI extraction request, because that requires a valid `OPENAI_API_KEY` and network access.
- Automated tests, because the project does not have a test setup yet.

## Project Progress After This Task

Done:

- Auth foundation.
- Users foundation.
- Invites foundation.
- Leads foundation.
- API keys for n8n/external workflows.
- Webhook intake.
- Workflow run creation.
- AI extraction for sales events.
- Manual workflow-run processing.
- AI interaction audit logging.

Still left:

- Automated tests.
- Background worker queue instead of manual `/process`.
- n8n callback/response pattern.
- CRM field mapping layer.
- CRM writeback payload templates.
- Document upload.
- Document parsing/chunking.
- Embeddings and vector search.
- RAG answer endpoint with citations.
- Frontend/admin UI.

---

## Task: Refactor AI Extraction Helpers Into Utils

The AI extraction module was getting crowded because service-level DB orchestration and lower-level OpenAI helper functions lived in the same file.

## Changes Made

- Added `apps/server/src/utils/aiExtraction.ts`.
- Moved reusable AI extraction helpers out of the module service:
  - OpenAI Responses API call
  - sales extraction system prompt
  - structured output JSON schema
  - user prompt builder
  - OpenAI output text extraction
  - webhook payload normalization
- Kept `apps/server/src/modules/aiExtractions/aiExtractions.service.ts` as the module service for:
  - validating lead/deal ownership
  - calling the AI utility
  - writing `AiInteraction` audit logs
- Updated workflow-run processing to import webhook normalization from `utils`.

## Files Created

### `apps/server/src/utils/aiExtraction.ts`

Reusable utility functions for AI extraction and webhook payload normalization.

## Files Modified

### `apps/server/src/modules/aiExtractions/aiExtractions.service.ts`

Reduced this file to module-specific business logic and database work.

### `apps/server/src/modules/workflowRuns/workflowRuns.service.ts`

Updated imports to use the new utility file.

## Verification Run

Command run:

```bash
npx tsc --noEmit
```

Result:

- TypeScript compilation passed.

---

## Task: Workflow Observability And n8n-Friendly Webhook Processing

Added the missing API pieces needed to test and operate webhook-created workflow runs.

## Changes Made

- Added workflow run list route.
- Added workflow run detail route.
- Improved webhook response shape for n8n/Postman usage.
- Added `process=true` query support to webhook routes for MVP immediate processing.
- Kept manual processing route available for queued runs.
- Restored `ignoreDeprecations` in `apps/server/tsconfig.json` so TypeScript 6 compilation works with the current path alias config.

## New/Updated Routes

### `GET /api/v1/workflow-runs`

Lists workflow runs for the authenticated user's organization.

Supported query params:

```txt
page
limit
status
type
```

Example:

```txt
GET /api/v1/workflow-runs?page=1&limit=20&status=QUEUED
```

### `GET /api/v1/workflow-runs/:id`

Returns a single workflow run with:

- input
- output
- status
- confidence
- error message
- linked webhook event details
- original webhook payload

### `POST /api/v1/workflow-runs/:id/process`

Still processes a queued workflow run manually.

Current supported workflow type:

- `SALES_EVENT_EXTRACTION`

### `POST /api/v1/webhooks/*?process=true`

Webhook routes now support immediate processing.

Example:

```txt
POST /api/v1/webhooks/email-received?process=true
```

Behavior:

- stores `WebhookEvent`
- creates `WorkflowRun`
- processes the run immediately when supported
- returns the processed workflow run and AI output

Without `process=true`, the webhook returns `202 Accepted` with a queued workflow run.

## Better Webhook Response

Webhook responses now include:

```json
{
  "webhookEventId": "...",
  "workflowRunId": "...",
  "status": "QUEUED",
  "workflowType": "SALES_EVENT_EXTRACTION",
  "processUrl": "/api/v1/workflow-runs/.../process"
}
```

This makes it easier for n8n to call the next processing step.

## Files Modified

### `apps/server/src/modules/workflowRuns/workflowRuns.schema.ts`

Added query validation for listing workflow runs.

### `apps/server/src/modules/workflowRuns/workflowRuns.service.ts`

Added:

- `listWorkflowRuns`
- `getWorkflowRunById`

### `apps/server/src/modules/workflowRuns/workflowRuns.controller.ts`

Added controllers for list and detail routes.

### `apps/server/src/modules/workflowRuns/workflowRuns.router.ts`

Registered:

- `GET /`
- `GET /:id`
- existing `POST /:id/process`

### `apps/server/src/modules/webhooks/webhooks.schema.ts`

Added `process=true|false` query validation.

### `apps/server/src/modules/webhooks/webhooks.service.ts`

Added a helper for building flattened webhook responses.

### `apps/server/src/modules/webhooks/webhooks.controller.ts`

Added immediate processing behavior when `process=true`.

## Verification Run

Commands run:

```bash
npx tsc --noEmit
npx prisma validate
npm start
```

Results:

- TypeScript compilation passed.
- Prisma schema validation passed.
- Server started and connected to PostgreSQL.

## Notes

- `manual-question` currently creates a `GROUNDED_TECHNICAL_ANSWER` workflow run, but processing that type still requires the future document/RAG system.
- `process=true` is most useful right now for `email-received` and `call-transcript`, because those map to `SALES_EVENT_EXTRACTION`.
