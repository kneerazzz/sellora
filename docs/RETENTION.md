# Source history, availability and erasure

This is the local Part 07C engineering contract. A client's retention duration,
backup window, legal holds, processor responsibilities and erasure authority are
not agreed. Deletion in the staff API is a reversible-looking **tombstone**, not
physical erasure. Do not offer full erasure until the client policy and an
authorized operator procedure are recorded.

## References and reads

Drafts, approvals and approved answers persist `documentId`, `versionId` and `chunkId`
beside their own immutable revision; they must not copy source passage text into
a permanent citation snapshot. A batch source-reference read returns `CURRENT`
only when all three IDs belong together, to the caller's organization, and the
document is nondeleted with that active version. A valid retired version is
`STALE`; a deleted, failed, missing or foreign source is `UNAVAILABLE`. Foreign
IDs return no title, text or location. Historical revisions remain unchanged;
their displayed availability is recomputed whenever read, approved, copied,
exported, suggested or reused.

Active source inspection may show a bounded page of chunk text and actual
location. Retired/deleted inspection returns status and no passage text. Version
history remains visible to the owning organization as metadata. No API exposes
an original storage path, raw original download, or historical passage export.
Earlier AI/workflow outputs may already contain copied source text and require
separate treatment at erasure; this policy does not silently bless retention.

## Inventory and policy boundary

The ADMIN-only dry run lists the owning document's version IDs, chunk counts,
vector counts and distinct managed-original file counts, plus known AI interaction
references. It does not delete or read original bytes. The document row and
its original path are counted through the version record, not twice. A path
outside managed storage is flagged for operator investigation, never opened by
the preview. Workflow JSON, logs, cache, downloaded exports, integration copies
and backups are reported as requiring separate inventory; they are not claimed
to be clean or zero. The output is a planning manifest, not proof of erasure.

| Surface | Tombstone behavior | Full-erasure policy needed |
| --- | --- | --- |
| Original files | Retained for failed retry and history | Delete each unique owned path after holds and backup plan |
| Document/version/chunk/vector rows | Retained, excluded from new retrieval | Remove safely with reference tombstones and audit record |
| Drafts, approvals and approved answers | Immutable revisions and decisions retained; stale references are excluded from approved use | Retain decision/invalidation metadata without passage snapshots; recheck sources at each approved use |
| AI/workflow outputs and usage logs | Existing records may include source text | Discover and redact or expire content while preserving required accounting/audit facts |
| Process/browser caches and exports | Not centrally tracked | Inventory instances and copies; invalidate where controlled |
| Backups and external copies | Outside immediate API control | Agree expiration and processor procedures; downloaded copies cannot be recalled |

An erasure job must serialize with replacement, retry and deletion; record
authorization, target, inventory, hold decision and outcome; and prove that no
current retrieval or source read can expose erased text. 07C intentionally has
no destructive execution endpoint.
