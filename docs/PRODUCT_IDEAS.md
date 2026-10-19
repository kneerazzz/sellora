# Product direction and later experiments

**User direction recorded 2026-10-19.** This note preserves ideas for later sessions. It does not expand the agreed first offer or mark an integration as tested.

## Intended Sellora workflow

Sellora is one organization-scoped knowledge and review backend that can support several n8n intake workflows. A company representative can ask a question directly in the application. Other possible inputs are a company's website form, buyer email, a technical questionnaire, and a recorded live meeting such as Zoom. For each channel, the proposed flow is: receive the permitted content, identify the questions, retrieve the company's approved source material, draft cited answers, and let staff review and correct them before any external delivery.

The user wants n8n workflows to serve more than questionnaires. Review the saved workflows and their real connector behavior before offering any channel to a client. A better staff frontend is also a requested improvement; collect the specific usability problems during hands-on testing before designing changes.

## Demo and first-client direction

The user wants to record a short video of the working prototype before every possible feature is built. Show real, repeatable flows and label planned integrations as planned. Use the video to start buyer conversations, then keep improving the product while seeking a first client within roughly two months of 2026-10-19. This is a user target, not a sale forecast or a client commitment.

The backend may later support other company automations beyond question answering. Find repeated, costly tasks through buyer discovery and choose the next workflow from that evidence. Do not assume an untested automation belongs in the first offer.

## Current boundary

- Manual staff questions, organization-scoped documents, cited draft review, and local questionnaire processing exist. See [README](../README.md), [evidence policy](EVIDENCE_POLICY.md), and [questionnaire contract](QUESTIONNAIRE_CONTRACT.md).
- Gmail intake is the selected first connector. Its route, worker, and inactive n8n example have local checks; live client-owned Gmail/OAuth acceptance and the daily stop remain open. See [email contract](EMAIL_CONTRACT.md).
- A website form integration and Zoom recording/transcript intake are ideas. Source permission, consent, transcript quality, question extraction, review, retention, connector limits, and delivery behavior need separate contracts and tests. The public widget is outside the current first offer.
- No channel should silently send an AI draft as the company's approved answer. The current workflow expects staff review.

## Retrieval improvement experiment

The user proposed later comparing four or five isolated copies of the same roughly 500-document corpus with different embedding models, then improving the RAG pipeline based on measured answer quality. The current Cloudflare corpus is a test baseline, not representative client acceptance data. Add realistic buyer documents and labeled questions before selecting a production model.

Keep the document set, extraction, chunks, questions, and ranking evaluation fixed while comparing embeddings. Measure correct-source recall at 5, rank, refusals on unsupported questions, latency, and compute. Then test answer accuracy and citation support separately with an agreed generation provider and usage cap. More documents alone do not train an embedding model or prove that answers are grounded.

Current Sellora code uses local Nomic embeddings with separate query/document prefixes, 768-dimensional pgvector, LlamaIndex Markdown and sentence chunking, hybrid vector/full-text retrieval, and a local reranker. Different organizations alone cannot select different embedding models: the model and vector contract are currently shared. A later comparison needs isolated indexes or databases, model-specific query embeddings, and complete re-embedding. Never mix vectors from different models even when dimensions match.

Candidate experiments, not selected changes:

- [Qwen3-Embedding-0.6B](https://huggingface.co/Qwen/Qwen3-Embedding-0.6B): multilingual, instruction-aware; default output is 1024 dimensions.
- [BGE-M3](https://huggingface.co/BAAI/bge-m3): multilingual dense retrieval, with separate sparse and multi-vector capabilities if its full stack is used.
- [Nomic Embed v2 MoE](https://huggingface.co/nomic-ai/nomic-embed-text-v2-moe): multilingual 768-dimensional option; still a different vector space from Nomic v1.
- [RAGFlow](https://github.com/infiniflow/ragflow): compare document parsing when client PDFs, tables, and slides are difficult.
- [Haystack](https://docs.haystack.deepset.ai/docs/evaluation): compare swappable retrieval and evaluation components. Sellora already uses LlamaIndex for chunking, so a full LlamaIndex adoption needs a demonstrated gap.

### Local baseline, 2026-10-19

The user's new `sellora` test organization received 500 pages from the official Cloudflare Docs repository at revision `d723a5f45258449d98bbac8c9dd3e6dba4cf6ccd`. The selection used 500 lexically first `.mdx` paths of 1,200–30,000 bytes under D1, Durable Objects, R2, and Workers after sorting full paths. Uploads retained source URL and checksum in document descriptions. A read-only database check found 500 `COMPLETED` documents and 4,788 chunks, all with 768-dimensional Nomic vectors. Some source pages use MDX components whose referenced content was not expanded, so this is not a complete rendered-docs corpus.

A seven-question **local retrieval-only** probe found the expected page at rank 1 for five direct questions. One paraphrase about newly uploaded R2 files did not retrieve the expected consistency page in the top 30, and the lexical evidence check found no eligible chunk. One unsupported Sellora refund-policy question also had no lexically eligible chunk. This small exploratory result identifies a paraphrase gap; it does not measure generated-answer accuracy, hallucination rate, or client readiness. No generation provider was called.

Two user-supplied domain questions exposed another gap. For “How does Cloudflare host domains?” the top result was a Cloudflare Access page. For “How can I buy a domain from Cloudflare?” the top result was an R2 public-bucket page. The current lexical gate marked 19 of 30 retrieved chunks eligible for **each** question, although none of the 500 selected source pages explains domain purchase or Cloudflare Registrar. This is a false-positive evidence signal, not a verified generated hallucination: no answer model was called. A later quality change should check whether the retrieved passages answer the actual intent, especially before generation, and add supported domain docs only when they belong in the test corpus.

The broader [25-question local evaluation](evidence/CLOUDFLARE_QA_EVAL.md) records an answer key and per-question retrieval results for follow-up testing.

No model or RAG code change is authorized by this suggestion record. Compare future candidates with a larger labeled set before choosing one.
