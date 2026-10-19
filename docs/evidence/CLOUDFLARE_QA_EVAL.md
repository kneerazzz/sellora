# Cloudflare question evaluation, local baseline

**Run:** 2026-10-19. **Corpus:** 500 completed Cloudflare Docs pages from revision `d723a5f45258449d98bbac8c9dd3e6dba4cf6ccd` in the local `sellora` test organization; 4,788 stored 768-dimensional Nomic vectors. [Question and answer key](cloudflare-questions-v1.json).

From `apps/server`, run `PROVIDER_OPERATION_TIMEOUT_MS=120000 node --import dotenv/config --import tsx scripts/evaluateCloudflareRetrieval.ts`. The script refuses databases other than `localhost/neer_db`, checks the single test organization and 500 completed tagged documents, and makes local Ollama query embeddings. It exercises pgvector/full-text retrieval and the lexical evidence check. It does **not** run the reranker, generate answers, or judge whether claims are true.

The expected source rank below is its first chunk's position among the top 30. `Eligible` says whether any retrieved chunk from that expected page passed the lexical evidence check. For questions without an expected source, the count is how many of the top 30 passed that check. Another page might also contain a correct answer; a missed expected page does not itself prove a wrong final answer.

| ID | Expected source rank | Eligible | Observation |
| --- | ---: | --- | --- |
| d1-paid-size | 2 | Yes | Expected page in top 5 |
| d1-free-size | — | No | Expected page missed top 30 |
| d1-parameters | 4 | Yes | Expected page in top 5 |
| d1-index-refresh | 4 | Yes | Expected page in top 5 |
| d1-time-travel | — | No | Expected page missed top 30 |
| do-sql | 1 | Yes | Expected page first |
| do-object-storage | 1 | Yes | Expected page first |
| do-classes | 1 | Yes | Expected page first |
| r2-consistency | 1 | Yes | Expected page first |
| r2-paraphrase | — | No | Expected page missed; no eligible chunk |
| r2-cache-404 | 1 | Yes | Expected page first |
| r2-object-size | 12 | Yes | Expected page below top 5 |
| r2-key-length | 7 | No | Expected page retrieved, but its chunks failed the lexical gate |
| r2-test-domain | 2 | Yes | Expected page in top 5 |
| workers-body | 1 | Yes | Expected page first |
| workers-basic-auth | 1 | Yes | Expected page first |
| workers-cache-methods | 23 | Yes | Expected page low; another page on caching POST ranked first |
| workers-rpc-cache | 1 | Yes | Expected page first |
| workers-rate-period | 1 | Yes | Expected page first |
| workers-cpu | 1 | Yes | Expected page first |
| missing-registrar | — | 19 chunks | False lexical evidence for domain purchase |
| missing-domain-hosting | — | 19 chunks | Ambiguous question; should clarify the intended Cloudflare service |
| missing-refund | — | 0 chunks | Lexical check would refuse |
| missing-employee-count | — | 0 chunks | Lexical check would refuse |
| missing-registrar-idn | — | 4 chunks | False lexical evidence for Registrar question |

**Counts:** 14/20 answerable questions retrieved the labeled page in the top 5; 17/20 in the top 30; 16/20 had an eligible chunk from that page. Three of five refusal/clarification questions had at least one lexically eligible chunk. These are retrieval diagnostics, **not generated-answer accuracy** or a hallucination rate.

Next, with a named generation provider and call limit, run each question through the real staff Drafts flow and inspect every generated claim and citation against the labeled page. Record correct, incomplete, unsupported, incorrect, or appropriate refusal/clarification per case. Do not score a cited page as proof that the answer's claim is supported.

## Manual generated-answer trial

The user chose one question at a time through the staff Drafts page to stay within Groq limits. A 2026-10-19 attempt asking about Cloudflare domain pricing created a `GENERATION_FAILED` draft. Read-only inspection found an `ALLOWANCE_EXHAUSTED` event at the same time: the 500-page ingestion had used approximately 2.08 million workload units within the rolling period, above the local 1 million-unit setting. This was an admission failure before Groq dispatch, not an incorrect generated answer. The local server environment was set to a 3 million-unit test allowance and the Groq free-tier-listed `openai/gpt-oss-120b` model; the running server needs a restart to load those settings. No Groq call was made by the evaluation script.

Question 1, `d1-paid-size`, returned **an incorrect refusal** in the staff Drafts page. The 2026-10-19 local usage trace shows embedding succeeded, the Xenova reranker failed with a transport error, and no generation attempt occurred. The old fallback searched only the newest 250 chunks and found no sufficient evidence. This is a reranker availability failure, not a Groq answer-quality result. The grounded-answer path now keeps the top lexically eligible hybrid-search matches in retrieved order when that local reranker has a transport failure, then applies the existing whole-question evidence check before generation. A local-only recheck found the 10 GB D1 limit in two of the first three eligible passages. **Retest of Question 1 in the web app is pending**; no Groq call was made by the agent.
