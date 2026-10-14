# Durable draft and revision contract

Packets 08A and 08B establish the local draft domain and staff API. A draft is
owned by one organization and records the question, creator, initial document
scope and one current immutable revision. Editing appends a revision and moves
the current pointer with optimistic concurrency. Archiving keeps the history.
There is no hard-delete, approval or delivery endpoint in these packets.

## Identity and state

`Draft.id` is the stable task ID. `DraftRevision.id` identifies exact text and
never changes after insertion. A revision has a monotonically increasing number,
author and creation time. `Draft.currentRevisionId` and `concurrencyToken` change
together. Approval decisions name an exact draft/revision, reviewer, decision
and time; the schema is ready for 08C, but 08A/08B create no decisions.

Processing, review and delivery are independent:

| Field | Values used by 08A/08B | Meaning |
| --- | --- | --- |
| Processing | `PROCESSING`, `COMPLETED`, `REFUSED`, `FAILED` | Local generation/edit outcome. A refusal is retained as a revision; a failure is retained without invented text. |
| Review | `REQUIRED` | Every new or edited revision needs review. `APPROVED` and `REJECTED` are reserved for exact decisions in 08C. |
| Delivery | `NOT_REQUESTED` | Draft creation, editing and archive never mean copied, exported or sent. Later states are reserved for controlled external work. |

The local default for 08C is approval by ADMIN or MANAGER with self-review
denied. The pilot's approver roles and self-review choice remain TBD. No approval
route is exposed until that policy is enforced and source validity is checked.

## Source references

A revision stores only `documentId`, `versionId` and `chunkId` links in citation
order. Composite database constraints require the source, version and chunk to
belong together and to the draft organization. Passage text, display names and
locations are not copied into the durable revision. Detail reads resolve each
link under the retention contract as `CURRENT`, `STALE` or `UNAVAILABLE`; deleted
sources expose no title or location. Editing carries the exact links forward.
Approval and export must resolve them again in 08C/08D.

## Staff API

ADMIN, MANAGER and REP may use the current draft API through a JWT staff session.
Machine API keys are denied because author identity is required.

- `POST /api/v1/drafts` creates a manual or generated draft. `idempotencyKey`,
  `question` and optional `title`, `documentIds`, `maxCitations`, `draftText` are
  accepted. Supplying `draftText` creates the first manual revision; omitting it
  invokes the existing grounded-answer service with its shared limits, reservation,
  provider and usage contracts.
- `GET /api/v1/drafts` provides organization-scoped pagination, search,
  processing-status and active/archived filters.
- `GET /api/v1/drafts/:id` returns attribution, immutable revision history,
  approval history and freshly resolved source availability.
- `POST /api/v1/drafts/:id/revisions` requires `expectedRevisionId` and new
  `content`. Two writers using the same expected revision produce one winner and
  one `409`; the loser must reload before deciding whether to retry.
- `DELETE /api/v1/drafts/:id` archives with `expectedConcurrencyToken`. It does
  not delete history. Stale tokens and repeated archive requests return `409`.

Creation identity is unique by organization and idempotency key. Reusing a key
with the same normalized input returns the same draft and does not repeat
generation. Reusing it with different input returns `409`. The creator may see a
short-lived `PROCESSING` record when a concurrent retry arrives before generation
finishes. Generation happens outside database transactions. A refusal ends in
`REFUSED` with its explicit refusal revision. A failure ends in `FAILED` with a
bounded error code such as `GENERATION_FAILED`; provider response bodies and
internal errors are not returned.

Examples:

```json
{
  "idempotencyKey": "staff-task-2026-10-14-001",
  "question": "What is our refund policy?",
  "documentIds": ["source-id"],
  "maxCitations": 5
}
```

```json
{
  "expectedRevisionId": "current-revision-id",
  "content": "The reviewed correction remains unapproved until 08C."
}
```

Foreign or missing IDs return `404`; invalid input returns `422`; idempotency,
edit and archive conflicts return `409`. This local contract has deterministic
database/HTTP acceptance only. It does not establish buyer approver policy,
browser acceptance, live provider quality, copy/export or external delivery.
