# Source identity and publication

`Document.id` is the stable organization-owned source ID used by existing APIs and
citations. `DocumentVersion.id` identifies one immutable original and its chunk
set. A version has a monotonically increasing number within its document, the
SHA-256 hash of the uploaded original bytes, an original storage path and a
build/published/failed/retired status. Historical rows migrated without access
to their original file bytes have an explicitly unknown hash; no hash is
fabricated from metadata or chunks. `Document.activeVersionId` names the only
version eligible for new retrieval. `deletedAt` tombstones the whole document.

Each chunk retains its existing ID and document ID and gains a version ID. A
chunk's index is unique within its version. The migration leaves historical
chunk IDs, text, vectors and original paths in place. New versions receive new
chunk IDs. Retrieval requires matching organization, nondeleted document,
active version and published status in both vector and lexical paths. A
candidate can be built while the old active version remains searchable; a
transaction changes the active pointer only after validated chunk/vector writes.

PDF parser page records supply actual 1-based `pageNumber` values. Chunking is
performed per page so a chunk never spans pages. TXT, Markdown and DOCX chunks
have no page number; their heading path, section title and passage index are
the available location. Citations carry `documentId`, `versionId`, `chunkId`,
`chunkIndex`, optional actual page, heading path and section title. A blank
page number means unknown, not page 1.

Replacement requires the expected active version ID (or null for a document
with no active version). Two candidates may build concurrently; only one can
publish against that expected pointer. Failed/conflicted candidates keep their
originals for a scoped retry and never enter retrieval. Deletion uses the same
expected pointer and immediately removes the document from new retrieval while
retaining historical records for the later 07C retention decision. Deletion
cannot be undone by a late candidate publication. Approval/export must
revalidate source availability in Part 08; there is no durable approval yet.
