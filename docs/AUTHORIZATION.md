# Route authorization contract

Packet 04B, October 5, 2026. Routes below are relative to `/api/v1`.
Organization authority comes from the current active JWT user or active, unexpired
API key. A top-level body `organizationId` is rejected with 403, including parsed
multipart fields. Unknown query fields cannot change organization context. Nested
webhook payload fields remain untrusted business data; processing uses the stored
run's organization, never the payload's organization.

Missing/invalid credentials or a credential of the wrong kind return 401. An
accepted credential with a disallowed role/scope returns 403. A foreign or missing
resource ID returns 404 without data, after the caller passes the route guard.
Other validation/state errors retain existing 400/409/422 contracts. Bulk lead
updates filter to the caller's organization and return an updated count (zero
for foreign-only IDs), without disclosing whether foreign IDs exist.

## Protected routes

`Y` means allowed within the caller's organization, subject to validation and
state checks. `—` means denied. `Self` means the authenticated user's record or
sessions, even for an admin. `Assigned` limits a REP to their assigned leads.
Machine scope does not confer a staff identity: FULL_ACCESS cannot use JWT-only
administration/document routes. READ_ONLY currently has no permitted protected
route; do not infer new read permissions from its name.

| Method and route | ADMIN | MANAGER | REP | READ_ONLY | FULL_ACCESS | WEBHOOK_ONLY |
| --- | --- | --- | --- | --- | --- | --- |
| GET /users | Y | Y | Y | — | — | — |
| GET /users/me | Self | Self | Self | — | — | — |
| PATCH /users/profile | Self | Self | Self | — | — | — |
| PATCH /users/change-password | Self | Self | Self | — | — | — |
| GET /auth/sessions | Self | Self | Self | — | — | — |
| DELETE /auth/sessions/:id | Self | Self | Self | — | — | — |
| POST /auth/logout-all | Self | Self | Self | — | — | — |
| GET /leads | Y | Y | Assigned | — | — | — |
| POST /leads | Y | Y | Self-assigned | — | — | — |
| GET /leads/:id | Y | Y | Assigned | — | — | — |
| GET /leads/:id/detail | Y | Y | Assigned | — | — | — |
| PATCH /leads/:id | Y | Y | Assigned; no reassignment | — | — | — |
| DELETE /leads/:id | Y | Y | — | — | — | — |
| PATCH /leads/bulk/assign | Y | Y | — | — | — | — |
| PATCH /leads/bulk/status | Y | Y | — | — | — | — |
| GET /documents | Y | Y | Y | — | — | — |
| GET /documents/:id | Y | Y | Y | — | — | — |
| POST /documents | Y | Y | — | — | — | — |
| POST /documents/upload | Y | Y | — | — | — | — |
| POST /documents/upload-file | Y | Y | — | — | — | — |
| POST /documents/:id/ingest-text | Y | Y | — | — | — | — |
| GET /api-keys | Y | Y | — | — | — | — |
| POST /api-keys | Y | Y | — | — | — | — |
| DELETE /api-keys/:id | Y | Y | — | — | — | — |
| GET /invites | Y | Y | — | — | — | — |
| POST /invites | Y | Y | — | — | — | — |
| DELETE /invites/:id | Y | Y | — | — | — | — |
| POST /invites/:id/resend | Y | Y | — | — | — | — |
| POST /ai/grounded-answers | Y | Y | Y | — | Y | — |
| POST /ai/extractions/sales-event | Y | Y | Y | — | Y | — |
| POST /ai/extractions/rfp | Y | Y | Y | — | Y | — |
| GET /workflow-runs | Y | Y | Y | — | Y | Y |
| GET /workflow-runs/:id | Y | Y | Y | — | Y | Y |
| POST /workflow-runs/:id/process | Y | Y | Y | — | Y | Y |
| POST /workflow-runs/process-next | Y | Y | Y | — | — | — |
| POST /workflow-runs/process-queued | Y | Y | Y | — | — | — |
| POST /crm-writeback/preview | Y | Y | Y | — | Y | Y |
| POST /webhooks/email-received | — | — | — | — | Y | Y |
| POST /webhooks/call-transcript | — | — | — | — | Y | Y |
| POST /webhooks/crm-event | — | — | — | — | Y | Y |
| POST /webhooks/manual-question | — | — | — | — | Y | Y |

These preserve existing staff and webhook permissions. WEBHOOK_ONLY already
allows workflow reads/processing and CRM preview; it is not an intake-only scope.
CRM preview persists a pending sync log, not an external CRM write. REP lead
scoping does not imply REP-specific access restrictions on organization-wide
workflow history or source knowledge. Invite roles remain MANAGER/REP, never ADMIN.

## Public and capability routes

| Method and route | Authority |
| --- | --- |
| GET /health (outside API prefix), GET /api/v1 | Public process/API information |
| POST /auth/register | Public; creates a new organization, cannot join a supplied org ID |
| POST /auth/login | Email/password |
| POST /auth/refresh | Refresh token in body or cookie; see session policy |
| POST /auth/logout | Refresh token in body or cookie; does not revoke issued JWTs |
| GET /invites/validate/:token | Possession of the invite token; returns its limited recipient/organization metadata |
| POST /auth/accept-invite | Possession of an eligible invite token |

Account abuse controls, invite races, recovery and production cookie topology
belong to 04C. Session semantics and actual 04A evidence are in
[SESSION_POLICY.md](SESSION_POLICY.md).

## Sources and future routes

Answers and RFP responses include citations only from the authenticated
organization's eligible documents. Foreign-only document allowlists refuse with
empty citations; mixed lists never expand access. Empty lists refuse. This is a
200 refusal result, not a resource-detail lookup. Document detail exposes scoped
metadata; there is no original-file download/source endpoint yet.

Drafts, approved answers, revision exports and source-file fetches remain
unimplemented. `/drafts`, `/approved-answers`, `/drafts/:id/export` return 404;
`/documents/:id/source` passes the document router's JWT guard before 404. Parts
07–09 must add explicit permissions and extend these tests before shipping.
Browser copy in the current draft page is not a durable export API.

## Compatibility and acceptance

READ_ONLY keys formerly invoked grounded generation and extraction. Those POSTs
now require FULL_ACCESS for machine callers and return 403 for READ_ONLY. Do not
upgrade a browser widget to FULL_ACCESS: organization keys belong server-side;
the public widget remains deferred with separate corpus/credential/usage gates.
Callers sending a redundant body organizationId must remove it. Foreign session revocation now returns 404 instead of 403, matching a missing
session. No schema or migration change is required.

Run from `apps/server`: `npm run typecheck`, `npm test`, `npm run test:db`.
The disposable wrapper invokes `scripts/integration/httpAuthorization.ts` against
its owned test database. The matrix exercises all 41 protected routes with seven
caller kinds, plus foreign IDs, same-org session ownership, REP assignment,
foreign joins, body/query/payload spoofing, source allowlists, revoked/expired
keys and absent future routes. Authentication, HTTP serialization and SQL are
real; provider responses are synthetic and citation retrieval uses the actual
local SQL fallback. Existing knowledge-path tests cover actual vector SQL.
No live provider, browser acceptance or production deployment is claimed.

Local acceptance on October 5, 2026: typecheck PASS, server tests 14/14 files PASS,
full disposable suite PASS including 404 authorization HTTP assertions and cleanup.
Public registration/login/invite capabilities were also exercised. Astra review
remains pending; Part 04 is incomplete until 04C acceptance.
