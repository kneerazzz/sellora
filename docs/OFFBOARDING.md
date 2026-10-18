# Organization export and offboarding — 14D

**Status:** supported steps rehearsed on a disposable synthetic organization;
full physical erasure is unavailable. The Sellora operator is the working owner
for an operator-hosted pilot. Named primary/backup, support hours, response
window, export format, retention duration, backup expiry, legal holds and
processor responsibilities need first-client agreement. Client instructions
and an authorized destruction target are required before a real offboarding.

## Operator procedure

1. Record the authorized organization ID, requesting person, scope, export
   recipient/private channel, desired cutoff, legal hold decision and a second
   approver for any irreversible destruction. Check the org ID on every step;
   never use an unscoped database delete against a shared backend. Tell the
   client which artifact types can be exported and which remain unavailable.
2. Stop that client's n8n intake and scheduled external jobs, then wait for or
   cancel in-flight work. Set `PUT /api/v1/usage/pause` to `{"paused":true}`
   as an ADMIN so new expensive work is denied. This switch does not stop all
   reads or every nonprovider write; quiesce the workflow at its owner too.
3. Export approved, currently sourced content while it remains current:
   `POST /api/v1/drafts/:id/exports` with the exact `revisionId`,
   `includeSources:true`, `approvedOnly:true`. Check the response revision,
   approval and source status; deliver the returned text through the approved
   private channel. This endpoint is per draft, not an organization-wide archive.
   Inventory document originals, versions, drafts, approvals, answers,
   questionnaires, workflow payloads, usage/audit rows and client-owned n8n
   copies separately. Original file download and a complete organization export
   are not implemented; do not promise them.
4. Revoke org API keys with `DELETE /api/v1/api-keys/:id`, verify old keys fail,
   remove that org's `SLACK_CLIENT_WEBHOOK_URLS` entry, revoke client Gmail/OAuth
   grants and n8n credentials at their respective owners, and remove any
   scheduled triggers. Staff deactivation is covered by
   [account operations](ACCOUNT_OPERATIONS.md); it revokes all org keys, not a
   single staff-owned key. The operator alert webhook is shared and must remain
   for other clients; rotate it if exposed.
5. For a requested source deletion, first use ADMIN
   `GET /api/v1/documents/:id/erasure-preview` and record version/chunk/vector,
   original-file and known interaction counts. It lists external surfaces but
   does not inspect them. `DELETE /api/v1/documents/:id` with the expected active
   version tombstones the source, making its citations unavailable for approved
   use. It retains original bytes, historical rows and backup copies.
6. Inventory process/browser caches, downloaded exports, logs, workflow JSON,
   provider records, client n8n storage and other external copies with their
   owners. Purge only under the agreed policy and verify each surface. Match
   every backup ID to an agreed expiration date and legal hold; record the last
   expiry and deletion evidence. A tombstone plus elapsed time is not erasure.
7. Close with an itemized receipt: exported IDs/revisions, revoked credential
   IDs and confirmation, tombstoned source IDs, surviving surfaces, holds,
   backup expiry dates, any unimplemented action, and who will send the next
   update. Do not mark the organization erased until a separately designed,
   authorized and verified physical-erasure procedure covers database history,
   originals, caches and backups while leaving other organizations intact.

## Disposable rehearsal and limits

From `apps/server`, run `node scripts/integration/runDisposable.mjs
--offboarding-only`. The wrapper creates a fresh owned source database, takes a
matched DB/original backup, restores a separate container and file path, then
starts an API only against the restored copy. It proves exact approved-revision
export, foreign export/key denial, one-org API-key revocation with old-key 401, foreign key/org
preservation, erasure-preview availability and source tombstone. It asserts
that restored originals and backup bytes remain. Both containers and temporary
files are removed. There is no persistent application cache in this fixture;
browser/process caches and client n8n copies are inventory items, not claimed
clean. Backup expiry is unagreed. The fixture's temporary cleanup is a test
boundary, not evidence of a production erasure endpoint.

See [retention](RETENTION.md) for the full-erasure engineering contract and
[restore](RESTORE.md) for matched backup handling.
