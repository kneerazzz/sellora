# Provisional answer evidence policy

RRF and reranker scores order candidates; neither is a calibrated probability.
The same organization, completed-document and explicit document scope applies to
vector/keyword retrieval and the local fallback. An explicit empty scope always
refuses before embedding or generation. Empty/stopword-only questions refuse.

Candidates must pass whole-token lexical eligibility: at least two distinct
question terms (or the only term) and at least half the question terms. Before
generation or local extraction, each explicit question part separated by `?`,
`;`, a newline, `and`, `also`, `plus` or `&` must pass against the selected context.
This prevents a supported SAML question from masking an unsupported refunds part.
It is a conservative heuristic, not general linguistic parsing or claim checking.

Known limits: valid paraphrases can be refused; phrasing/conjunctions can split a
single intent; facts distributed across chunks may fail initial eligibility;
vocabulary overlap does not prove factual support, resolve contradictions or
detect prompt injection. Instructions ask the model to refuse incomplete or
conflicting evidence, but prompt text is not a verified security boundary.

All returned modes retain `confidence: LOW` and `reviewRequired: true`; LOW is a
legacy compatibility field, not a measured probability. Local fallback is an
extractive suggestion. Candidate citations show retrieved sources, not proof that
each generated claim was checked. Staff must inspect sources and correct replies.
The broad catch/fallback behavior and incomplete usage accounting remain Parts 05
and 15 concerns; there is no billing-quality usage guarantee.

Use the versioned synthetic evaluation corpus in 03D to record acceptance targets
separately from observed lexical behavior. Live model quality needs an agreed
target/budget and buyer examples; offline stubs cannot establish it.

## Versioned offline baseline

Policy ID: `whole-token-parts-v1`; corpus: `sellora-knowledge-v1` in
`apps/server/test/fixtures/knowledge/v1.json`. Its 26 questions cover supported,
paraphrased, unsupported, empty, ambiguous, multi-part, contradictory, stale,
injection-like and cross-organization inputs. Expected document IDs map to stable
fixture chunk IDs. Run instructions and known gaps are in the fixture README.

The two deterministic paths assert refusal/citations, scope requests, skipped
calls and persisted model labels. Empty input and explicit empty document scope
skip embedding/generation; other refusals may perform retrieval before refusing.
The refusal label is `grounded-refusal`; local suggestions are labelled
`local-extractive-rag`; synthetic vector results are `offline-stub-v1`. Legacy
token fields for extractive/refused results are not trustworthy usage measurements.

Quality targets remain separate from regression expectations: contradiction and
injection cases deliberately demonstrate lexical eligibility, not safe model
behavior. Stale fixtures simulate FAILED rows; immutable version lifecycle is not
implemented by a test adapter. Provider/model quality and buyer acceptance remain
unverified. Staff review is required for every returned mode.
