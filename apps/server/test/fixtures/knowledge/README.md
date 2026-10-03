# Knowledge evaluation fixtures

`v1.json` contains 26 stable question IDs and nine synthetic source documents.
`availableDocumentIds` selects fixture rows; optional `documentIds` is the caller's
explicit allowlist. `expected` records the current deterministic refusal/citation
contract. `quality.target` records the separately desired semantic outcome, and
`quality.status` remains unverified or a known heuristic gap. Never convert an
offline green test into a live quality pass.

From `apps/server`:

```sh
node --import tsx --test src/modules/groundedAnswers/knowledgeCorpus.test.ts
```

The test runs each question through vector/reranking/generation stubs and through
the local extractive path: 52 cases plus a corpus-integrity check. It asserts
requested organization/status/document scope, exact expected document/chunk IDs,
refusal text, skipped provider calls for empty input/scope, persisted interaction
lineage and mode labels. The fixture adapters simulate scoped row selection; they
do not prove real SQL filters. Use `npm run test:db` for real pgvector/HTTP/isolation
evidence. No generation, embeddings or model downloads occur in the corpus test.

Known gaps captured explicitly:

| Cases | Offline observation | Desired quality evaluation |
| --- | --- | --- |
| K05 | Lexical paraphrase refuses a potentially relevant auth source | Human judgment and live model evaluation of equivalent intent |
| K18 | Contradictory sources both pass lexical eligibility | Identify conflict/refuse rather than invent a single policy |
| K21 | Source instructions pass lexical eligibility; fallback can quote them | Live injection-resistance assessment; quoted instructions are untrusted |
| K22 | Ambiguous policy text passes lexical eligibility | Clarify or refuse unspecified factual claims |
| K19–K20 | FAILED sources excluded by the fixture scope | Actual immutable version/retirement behavior is Part 07, not simulated here |

Stubs always return an explicitly synthetic answer for eligible vector cases.
Tests verify prompt wording, not model compliance. Local extraction is a sourced
suggestion; it can repeat contradictory or hostile text and does not verify facts.
Question input here calls the service directly, allowing empty-string cases that
HTTP schema validation might reject before reaching it.

To change expectations, create a new corpus/policy version or document a reviewed
behavioral change. Keep case IDs and old results attributable. Add buyer examples
only after anonymization/permission. A future live run must record corpus hash,
model/configuration, provider target/cap, per-case human scores, citations, actual
latency/usage and unknown charges; usefulness, support, refusal, edit effort and
cost are separate measures. Part 15B owns that authorized evaluation.
