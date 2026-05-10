# Sellora — AI-First Sales Operating System
## Master Project Specification & Knowledge Layer

> **Version:** 1.0.0  
> **Status:** Active Development  
> **Stack:** Next.js 14 · Node.js/TypeScript · PostgreSQL · Redis · OpenAI · Pinecone · Docker

---

## Table of Contents

1. [Project Mission](#1-project-mission)
2. [Problem Statement](#2-problem-statement)
3. [Technical Architecture](#3-technical-architecture)
4. [Core Feature Modules](#4-core-feature-modules)
5. [Database Schema (Prisma)](#5-database-schema)
6. [Full File Structure](#6-full-file-structure)
7. [Environment Variables](#7-environment-variables)
8. [API Surface](#8-api-surface)
9. [2-Week Roadmap](#9-2-week-roadmap)
10. [Key Design Decisions](#10-key-design-decisions)

---

## 1. Project Mission

**Sellora** is an AI-native platform built to eliminate the manual overhead of traditional CRMs. Rather than acting as a passive *System of Record*, it operates as a *System of Execution* — one that understands a company's deep technical documentation and assists sales teams in real-time.

**Niche Focus:** Solving the *Technical Sales Knowledge Gap* for B2B Tech, Manufacturing, and Cybersecurity verticals, where sales reps are routinely outpaced by technical buyers and lose deals due to shallow product knowledge.

---

## 2. Problem Statement

| Pain Point | Current Reality | Sellora's Answer |
|---|---|---|
| **Manual Data Entry** | Reps waste ~30% of their time logging activities | Zero-data-entry via automated meeting/email logging |
| **Knowledge Silos** | Technical knowledge is trapped in PDFs, Wikis, Notion | RAG-powered ingestion — docs become queryable context |
| **Generic Outreach** | CRMs rely on static templates; personalization is manual | GPT-4o + Pinecone generates hyper-personalized, fact-grounded emails |
| **Objection Handling** | Junior reps have no real-time assist during live calls | AI assistant surfaces relevant doc snippets on demand |

---

## 3. Technical Architecture

### 6-Layer Model

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 1: Frontend          Next.js 14 App Router           │
│           Dashboard · Lead Tracker · AI Chat UI             │
├─────────────────────────────────────────────────────────────┤
│  Layer 2: Backend           Node.js / TypeScript            │
│           Express API · AI Orchestration · Auth Middleware  │
├─────────────────────────────────────────────────────────────┤
│  Layer 3: Database          PostgreSQL + Prisma ORM         │
│           Orgs · Users · Leads · Documents · Deals          │
├─────────────────────────────────────────────────────────────┤
│  Layer 4: Queue & Async     Redis + BullMQ                  │
│           PDF Embedding Jobs · Email Webhook Processing     │
├─────────────────────────────────────────────────────────────┤
│  Layer 5: AI & ML           OpenAI + Pinecone               │
│           text-embedding-3-small · GPT-4o · RAG Pipeline   │
├─────────────────────────────────────────────────────────────┤
│  Layer 6: Infrastructure    Docker + docker-compose         │
│           Postgres · Redis · (Pinecone is cloud-hosted)     │
└─────────────────────────────────────────────────────────────┘
```

### Data Flow: RAG Ingestion Pipeline

```
PDF Upload → Multer (server) → BullMQ Job Enqueued → Worker picks up job
→ pdf-parse extracts text → OpenAI text-embedding-3-small → float32 vectors
→ Pinecone upsert (namespace = orgId) → Prisma: Document record saved
→ Job marked "completed" → Webhook fires to frontend
```

### Data Flow: AI Chat / Email Drafting

```
User query → Backend /ai/chat → OpenAI embed query → Pinecone similarity search
→ Top-K chunks retrieved → GPT-4o prompt [system + context + query]
→ Streamed response → Frontend renders in chat UI
```

---

## 4. Core Feature Modules

### Module 1 — Auth & RBAC

- **JWT-based** multi-tenant authentication
- Roles: `ADMIN` · `MANAGER` · `REP`
- Middleware guards on all protected routes
- Refresh token rotation (stored in httpOnly cookie)
- Org-scoped data isolation (every query filtered by `organizationId`)

### Module 2 — Knowledge Ingestion

- Upload PDFs/DOCX via multipart form
- Background processing via BullMQ queue (prevents timeout on large files)
- `pdf-parse` for text extraction
- Chunking strategy: 500-token chunks with 50-token overlap
- Embeddings stored in Pinecone, metadata in Postgres `Document` table

### Module 3 — AI Sales Assistant

- Context-aware email drafting using retrieved document chunks
- Technical objection handling: rep asks a question → AI surfaces relevant spec page
- Prompt construction: `[System: You are a technical sales rep at {company}...] + [Context: {chunks}] + [User: {query}]`
- All interactions logged to `AiInteraction` table for audit/replay

### Module 4 — Zero-Data Entry

- Meeting summary auto-logging (Recall.ai webhook or manual transcript paste)
- Email interaction logging via Nylas or Gmail webhook
- Auto-updates `Lead.lastContactedAt` and `Deal.stage` based on event type
- Activity timeline assembled from `Activity` table

### Module 5 — Workflow Automation

- Event-based triggers stored in `WorkflowTrigger` table
- Example triggers: `LEAD_REPLIED` → move Deal to `NEGOTIATION`
- Example triggers: `DEAL_STALE_7_DAYS` → create Task for rep
- BullMQ delayed jobs handle time-based triggers

---

## 5. Database Schema

Full Prisma schema lives at `apps/server/prisma/schema.prisma`.

### Entities Overview

```
Organization ──┬── User (RBAC roles)
               ├── Document (knowledge base)
               ├── Lead ──── Activity
               │         └── Deal ──── AiInteraction
               ├── WorkflowTrigger
               └── ApiKey
```

### Table Breakdown

| Table | Purpose | Key Fields |
|---|---|---|
| `Organization` | Master multi-tenant entity | `id`, `name`, `slug`, `plan` |
| `User` | Auth + RBAC | `id`, `email`, `passwordHash`, `role`, `orgId` |
| `RefreshToken` | Token rotation | `id`, `token`, `userId`, `expiresAt` |
| `Document` | Knowledge base metadata | `id`, `filename`, `status`, `pineconeNamespace`, `orgId` |
| `DocumentChunk` | Chunk-level record | `id`, `chunkIndex`, `text`, `documentId` |
| `Lead` | CRM lead entity | `id`, `name`, `email`, `company`, `score`, `orgId` |
| `Deal` | Opportunity tracking | `id`, `leadId`, `stage`, `value`, `closeDateEstimate` |
| `Activity` | Timeline events | `id`, `type`, `summary`, `leadId`, `userId` |
| `AiInteraction` | All AI calls logged | `id`, `prompt`, `response`, `tokensUsed`, `leadId` |
| `Task` | Rep follow-up items | `id`, `title`, `dueDate`, `assignedTo`, `leadId` |
| `WorkflowTrigger` | Automation rules | `id`, `eventType`, `conditions`, `action`, `orgId` |
| `ApiKey` | External integrations | `id`, `keyHash`, `label`, `orgId` |

---

## 6. Full File Structure

```
sellora-ai-layer/
│
├── docker-compose.yml            # Postgres + Redis containers
├── .env                          # Root secrets (git-ignored)
├── .env.example                  # Template with all required keys
├── .gitignore
├── README.md
├── PROJECT_SPEC.md               # ← This file
│
├── apps/
│   │
│   ├── web/                      # Next.js 14 (App Router) Frontend
│   │   ├── package.json
│   │   ├── next.config.js
│   │   ├── tailwind.config.ts
│   │   ├── tsconfig.json
│   │   ├── postcss.config.js
│   │   ├── .env.local            # NEXT_PUBLIC_API_URL etc. (git-ignored)
│   │   │
│   │   ├── public/
│   │   │   └── logo.svg
│   │   │
│   │   └── src/
│   │       ├── app/                          # App Router root
│   │       │   ├── layout.tsx               # Root layout (fonts, providers)
│   │       │   ├── page.tsx                 # Landing / redirect
│   │       │   ├── globals.css
│   │       │   │
│   │       │   ├── (auth)/                  # Auth route group (no sidebar)
│   │       │   │   ├── login/
│   │       │   │   │   └── page.tsx
│   │       │   │   └── register/
│   │       │   │       └── page.tsx
│   │       │   │
│   │       │   └── (dashboard)/             # Protected route group
│   │       │       ├── layout.tsx           # Sidebar + top nav
│   │       │       ├── page.tsx             # Dashboard home (metrics)
│   │       │       │
│   │       │       ├── leads/
│   │       │       │   ├── page.tsx         # Lead list + search
│   │       │       │   └── [id]/
│   │       │       │       └── page.tsx     # Lead detail + activity timeline
│   │       │       │
│   │       │       ├── deals/
│   │       │       │   └── page.tsx         # Kanban pipeline view
│   │       │       │
│   │       │       ├── knowledge/
│   │       │       │   ├── page.tsx         # Document library
│   │       │       │   └── upload/
│   │       │       │       └── page.tsx     # Upload + ingestion status
│   │       │       │
│   │       │       └── assistant/
│   │       │           └── page.tsx         # AI chat interface
│   │       │
│   │       ├── components/
│   │       │   ├── ui/                      # Shadcn/ui primitives
│   │       │   │   ├── button.tsx
│   │       │   │   ├── input.tsx
│   │       │   │   ├── card.tsx
│   │       │   │   ├── badge.tsx
│   │       │   │   ├── dialog.tsx
│   │       │   │   ├── dropdown-menu.tsx
│   │       │   │   ├── table.tsx
│   │       │   │   ├── toast.tsx
│   │       │   │   └── skeleton.tsx
│   │       │   │
│   │       │   ├── layout/
│   │       │   │   ├── Sidebar.tsx
│   │       │   │   ├── TopNav.tsx
│   │       │   │   └── PageHeader.tsx
│   │       │   │
│   │       │   ├── leads/
│   │       │   │   ├── LeadTable.tsx
│   │       │   │   ├── LeadCard.tsx
│   │       │   │   ├── LeadForm.tsx
│   │       │   │   └── ActivityTimeline.tsx
│   │       │   │
│   │       │   ├── deals/
│   │       │   │   ├── KanbanBoard.tsx
│   │       │   │   ├── KanbanColumn.tsx
│   │       │   │   └── DealCard.tsx
│   │       │   │
│   │       │   ├── knowledge/
│   │       │   │   ├── DocumentList.tsx
│   │       │   │   ├── DocumentUploader.tsx
│   │       │   │   └── IngestionStatus.tsx
│   │       │   │
│   │       │   └── assistant/
│   │       │       ├── ChatWindow.tsx
│   │       │       ├── ChatMessage.tsx
│   │       │       ├── ChatInput.tsx
│   │       │       └── SourceCitations.tsx
│   │       │
│   │       ├── hooks/
│   │       │   ├── useAuth.ts
│   │       │   ├── useLeads.ts
│   │       │   ├── useDeals.ts
│   │       │   ├── useDocuments.ts
│   │       │   └── useChat.ts
│   │       │
│   │       ├── lib/
│   │       │   ├── api.ts                   # Axios instance + interceptors
│   │       │   ├── auth.ts                  # Token helpers
│   │       │   └── utils.ts                 # cn(), formatDate() etc.
│   │       │
│   │       ├── store/
│   │       │   ├── authStore.ts             # Zustand: user + token
│   │       │   └── chatStore.ts             # Zustand: message history
│   │       │
│   │       └── types/
│   │           ├── api.types.ts             # Shared response shapes
│   │           ├── lead.types.ts
│   │           ├── deal.types.ts
│   │           └── document.types.ts
│   │
│   └── server/                   # Node.js Express + TypeScript Backend
│       ├── package.json
│       ├── tsconfig.json
│       ├── nodemon.json
│       │
│       ├── prisma/
│       │   ├── schema.prisma                # Single source of truth for DB
│       │   └── migrations/                  # Auto-generated migration files
│       │       └── (generated by prisma migrate dev)
│       │
│       └── src/
│           ├── index.ts                     # Express app entry point
│           ├── app.ts                       # App factory (middleware, routes)
│           │
│           ├── config/
│           │   ├── env.ts                   # Validated env vars (zod)
│           │   ├── prisma.ts                # Prisma client singleton
│           │   ├── redis.ts                 # Redis client singleton (ioredis)
│           │   └── openai.ts                # OpenAI client singleton
│           │
│           ├── middleware/
│           │   ├── auth.middleware.ts       # JWT verify + req.user attach
│           │   ├── rbac.middleware.ts       # Role guard factory
│           │   ├── error.middleware.ts      # Global error handler
│           │   ├── validate.middleware.ts   # Zod request validation
│           │   └── upload.middleware.ts     # Multer config (PDF only, 20MB)
│           │
│           ├── modules/
│           │   │
│           │   ├── auth/
│           │   │   ├── auth.router.ts
│           │   │   ├── auth.controller.ts
│           │   │   ├── auth.service.ts      # register, login, refresh, logout
│           │   │   └── auth.schema.ts       # Zod validation schemas
│           │   │
│           │   ├── users/
│           │   │   ├── users.router.ts
│           │   │   ├── users.controller.ts
│           │   │   └── users.service.ts     # getMe, updateProfile, invite
│           │   │
│           │   ├── leads/
│           │   │   ├── leads.router.ts
│           │   │   ├── leads.controller.ts
│           │   │   ├── leads.service.ts     # CRUD + scoring
│           │   │   └── leads.schema.ts
│           │   │
│           │   ├── deals/
│           │   │   ├── deals.router.ts
│           │   │   ├── deals.controller.ts
│           │   │   └── deals.service.ts     # CRUD + stage transitions
│           │   │
│           │   ├── documents/
│           │   │   ├── documents.router.ts
│           │   │   ├── documents.controller.ts
│           │   │   └── documents.service.ts # Upload trigger, status poll, delete
│           │   │
│           │   ├── activities/
│           │   │   ├── activities.router.ts
│           │   │   ├── activities.controller.ts
│           │   │   └── activities.service.ts # Log + fetch timeline
│           │   │
│           │   └── workflows/
│           │       ├── workflows.router.ts
│           │       ├── workflows.controller.ts
│           │       └── workflows.service.ts  # CRUD triggers + eval engine
│           │
│           ├── services/
│           │   │
│           │   ├── ai/
│           │   │   ├── openai.service.ts    # Wrapper: embed(), chat(), stream()
│           │   │   ├── rag.service.ts       # Orchestrates retrieval + prompt build
│           │   │   └── prompts/
│           │   │       ├── emailDraft.prompt.ts
│           │   │       └── objectionHandler.prompt.ts
│           │   │
│           │   ├── vector/
│           │   │   ├── pinecone.service.ts  # upsert(), query(), deleteByDoc()
│           │   │   └── chunker.service.ts   # Text → overlapping token chunks
│           │   │
│           │   └── ingestor/
│           │       ├── ingestor.service.ts  # Main ingestion orchestrator
│           │       └── parsers/
│           │           ├── pdf.parser.ts    # pdf-parse wrapper
│           │           └── docx.parser.ts   # mammoth.js wrapper (future)
│           │
│           ├── queues/
│           │   ├── queue.client.ts          # BullMQ Queue instances
│           │   ├── worker.ts                # Worker entry point (separate process)
│           │   └── processors/
│           │       ├── ingest.processor.ts  # PDF ingestion job handler
│           │       └── workflow.processor.ts # Workflow trigger job handler
│           │
│           ├── routes/
│           │   └── index.ts                 # Mounts all module routers
│           │
│           └── types/
│               ├── express.d.ts             # Augments Request with req.user
│               └── common.types.ts          # Shared DTOs and enums
│
├── documents/                    # Staging area for uploaded PDFs (pre-processing)
│   └── .gitkeep
│
└── packages/                     # Shared utilities (monorepo-ready)
    └── shared/
        ├── package.json
        └── src/
            ├── constants.ts      # Shared enums: DealStage, LeadStatus, etc.
            └── validators.ts     # Shared Zod schemas usable by both apps
```

---

## 7. Environment Variables

### Root `.env` (Docker services)

```env
# PostgreSQL
POSTGRES_USER=sellora
POSTGRES_PASSWORD=sellora_secret
POSTGRES_DB=sellora_db

# Redis
REDIS_PORT=6379
```

### `apps/server/.env`

```env
# Server
NODE_ENV=development
PORT=4000

# Database
DATABASE_URL="postgresql://sellora:sellora_secret@localhost:5432/sellora_db"

# Redis
REDIS_URL="redis://localhost:6379"

# Auth
JWT_ACCESS_SECRET=your_access_secret_here
JWT_REFRESH_SECRET=your_refresh_secret_here
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

# OpenAI
OPENAI_API_KEY=sk-...

# Pinecone
PINECONE_API_KEY=...
PINECONE_INDEX_NAME=sellora-knowledge
PINECONE_ENVIRONMENT=us-east-1-aws

# File Upload
UPLOAD_DIR=../../documents
MAX_FILE_SIZE_MB=20
```

### `apps/web/.env.local`

```env
NEXT_PUBLIC_API_URL=http://localhost:4000/api/v1
```

---

## 8. API Surface

### Auth
| Method | Path | Access | Description |
|---|---|---|---|
| `POST` | `/api/v1/auth/register` | Public | Create org + admin user |
| `POST` | `/api/v1/auth/login` | Public | Returns access + refresh token |
| `POST` | `/api/v1/auth/refresh` | Public | Rotate refresh token |
| `POST` | `/api/v1/auth/logout` | Auth | Invalidate refresh token |

### Leads
| Method | Path | Access | Description |
|---|---|---|---|
| `GET` | `/api/v1/leads` | Auth | List leads (paginated, filtered) |
| `POST` | `/api/v1/leads` | Auth | Create lead |
| `GET` | `/api/v1/leads/:id` | Auth | Get lead + deal + activities |
| `PATCH` | `/api/v1/leads/:id` | Auth | Update lead |
| `DELETE` | `/api/v1/leads/:id` | Manager+ | Delete lead |

### Documents (Knowledge Base)
| Method | Path | Access | Description |
|---|---|---|---|
| `POST` | `/api/v1/documents/upload` | Manager+ | Upload PDF → enqueue ingestion job |
| `GET` | `/api/v1/documents` | Auth | List org documents + ingestion status |
| `DELETE` | `/api/v1/documents/:id` | Admin | Delete doc + Pinecone vectors |

### AI Assistant
| Method | Path | Access | Description |
|---|---|---|---|
| `POST` | `/api/v1/ai/chat` | Auth | RAG query → streamed GPT-4o response |
| `POST` | `/api/v1/ai/draft-email` | Auth | Generate email for a lead using doc context |

### Deals
| Method | Path | Access | Description |
|---|---|---|---|
| `GET` | `/api/v1/deals` | Auth | List all deals by stage |
| `POST` | `/api/v1/deals` | Auth | Create deal linked to lead |
| `PATCH` | `/api/v1/deals/:id` | Auth | Update stage / value |

---

## 9. 2-Week "Vertical Slice" Roadmap

### Week 1 — Infrastructure & Brain

| Day | Task | Files Involved |
|---|---|---|
| 1 | Docker Compose: Postgres + Redis up and healthy | `docker-compose.yml` |
| 1 | Prisma schema written, initial migration run | `schema.prisma` |
| 2 | Express app skeleton: config, error handler, env validation | `app.ts`, `config/`, `middleware/error` |
| 2 | Auth module: register, login, JWT middleware | `modules/auth/` |
| 3 | Multer upload endpoint, Documents module (DB only) | `modules/documents/`, `middleware/upload` |
| 3 | BullMQ queue client + worker process wired | `queues/` |
| 4 | Ingestor service: pdf-parse → chunker → OpenAI embed | `services/ingestor/`, `services/vector/` |
| 4 | Pinecone upsert in `ingest.processor.ts` | `queues/processors/ingest.processor.ts` |
| 5 | Leads CRUD (full), Deals CRUD (basic) | `modules/leads/`, `modules/deals/` |
| 5 | Integration test: upload PDF → Pinecone populated | Manual test via curl |

### Week 2 — Interface & Action

| Day | Task | Files Involved |
|---|---|---|
| 6 | RAG service: query → Pinecone → GPT-4o → stream | `services/ai/rag.service.ts` |
| 6 | AI chat endpoint wired (`/api/v1/ai/chat`) | `modules/` or top-level route |
| 7 | Next.js scaffold: layout, auth pages, Zustand store | `apps/web/src/` |
| 7 | Axios API client + useAuth hook + login flow | `lib/api.ts`, `hooks/useAuth.ts` |
| 8 | Lead list + lead detail pages | `app/(dashboard)/leads/` |
| 8 | Document upload UI + ingestion status polling | `components/knowledge/` |
| 9 | AI Chat UI: `ChatWindow`, streaming response render | `components/assistant/` |
| 9 | Email draft button on lead detail page | `LeadCard.tsx` + AI endpoint |
| 10 | Polish: error states, loading skeletons, toasts | `components/ui/` |
| 10 | Full E2E test: upload doc → chat about it → draft email | Manual QA |

---

## 10. Key Design Decisions

### Why Pinecone over pgvector?
`pgvector` would be simpler (one fewer service), but Pinecone's hosted ANN index gives sub-100ms similarity search at scale without tuning. For a demo/MVP phase, Pinecone's free tier is sufficient. Namespace-per-org gives instant multi-tenant isolation without metadata filtering overhead.

### Why BullMQ for ingestion?
PDF embedding is a ~5-30 second operation depending on file size. Doing it synchronously in the upload request would timeout. BullMQ lets the upload return immediately with a job ID, and the frontend polls `GET /documents` for `status` field to show progress.

### Why separate worker process?
The ingestor worker (`queues/worker.ts`) runs as a separate Node.js process (`node dist/queues/worker.js`). This isolates CPU-heavy embedding from the API server, preventing event loop blocking.

### JWT access/refresh pattern
Access tokens are short-lived (15 min) and stored in memory (Zustand). Refresh tokens are long-lived (7 days), stored in `httpOnly` cookies, and rotated on every use. On server restart, the `RefreshToken` table persists sessions.

### Org-scoped Pinecone namespaces
Every upsert and query uses `namespace: orgId`. This means one Pinecone index serves all orgs without data leakage. Deleting an org's documents simply calls `deleteAll({ namespace: orgId })`.

---

*Last updated: project kickoff. Update this file as architecture decisions are made.*