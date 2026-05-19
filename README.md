# Sellora

AI-native technical sales workflow backend for teams that already use a CRM.

Sellora is not a CRM replacement. It is an AI execution layer that sits behind
n8n and connects to tools like Salesforce, HubSpot, Gmail, Slack, and meeting
transcription systems. n8n handles the external app plumbing; Sellora handles the
hard AI work: technical document ingestion, grounded answers, structured sales
event extraction, audit logs, and CRM-ready update payloads.

## Product Direction

High-ticket B2B sales teams lose time and deals because reps cannot reliably
answer deep technical buyer questions and do not consistently log useful CRM
data. Generic AI tools are risky because they hallucinate product details.

Sellora solves this by turning a company knowledge base into a grounded AI
sidekick and workflow brain:

- ingest technical PDFs, docs, policies, API guides, and implementation notes
- answer technical buyer questions only from approved company sources
- return citations so reps can verify the source
- refuse to answer when the docs do not contain enough evidence
- extract summaries, objections, next steps, risks, and CRM updates from emails
  or call transcripts
- return structured JSON to n8n so n8n can update Salesforce, HubSpot, Slack,
  Gmail, or other tools

## Architecture

```txt
External tools
  Salesforce / HubSpot / Gmail / Slack / Recall.ai / Calendar
        |
        v
n8n workflows
  listens for events, calls Sellora, writes results back to apps
        |
        v
Sellora backend
  auth, org isolation, AI extraction, RAG, citations, audit logs
        |
        v
PostgreSQL + Redis + Vector store + LLM provider
```

The important boundary:

```txt
CRM remains the source of truth.
Sellora stores knowledge, mappings, AI traces, workflow runs, and cached context.
```

## n8n Role

n8n should own integration plumbing:

- listen for CRM events
- receive email events
- receive meeting transcript events
- call Sellora webhook/API endpoints
- update Salesforce or HubSpot
- post draft replies to Slack or Gmail
- route approval steps to humans

Sellora should own AI and trust:

- document ingestion
- retrieval and reranking
- answer generation
- refusal behavior
- source citations
- structured extraction
- confidence scoring
- audit logs
- tenant isolation

This keeps the MVP fast to build. Instead of writing every CRM/email connector
inside Sellora, n8n handles connectors and Sellora becomes the reliable AI brain.

## Current Implementation

This repository currently contains the backend foundation:

- Express + TypeScript API
- Prisma + PostgreSQL schema
- Docker Compose for PostgreSQL and Redis
- JWT auth with refresh-token sessions
- organization/user/invite foundation
- lead module foundation
- broad schema for documents, chunks, activities, deals, workflows, API keys,
  and AI interactions

The current code does not yet include:

- frontend app
- document upload
- PDF parsing
- embedding generation
- vector search
- RAG answer endpoint
- reranker
- n8n webhook endpoints
- CRM writeback layer
- BullMQ workers
- production tests

## What To Build Next

Build Sellora as an n8n-compatible AI workflow backend.

### 1. API Key Auth For External Workflows

n8n needs a stable way to call Sellora without a user session.

Required:

- create org-scoped API keys
- hash API keys in the database
- support scopes such as `WEBHOOK_ONLY`, `READ_ONLY`, and `FULL_ACCESS`
- authenticate requests using `Authorization: Bearer <api_key>`
- attach `organizationId` to the request context

Useful existing schema:

- `ApiKey`
- `Organization`

### 2. Webhook Event Intake

Create endpoints designed for n8n.

Example routes:

```txt
POST /api/v1/webhooks/email-received
POST /api/v1/webhooks/call-transcript
POST /api/v1/webhooks/crm-event
POST /api/v1/webhooks/manual-question
```

Each incoming request should be stored before processing.

Recommended table:

```txt
WebhookEvent
  id
  organizationId
  source
  eventType
  externalObjectType
  externalObjectId
  payload
  status
  receivedAt
  processedAt
  errorMessage
```

### 3. Workflow Run Tracking

Every event processed by Sellora should create a workflow run.

Recommended table:

```txt
WorkflowRun
  id
  organizationId
  webhookEventId
  workflowType
  status
  input
  output
  confidence
  startedAt
  completedAt
  errorMessage
```

This gives customers an audit trail and makes debugging n8n workflows easier.

### 4. AI Extraction Endpoint

This is separate from RAG.

Input:

- email body
- call transcript
- CRM context
- optional known lead/deal metadata

Output:

```json
{
  "summary": "Buyer asked about SSO, SOC 2, and implementation timeline.",
  "nextSteps": [
    "Send SSO documentation",
    "Schedule security review"
  ],
  "buyerQuestions": [
    "Does the product support SAML SSO?",
    "Is SOC 2 Type II available?"
  ],
  "riskFlags": [
    "Security review required before purchase"
  ],
  "crmUpdate": {
    "stage": "Technical Validation",
    "lastActivitySummary": "Discussed SSO and SOC 2 requirements.",
    "nextFollowUpAt": "2026-05-22T10:00:00.000Z"
  },
  "confidence": "high"
}
```

n8n can then map `crmUpdate` into Salesforce or HubSpot fields.

### 5. Document Ingestion

