# Route authorization contract

Packet 04B, October 5, 2026; extended for 04C.2 on October 7. Routes below are relative to `/api/v1`.
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
| POST /users/:id/recovery | Y | — | — | — | — | — |
| POST /users/:id/deactivate | Y | — | — | — | — | — |
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
| GET /documents/:id/versions | Y | Y | Y | — | — | — |
| POST /documents/resolve-references | Y | Y | Y | — | — | — |
| GET /documents/:id/versions/:versionId/source | Y | Y | Y | — | — | — |
| GET /documents/:id/erasure-preview | Y | — | — | — | — | — |
| POST /documents/:id/replace-text | Y | Y | — | — | — | — |
| POST /documents/:id/replace-file | Y | Y | — | — | — | — |
| POST /documents/:id/versions/:versionId/retry | Y | Y | — | — | — | — |
| DELETE /documents/:id | Y | Y | — | — | — | — |
| GET /api-keys | Y | Y | — | — | — | — |
| POST /api-keys | Y | Y | — | — | — | — |
| DELETE /api-keys/:id | Y | Y | — | — | — | — |
| GET /usage/summary | Y | Y | — | — | — | — |
| PUT /usage/pause | Y | — | — | — | — | — |
| GET /drafts | Y | Y | Y | — | — | — |
| POST /drafts | Y | Y | Y | — | — | — |
| GET /drafts/:id | Y | Y | Y | — | — | — |
| POST /drafts/:id/revisions | Y | Y | Y | — | — | — |
| POST /drafts/:id/approvals | Y | Y | — | — | — | — |
| POST /drafts/:id/exports | Y | Y | Y | — | — | — |
| POST /drafts/:id/exports/:exportId/copied | Y | Y | Y | — | — | — |
| DELETE /drafts/:id | Y | Y | Y | — | — | — |
| GET /approved-answers | Y | Y | Y | — | — | — |
| POST /approved-answers | Y | Y | Y | — | — | — |
| GET /approved-answers/suggestions | Y | Y | Y | — | — | — |
| GET /approved-answers/review-queue | Y | Y | Y | — | — | — |
| GET /approved-answers/:id | Y | Y | Y | — | — | — |
| POST /approved-answers/:id/revisions | Y | Y | Y | — | — | — |
| POST /approved-answers/:id/approvals | Y | Y | — | — | — | — |
| POST /approved-answers/:id/reuse | Y | Y | Y | — | — | — |
| DELETE /approved-answers/:id | Y | Y | Y | — | — | — |
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
| POST /workflow-runs/:id/retry | Y | Y | Y | — | — | — |
| POST /workflow-runs/:id/cancel | Y | Y | Y | — | — | — |
| POST /crm-writeback/preview | Y | Y | Y | — | Y | Y |
| POST /webhooks/email-received | — | — | — | — | Y | Y |
| POST /webhooks/gmail-received | — | — | — | — | Y | Y |
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
| POST /auth/reset-password | Possession of a short-lived, single-use recovery capability issued by an organization admin or the break-glass operator command |
| GET /invites/validate/:token | Possession of the invite token; returns its limited recipient/organization metadata |
| POST /auth/accept-invite | Possession of an eligible invite token |

Account attempt limits are verified in 04C.1. Invite/recovery/offboarding behavior
is documented in [ACCOUNT_OPERATIONS.md](ACCOUNT_OPERATIONS.md). Production cookie
topology remains 04C.3. Session semantics and actual 04A evidence are in
[SESSION_POLICY.md](SESSION_POLICY.md).

## Sources and future routes

Answers and RFP responses include citations only from the authenticated
organization's eligible documents. Foreign-only document allowlists refuse with
empty citations; mixed lists never expand access. Empty lists refuse. This is a
200 refusal result, not a resource-detail lookup. Document detail exposes scoped
metadata; there is no original-file download/source endpoint yet.

Draft CRUD, exact-revision approval and revision export/copy audit are implemented
for JWT staff under the organization boundary described in
[DRAFT_CONTRACT.md](DRAFT_CONTRACT.md). Approval is ADMIN/MANAGER-only under the
local policy and also denies the revision author. Export request and
browser-reported copy confirmation are separate immutable events; neither marks
delivery sent. The approved-answer routes use the same JWT staff boundary.
ADMIN/MANAGER approval also denies the answer revision author; all other library,
suggestion, reuse, queue and archive actions allow all three staff roles. Reuse
creates a new review-required draft and never inherits approval. Source-file
fetches remain unimplemented. `/drafts/:id/export` returns 404 after draft-router
authentication; `/documents/:id/source` passes the document router's JWT guard
before 404. Browser copy and approved-answer actions are not yet connected to the
staff UI; Part 10 owns the integrated journey.

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
The account-lifecycle harness also covers the two new ADMIN-only user routes with
staff roles, all three valid API-key scopes, unauthenticated/invalid credentials,
foreign IDs and self-deactivation. No live provider, browser acceptance, email
delivery or production deployment is claimed.

Local acceptance on October 5, 2026: typecheck PASS, server tests 14/14 files PASS,
full disposable suite PASS including 404 authorization HTTP assertions and cleanup.
Public registration/login/invite capabilities were also exercised. Part 04 later
completed its local 04C acceptance; Astra review of the completed Part 04 repair
remains pending.

Packet 08B extended the matrix on October 14, 2026 to 57 protected routes and
543 HTTP assertions. Packet 08C/08D extended it on October 15 to 60 routes and
570 assertions across seven caller kinds. Draft CRUD/export/copy allow staff
JWTs and deny machine callers; approval permits ADMIN/MANAGER only. Foreign
draft IDs return 404 for permitted roles, and body organization overrides remain
rejected. The full disposable suite and cleanup passed with deterministic
providers. No browser journey, live provider, client acceptance or external
delivery was tested.

Part 09 extended the matrix on October 16, 2026 to 69 protected routes and 641
HTTP assertions. Approved-answer records, suggestions, review queue, reuse and
archive allow JWT staff and deny machine callers; exact-revision approval remains
ADMIN/MANAGER-only. Foreign entry IDs return 404 for permitted roles. The full
20-migration disposable suite and cleanup passed with deterministic providers.
No approved-answer UI, browser journey, live provider or client acceptance was
tested.

Packet 11B extended the matrix on October 17, 2026 to 70 protected routes and
648 HTTP assertions. The selected Gmail intake route permits organization-scoped
WEBHOOK_ONLY/FULL_ACCESS keys and denies JWT staff and READ_ONLY keys. Its
dedicated disposable fixture verifies strict versioned input, body organization
override denial, stable message-ID replay behavior and one queued run. No live
Gmail or n8n account was connected.
