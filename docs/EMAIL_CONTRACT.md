# Gmail intake contract — packets 11A/11B

**Decision recorded 2026-10-17.** The user selected one client-owned Gmail test inbox, a client-owned n8n instance and Google OAuth project, and Sellora-only review tasks. The authorized local/sandbox ceiling is **50 incoming test emails per day**. Gmail access must be read-only. No Gmail draft creation, sending, message modification, second mailbox, or live connection is authorized by this record. The actual mailbox address, OAuth credential and Sellora webhook key have not been supplied.

## 11A — ownership and data flow

The selected intake path is the n8n [Gmail Trigger](https://docs.n8n.io/integrations/builtin/trigger-nodes/n8n-nodes-base.gmailtrigger/) polling the one client-owned inbox, then an n8n normalization step posting a versioned message summary to Sellora over HTTPS. Sellora authenticates that request with a dedicated organization-scoped `WEBHOOK_ONLY` bearer key and stores one email event and queued workflow run per Gmail message ID. Packet 11C will turn accepted events into reviewable drafts; 11B alone does not create a staff task.

The client's Google OAuth project and n8n credential must request **only** [`https://www.googleapis.com/auth/gmail.readonly`](https://developers.google.com/workspace/gmail/api/auth/scopes). n8n's [default Gmail credential scopes](https://github.com/n8n-io/n8n/blob/master/packages/nodes-base/credentials/GmailOAuth2Api.credentials.ts) include mail modification and compose permissions; enable its custom-scopes option and inspect the actual granted scopes before activation. Google classifies `gmail.readonly` as restricted, with verification and possible security-assessment obligations when restricted data is transmitted to servers. The client owns Google consent/project compliance and may revoke the OAuth grant; the client can also disable the n8n workflow, and a Sellora ADMIN/MANAGER can revoke the dedicated API key. After revocation, intake fails closed and historical Sellora records remain subject to the pilot's still-undecided retention policy.

Data transferred to Sellora in 11B is the Gmail immutable message ID, thread ID, sender/recipient addresses, subject, untrusted mail `Date` header, message size estimate and at most 16,000 characters of plain text. Sellora assigns its own receipt time. It excludes attachment bytes, raw MIME, OAuth tokens and mailbox drafts. The selected n8n workflow filters drafts, sent mail and messages with attachments, and caps each poll at 10 items. A 10-item poll cap is not a daily limit: an enforceable 50-message/day stop is still required before any live activation. The server contract rejects malformed or oversized submissions and uses the API key, never a body organization field, for organization identity. The n8n instance and Sellora will both handle client email content, so their hosting, retention and access controls require client agreement before live use.

## Cost and terms inventory

The client pays for its Gmail/Google project and n8n hosting or plan; Sellora's provider, database, storage and support costs remain separate and unmeasured. Google's [current Gmail API quota page](https://developers.google.com/workspace/gmail/api/reference/quota) lists per-minute quotas and a daily quota-unit billing threshold, with future billing details subject to change. [n8n pricing](https://n8n.io/pricing/) is based on workflow executions for its paid plans; actual client plan and self-hosting costs are unknown. The 50-message ceiling is a user-authorized sandbox limit, not a cost estimate or product allowance. Recheck both vendors' terms and the client's actual plan before a quote or live activation.

## 11B — version 1 Sellora request

`POST /api/v1/webhooks/gmail-received` with `Authorization: Bearer <organization WEBHOOK_ONLY key>` and JSON:

```json
{
  "version": 1,
  "messageId": "18f0a1b2c3d4e5f6",
  "threadId": "18f0a1b2c3d4e5f6",
  "from": "buyer@example.test",
  "to": "pilot@example.test",
  "subject": "Refund policy question",
  "text": "Can you explain the refund window?",
  "messageDate": "2026-10-17T09:00:00.000Z",
  "sizeEstimate": 1024
}
```

The Gmail API's [message resource](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages) supplies stable `id` and `threadId`; a thread ID is context, not the deduplication key. The `Message-ID` mail header is not substituted for Gmail's `id`. The endpoint requires exact fields, rejects body organization overrides, and never triggers synchronous provider work. Exact retries return the same event and run; a reused message ID with changed content returns 409. The legacy generic `/webhooks/email-received` route remains a separate example and is not the selected Gmail contract.

The accepted HTTP 202 envelope contains `data.version: 1`, `data.webhookEventId`, `data.workflowRunId`, `data.status: "QUEUED"` and `data.workflowType: "SALES_EVENT_EXTRACTION"`. Exact retries keep the event and run IDs. This response means queued intake, not that a review task or draft exists.

The client-owned [saved n8n workflow](../n8n/sellora-gmail-intake-workflow.json) must be imported inactive and configured with an HTTPS Sellora base URL, a dedicated organization webhook key, one read-only Gmail credential, and an enforced daily ceiling. The JSON contains only an invalid example host and no credentials. Activation and any actual Gmail call remain packet 11D work after the client supplies the account and agrees the deployment/retention boundary.

## 11C — review task created by the worker

For a valid version-1 Gmail event, the worker extracts at most three buyer questions, each capped at 1,000 characters, and attempts grounded answers. It creates one system-authored Sellora draft per event under the existing workflow lease, using `gmail:<Sellora event ID>` as the draft idempotency key. The draft's question shows the bounded original sender, subject and plain-text email; its first revision contains the bounded answer sections and validated current-organization source references. The draft always requires staff review and has delivery `NOT_REQUESTED`. Activity links to the draft ID; the existing Drafts page lists it.

Question-free extraction, answer refusal, unavailable citations and terminal extraction failure create an explicit review-required placeholder with the original email context. A retry reuses that draft and does not overwrite staff work; staff must inspect/edit a placeholder even if a later extraction run succeeds. Failed runs and their retry state also remain visible in Activity. Attachment bytes and raw MIME are still rejected by the 11B contract. The saved trigger excludes sent/draft/attachment messages and now rejects a self-addressed message in the mapping; the server also rejects it. This prevents the selected Sellora-only path from processing its own mail in the one-inbox pilot, while broader notification-loop behavior remains a live 11D check.

The [11D sandbox sheet](evidence/email-sandbox.md) is prepared, but its live cases are unrun. The selected n8n workflow remains inactive, and the 50-message/day stop, real client account, OAuth grant, deployed host, retention agreement and connector operations runbook are still activation gates.
