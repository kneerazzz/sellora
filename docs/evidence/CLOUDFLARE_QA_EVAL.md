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

Question 1, `d1-paid-size`, initially returned **an incorrect refusal** in the staff Drafts page. The local trace shows embedding succeeded, the Xenova reranker failed with a transport error, and no generation attempt occurred. The old fallback searched only the newest 250 chunks and found no sufficient evidence. The grounded-answer path now keeps the top lexically eligible hybrid-search matches in retrieved order on reranker transport failure and applies the existing whole-question evidence check. A local-only recheck found the 10 GB D1 limit in two of the first three eligible passages.

The user retested the same question in a new draft. **Result: correct, supported answer (10 GB)**. Its saved source 3 is the pinned `d1/platform/limits.mdx` passage containing the exact row `Maximum database size | 10 GB (Workers Paid) / 500 MB (Free)`. The trace shows local embedding succeeded, reranker transport failed again, and one Groq `openai/gpt-oss-120b` generation succeeded. Five passages were linked; several are unrelated to the D1 size limit, so citation selection still needs improvement. The agent made no Groq calls. Approval was recommended after checking the exact saved source row; actual approval state was not checked.

Question 2, `d1-free-size`, returned **an incorrect refusal**. The same pinned D1 Limits row states 500 MB for Free. The real draft trace shows local embedding, local reranking and one Groq `openai/gpt-oss-120b` generation all succeeded; the final response was the model's grounded-context refusal. A local-only replay retrieved 30 chunks, of which two passed the word-overlap gate, but neither contained 500 MB. The answer-bearing D1 Limits chunk did not appear in the top 30 and would fail the current word-overlap gate for this paraphrase. This is a retrieval and evidence-gate recall failure; the refusal avoided an unsupported claim. The user was advised not to approve it. No Groq call was made by the agent.

Question 3, `d1-parameters`, returned **a correct, supported answer (100 bound parameters per D1 query)**. Saved source 3 is the pinned `d1/platform/limits.mdx` passage with the exact row `Maximum bound parameters per query | 100`. Local embedding, Xenova reranking and one Groq `openai/gpt-oss-120b` generation succeeded. Three passages were linked; the other two are tangential. Approval was recommended after checking the saved source row; actual approval state was not checked. The agent made no Groq call.

Question 4, `d1-index-refresh`, was submitted once by the agent through the signed-in localhost Drafts page after the user connected the Brave MCP browser. **Result: incorrect refusal**. The pinned `d1/best-practices/use-indexes.mdx` says indexes are automatically updated when referenced rows are inserted, updated or deleted; users do not need to update an index after writing to its table. The draft trace shows local embedding, Xenova reranking and one Groq `openai/gpt-oss-120b` generation succeeded. A local-only replay found the expected page among the top 30 but only a different section of it passed into the two eligible passages; neither contained the answer sentence. This is a relevant-passage recall failure, and the refusal avoided an unsupported claim. The draft has no linked sources and cannot be approved as-is. No further question was submitted in this turn.
