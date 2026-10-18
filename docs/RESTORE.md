# Backup, restore and migration recovery — 14C

**Status:** local synthetic rehearsal only. The first client's host, region,
storage product, backup encryption/location and recovery targets are undecided.
Do not restore onto an existing service or use a development Compose volume as a
client backup. Follow the chosen host's documented snapshot procedure when the
target is agreed.

## Backup cut

1. Name the organization(s), release revision, database, originals volume,
   operator and intended backup destination. Confirm storage capacity and
   encryption/access controls. Keep credentials and backup artifacts out of Git,
   tickets and shared logs.
2. Stop external intake and worker claims. Let in-flight uploads, document
   replacement, approval and export complete or cancel them. Check no writer
   remains; database and originals must represent the same cut.
3. Record the cut time. Take a PostgreSQL custom-format dump or an equivalent
   consistent managed snapshot, then snapshot every managed original file from
   `DOCUMENT_STORAGE_DIR` while writes remain stopped. Record migration list,
   file paths, byte counts and SHA-256 hashes in a private manifest. Back up
   database and originals under the same backup ID.
4. Verify artifacts are readable and the manifest is complete before resuming
   writes. A DB dump alone cannot restore original uploads. A file snapshot
   alone cannot restore draft/source relationships.

`storagePath` is persisted with each document version. Mount originals at the
same logical path in the restored environment, or explicitly remap and verify
every path before traffic. Do not rewrite arbitrary paths from a client backup.
Use a separate secure backup destination and access identity; those choices
remain part of 14A.

## Isolated restore and release check

1. Provision an empty database with compatible PostgreSQL/pgvector and an
   empty originals volume in a separate environment. Restrict network access.
   Keep intake, worker and external provider calls disabled.
2. Restore the selected database dump and original snapshot. Check migration
   history, counts, file hashes, version content hashes, active-version IDs,
   draft source triples and exact revision/approval IDs. Inspect a second
   organization to confirm tenant boundaries.
3. Start the matching API release against the isolated target. Check `/health`,
   `/ready`, an authorized draft/source read and foreign-organization denial.
   Do not infer live provider quality from this smoke check.
4. Before a real upgrade, take a fresh matched backup. Deploy forward
   migrations once, then API and worker of the same compatible release. A
   failed transactional migration must leave the previous data intact; repair
   it with a new forward migration and rerun on an isolated copy first. If an
   applied migration changed the schema incompatibly, do not start an old app
   binary against it. Restore the matched backup into a separate environment
   or use a tested forward repair.
5. Record restore start, API-ready time, latest recoverable write, backup cut,
   missing post-cut writes, artifact checks and any manual steps. Only then
   choose whether to switch traffic. Production RTO/RPO targets need client
   agreement; one local fixture time is not an SLA.

The executable rehearsal is `node scripts/integration/runDisposable.mjs
--restore-only` from `apps/server`. It owns a fresh source container, creates a
second restore container, backs up one synthetic original with a PostgreSQL
dump, checks hashes/revisions/approval and HTTP isolation, forces a failing
transactional schema change, applies a safe forward change and removes both
containers and temporary files. It records measured local elapsed times. It
does not validate a managed provider's snapshot, encrypted remote backup,
production workload or client recovery time.