Build the knowledge brain.

Flow:

```txt
Upload document
  -> store file
  -> extract text
  -> split into chunks
  -> create embeddings
  -> store vectors by organization namespace
  -> save document/chunk metadata in PostgreSQL
```

Required:

- upload endpoint
- document status tracking
- background worker using BullMQ
- parser for PDF first
- chunking with overlap
- embedding service
- vector upsert service

Useful existing schema:

- `Document`
- `DocumentChunk`

### 6. Grounded Answer Endpoint

This is the core Sellora value.

Input:

```json
{
  "question": "Do we support SAML SSO?",
  "context": {
    "leadExternalId": "003...",
    "dealExternalId": "006..."
  }
}
```

Output:

```json
{
  "answer": "Yes. The documentation says SAML 2.0 SSO is supported...",
  "confidence": "high",
  "citations": [
    {
      "documentId": "doc_123",
      "documentName": "Security Overview.pdf",
      "pageNumber": 7,
      "chunkId": "chunk_456",
      "snippet": "..."
    }
  ],
  "refused": false
}
```

If evidence is weak:

```json
{
  "answer": "I cannot find this in the technical documentation.",
  "confidence": "low",
  "citations": [],
  "refused": true
}
```

Required:

- query embedding
- vector search
- reranking or relevance threshold
- grounded prompt
- citation assembly
- refusal logic
- `AiInteraction` audit record

### 7. n8n Workflow Examples

#### Email Received

```txt
Gmail/Outlook trigger
  -> n8n sends email body to Sellora
  -> Sellora extracts summary, questions, next steps, CRM update payload
  -> if buyer asked technical question, Sellora generates grounded draft reply
  -> n8n updates CRM activity
  -> n8n sends Slack approval message or creates Gmail draft
```

#### Call Transcript Completed

```txt
Recall.ai/transcript trigger
  -> n8n sends transcript to Sellora
  -> Sellora extracts objections, risks, next steps, MEDDICC-style notes
  -> Sellora detects technical questions and answers them with citations
  -> n8n updates opportunity notes and creates follow-up tasks
```

#### Manual Technical Question

```txt
Slack command or internal form
  -> n8n sends question to Sellora
  -> Sellora returns grounded answer with citations
  -> n8n posts answer back to Slack
```

## What Not To Build First

Avoid rebuilding a CRM.

Do not prioritize:

- full internal deal Kanban
- complex lead management UI
- internal task management
- full workflow builder UI
- custom Salesforce/HubSpot connectors inside Sellora
- large dashboard before the AI workflow works

These can come later, but they are not required for the first sellable version.

For the MVP, the CRM should remain Salesforce/HubSpot. Sellora should store only
what it needs for AI, auditability, and workflow processing.

## Data Model Direction

Keep:

- `Organization`
- `User`
- `Invite`
- `ApiKey`
- `Document`
- `DocumentChunk`
- `AiInteraction`
- `Activity`

Use carefully:

- `Lead`
- `Deal`
- `Task`

These should be cached mirrors of CRM data, not the primary source of truth.

Add:

- `Integration`
- `ExternalObjectMapping`
- `WebhookEvent`
- `WorkflowRun`
- `SyncLog`

Recommended ownership:

```txt
Salesforce/HubSpot owns:
  contacts, companies, opportunities, stages, tasks

Sellora owns:
  documents, chunks, embeddings, AI outputs, workflow logs, citations, mappings

n8n owns:
  app connectors, routing, approvals, writeback actions
```

## Technical Stack

Current:

- Node.js
- Express
- TypeScript
- Prisma
- PostgreSQL
- Redis
- Docker Compose

Planned:

- BullMQ for background jobs
- OpenAI or compatible LLM provider
- vector database, initially Pinecone or pgvector
- n8n for external workflow orchestration
- optional Next.js frontend later

## Local Development

Root services:

```bash
docker compose up -d
```

Server:

```bash
cd apps/server
npm install
npm run dev
```

Type check:

```bash
cd apps/server
npx tsc --noEmit --ignoreDeprecations 6.0
```

The current `tsconfig.json` uses `baseUrl`, which TypeScript 6 warns about.
Either keep the command above or add the compiler option:

```json
{
  "compilerOptions": {
    "ignoreDeprecations": "6.0"
  }
}
```

## MVP Definition

The first sellable version should prove this loop:

```txt
Company uploads docs
  -> buyer sends email or call transcript arrives
  -> n8n sends event to Sellora
  -> Sellora extracts CRM-ready structured data
  -> Sellora answers technical questions with citations
  -> n8n updates CRM and creates a draft reply
```

That is the core product.

Once this works reliably, add:

- richer CRM mappings
- approval workflows
- Slack bot interface
- frontend dashboard
- admin UI for documents and API keys
- analytics on unanswered questions
- custom playbooks per customer

## Positioning

Sellora should be sold as a sales enablement overlay:

> Keep your CRM. Keep your current workflows. Sellora plugs into n8n, reads your
> technical documentation, and gives your reps grounded answers, clean CRM
> updates, and audit-ready citations.

The wedge is not "replace Salesforce."

The wedge is:

> Never let a sales rep guess on a technical buyer question again.
