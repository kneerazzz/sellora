# Sellora

Sellora is a high-performance, AI-native technical sales workflow backend. It acts as an autonomous AI brain that sits behind workflow automation tools like n8n, automatically answering technical buyer questions, filling out massive RFPs, and structuring CRM data.

Sellora handles the hard AI work: document ingestion, structure-aware chunking, local vector embeddings, grounded RAG answering (with strict citations), and structured JSON extraction from emails and call transcripts.

---

## Use Cases

1. **Automated RFP & Security Questionnaire Filling**
   - Provide Sellora with a massive block of RFP text. It uses Groq/OpenAI to extract every individual question, embeds them using a local Ollama model (`nomic-embed-text`), queries your company's uploaded documents via `pgvector`, and returns perfectly cited answers for every question.
2. **Customer Support & Sales Email Auto-Drafting**
   - Connect an n8n webhook to Gmail. When a buyer emails a technical question, Sellora intercepts it, extracts the core question, finds the answer in your docs, and returns a grounded answer. n8n can then draft the reply automatically.
3. **Automated CRM Data Entry**
   - Forward a Zoom transcript to Sellora. It extracts buyer objections, budget, next steps, and automatically prepares a CRM Sync payload ready to be pushed to Salesforce or HubSpot.

---

## Architecture & Tech Stack

Sellora is built for performance, privacy, and modularity:

- **Core Backend:** Node.js, Express, TypeScript
- **Database:** PostgreSQL with `pgvector` for native vector similarity search
- **ORM:** Prisma
- **AI / Embeddings:** 
  - **Local Model (Privacy-First):** Ollama daemon running `nomic-embed-text` (768-dimensions) for fast, free local embeddings with an 8192 token context window.
  - **LLM Provider:** Groq (`llama-3.1-8b-instant`) or OpenAI for structured extraction and text generation.
- **Background Jobs:** Redis + BullMQ (Planned)
- **Containerization:** Docker Compose for seamless Postgres/Redis/Ollama orchestration.

### The n8n Philosophy
Sellora does not try to be a CRM or an email client. It delegates all "plumbing" to n8n. n8n listens for emails, calls the Sellora Webhook API, and then writes the result back to Salesforce/Zendesk.

---

## Key Webhook Endpoints

Sellora is controlled entirely via API Keys (passed as `Authorization: Bearer <key>`).

- **`POST /api/v1/ai/extractions/rfp`**
  - Accepts a raw text block of an RFP/Questionnaire. Extracts all questions and automatically generates grounded answers with exact page citations.
- **`POST /api/v1/webhooks/email-received`**
  - Parses an incoming sales email, extracts the buyer's questions, budget, and objections, and returns a structured JSON payload for CRM updating.
- **`POST /api/v1/documents/upload-file`**
  - Upload a PDF/Markdown document. Sellora parses it, splits it via a custom structure-aware chunking algorithm, embeds it via Ollama, and stores it in `pgvector`.
- **`POST /api/v1/crm-writeback/preview`**
  - Prepares a unified `SyncLog` payload formatted perfectly for HubSpot or Salesforce based on a previous AI extraction.

---

## Local Development

### 1. Prerequisites
- Docker & Docker Compose
- Node.js v22+
- A Groq or OpenAI API Key

### 2. Environment Setup
Copy the sample environment file:
```bash
cp apps/server/.env.sample apps/server/.env
```
Fill in your `GROQ_API_KEY` (or `OPENAI_API_KEY`) and ensure `EMBEDDING_PROVIDER=local` if using Ollama.

### 3. Start Infrastructure
Start PostgreSQL (with pgvector), Redis, and the Ollama daemon:
```bash
docker compose up -d
```
*(Note: Ollama will automatically pull the `nomic-embed-text` model on startup if configured).*

### 4. Run the Server
Install dependencies and run the Express app:
```bash
cd apps/server
npm install
npx prisma generate
npx prisma db push
npm run dev
```

### 5. Testing
Run the test suite and typechecker:
```bash
npm run typecheck
npm test
```
