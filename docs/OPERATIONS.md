# Local operational visibility — 14B

**Status:** local deterministic checks only. The operator selected Slack webhooks
for delivery; a real webhook URL and delivery test remain open. The account and
region decision in [deployment design](DEPLOYMENT.md) is still incomplete.

| Check | Healthy result | Failure action |
| --- | --- | --- |
| `GET /health` | 200 while API process serves HTTP | Restart or inspect API process. It does not query dependencies. |
| `GET /ready` | 200 after a PostgreSQL `SELECT 1` | Keep API out of traffic; inspect DB network, credentials and migration state. |
| `GET /health/worker` | 200 when the workflow heartbeat is at most 30 seconds old | Check worker process, DB access and last poll. The worker writes every 10 seconds. |
| `GET /api/v1/usage/operations` | ADMIN/MANAGER scoped failed/stale workflow IDs, expired questionnaire IDs, failed row IDs and recent alert kinds | Open the exact job in Activity or Questionnaires; inspect its safe status, then use existing retry/cancel controls. |
| `GET /api/v1/usage/summary` | Scoped allowance, unknown usage, failed traces and alert events | Pause provider work if needed; compare actual provider bill separately. |

The API creates a server-side `X-Request-ID` for requests. HTTP logs contain
only event, request ID, authenticated organization ID, method, status and
duration. Existing usage traces now carry the same ID for document, draft,
answer and extraction calls. Workflow logs contain run/job and organization
IDs, without prompts, tokens or document text. Unexpected HTTP/provider/worker
errors log a category only; staff can correlate a trace or run from the ID.

The worker records one heartbeat row for its role. A stale row remains visible
after a crash, then becomes healthy when a worker resumes. Multiple workers
can update the same role row; this check proves at least one is alive. It does
not prove every queue item is making progress. The operations view separately
shows expired workflow/questionnaire leases and recent failures.

The existing `usage_alert_events` table is the local alert sink. Budget denial
already creates `ALLOWANCE_EXHAUSTED`. The worker now records
`PROVIDER_FAILURE` and `WORKFLOW_STALE` at most once per organization per
15-minute bucket; repeated polls use the unique dedupe key. Events contain
kind/time/organization only. The usage summary and operations view expose recent
events to authorized staff. Set `SLACK_ALERT_WEBHOOK_URL` as a worker-only HTTPS
secret for the operator's private Slack channel. Set `SLACK_CLIENT_WEBHOOK_URLS`
as a worker-only JSON secret mapping Sellora organization IDs to client Slack
webhooks, for example `{ "<organization-id>": "<client-webhook-url>" }`. Get a
client's organization ID from authenticated `GET /api/v1/users/me`. Client URLs
must use `https://hooks.slack.com`. An organization without a client mapping
receives no client Slack notification. Never use one client's webhook as the
operator webhook. n8n's client-owned Slack credentials are separate from these
Sellora operational alerts.

The operator message contains alert kind, organization ID, time and alert ID.
The client message omits organization ID and contains only its own alert kind,
time and alert ID. Separate database claims and timestamps track operator and
client delivery. Failure retries after one minute. A crash after Slack accepts
a message can cause one duplicate. The disposable local webhook fixture checks
two organizations, isolated destinations, failure/retry and content redaction.
A real destination test remains open; never paste webhook URLs into Git or logs.

## Connect a test workspace

1. Create a private test channel in your Slack workspace. Follow [Slack's
   Incoming Webhooks guide](https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks)
   to create an app, enable webhooks and authorize that channel. Keep its URL
   in a secret store; Slack treats it as a secret.
2. Supply that URL to the workflow worker as `SLACK_ALERT_WEBHOOK_URL`. It sends
   only operator alerts. Do not configure a client mapping for the first test.
3. With a consenting client and a separate client test channel, create a second
   webhook in that client's workspace. Add only that client's Sellora ID and URL
   to `SLACK_CLIENT_WEBHOOK_URLS`. Restart the worker after changing secrets.
4. Run one bounded synthetic alert for each destination, check the two channels,
   and record both delivery timestamps and failure/retry behavior. Do not start
   against an unknown live queue or use client content as the test payload.

This manual mapping suits a small pilot. Automated client onboarding needs a
secret-store-backed connection flow and rotation/revocation procedure.

