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
secret reference after the operator creates a private Slack channel and webhook.
The worker sends only alert kind, organization ID, time and alert ID. A database
claim limits parallel delivery and retries failures after one minute. A crash
after Slack accepts a message can cause one duplicate. The disposable local
webhook fixture checks success, failure, retry and content redaction. A real
destination test remains open; never paste the webhook URL into Git or logs.

Operational checks are not client acceptance. A readiness probe should use a
short caller timeout; a database outage may delay the DB driver's response.
Provision an external monitor for `/health/worker` and the Slack webhook before
running unattended. No chat endpoint or paging destination is configured yet.
