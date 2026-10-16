# Approved-answer contract

This is the local Part 09 engineering contract. It does not establish a buyer's
review policy or promise that a stored answer is correct for a new question.

## Record and approval

An approved answer belongs to one organization and points to immutable answer
revisions. Each revision stores its title, question, answer, tags, author and
exact `documentId`/`versionId`/`chunkId` source references. Source passage text
is resolved at read time and is not copied into the library record.

The first revision can be saved only from an effectively approved current draft
revision with current sources. The record preserves that draft revision and its
reviewer's decision and date. Saving the same source draft revision again is
idempotent only when the normalized metadata matches.

Edits append a revision, preserve history and return the record to review
required. ADMIN and MANAGER may approve an exact current revision, subject to
the local no-self-review rule and a locked current-source check. An answer is
effectively approved only when it is active, its exact current revision has a
current approval, and every source reference is current.

## Suggestion and reuse

Suggestions are organization scoped and require explicit lexical overlap with
the stored title, question or tags. They return the matching reason rather than
a numeric confidence or a correctness promise. Archived, superseded,
unapproved, stale and unavailable entries are excluded.

Reuse rechecks the selected revision, approval, relevance and every source while
holding database locks. It creates a new immutable draft revision with exact
answer/revision/source lineage, review required and delivery not requested. It
never copies approval. A normalized idempotency key can return the same draft;
using that key with changed input returns a conflict.

## Stale review queue

Publishing a replacement document version or tombstone-deleting a document
atomically marks every affected current answer revision as review required and
appends an invalidation event. Editing an answer appends an `ANSWER_EDITED`
event. Events retain the affected answer revision and the prior and replacement
source version IDs where applicable.

The review queue is organization scoped and paginated. It combines retained
invalidation events with current source resolution so that a race or legacy row
cannot appear current merely because no event was written. Reasons distinguish
answer edits, updated sources, deleted sources and unavailable sources. Updating
the answer to current references and approving that exact revision restores
effective approval while preserving prior revisions, approvals and invalidation
history.

Archive retains the record and its audit history while removing it from active
search, suggestions and reuse. None of these actions sends or delivers content.