Operational checks are not client acceptance. A readiness probe should use a
short caller timeout; a database outage may delay the DB driver's response.
Provision an external monitor for `/health/worker` and the Slack webhook before
running unattended. No chat endpoint or paging destination is configured yet.

## Incident runbook — 14D

**Owner:** Sellora operator for the operator-owned pilot; named primary, backup,
support hours, response window and client escalation contact are TBD in the
first-client agreement. Until then, no response SLA is promised. Record incident
ID, start time, affected organization IDs, request/run IDs, severity, last known
good release, action owner and next update time. Send only metadata through the
operator Slack channel; use each client's agreed private channel for its own
impact. Do not send source text, tokens, webhook URLs or another client's IDs.
For a shared outage, assess each affected organization separately and tell each
client only its own status. Record resolution time, restored function and any
unrecovered work; send a closure update and schedule a cause review.

| Symptom / precondition | Operator action | Expected check |
| --- | --- | --- |
| Provider outage, timeouts or elevated `PROVIDER_FAILURE` | Check `/api/v1/usage/operations` and provider status/bill using the approved account. ADMIN sets `PUT /api/v1/usage/pause` with `{"paused":true}` for each affected org if retries could consume budget. Stop affected intake/worker claims using the chosen deployment controls. Retry one safe failed run only after provider recovery. | No new costly admission while paused; `GET /api/v1/usage/summary` shows paused state and attempted/unknown usage. Resume with `{"paused":false}` after a bounded smoke run. |
| Stuck workflow, questionnaire row or ingestion | Get `/api/v1/usage/operations`, then the exact `/api/v1/workflow-runs/:id` or questionnaire/document detail. Check worker heartbeat and lease age, source status and provider errors. Use `POST /api/v1/workflow-runs/:id/retry` or `/:id/cancel`, questionnaire row retry/cancel, or `POST /api/v1/documents/:id/versions/:versionId/retry` only for the matching failed item. | Exact job reaches a terminal or expected queued state; no duplicate external send. If the original upload itself is blocked, stop intake and investigate parser/storage before asking for a new upload. |
| Worker unhealthy or stale lease | Check `/health/worker`, `/ready`, deployment process logs and DB connectivity; preserve run IDs. Restart one worker of the matching release using the selected host's service control, then check heartbeat and `/api/v1/usage/operations`. | Heartbeat fresh and stale work reclaims under lease fencing; do not start extra workers or process the same item manually while ownership is uncertain. |
| Budget exhausted / `ALLOWANCE_EXHAUSTED` | Check scoped `/api/v1/usage/summary` and actual provider bill. Keep expensive work paused; record attempted unknown quantities and the denied operation. Ask the authorized client/operator owner to approve a new limit before resuming. | New admission remains denied until a documented limit change; there is no automatic spend increase. |
| Source replacement/deletion | Inspect `GET /api/v1/documents/:id/versions` and current draft/approved-answer references. Replace with expected active-version ID or tombstone with `DELETE /api/v1/documents/:id` and `{"expectedActiveVersionId":"..."}` only under the document owner's instruction. Inspect affected review queue and reapprove a new exact revision if needed. | Old citations report `STALE` or `UNAVAILABLE`; an old approval/export cannot silently pass as current. See [source contract](SOURCE_CONTRACT.md) and [retention contract](RETENTION.md). |
| Credential suspected exposed or staff departure | Identify the owning org and integrations. ADMIN revokes the exact key with `DELETE /api/v1/api-keys/:id`; rotate its n8n secret and update only that client's automation. For staff departure, use the [account procedure](ACCOUNT_OPERATIONS.md), which revokes all org keys. Rotate JWT/provider/Slack/OAuth credentials in the chosen secret store, restart affected processes and invalidate grants at their issuer. | Old key/grant fails; new limited credential works on one bounded synthetic event; other orgs remain unaffected. A Slack webhook is an outbound alert destination, not an n8n credential. |

Use the [restore procedure](RESTORE.md) if the database or originals are corrupt.
Keep the matched backup before a release; do not roll an old binary onto an
incompatible migrated schema. Use the [offboarding procedure](OFFBOARDING.md)
for export, access revocation and deletion requests.
