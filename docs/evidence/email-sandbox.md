# Gmail sandbox acceptance — 11D preparation

**Status: prepared; live checks unrun.** The user chose a runbook only for now. No Gmail inbox, n8n instance, OAuth grant, deployed Sellora host or connector operations runbook has been provided. This sheet is an execution record template, not evidence that the channel works live.

## Preconditions before enabling the saved workflow

1. Record the client-owned test inbox address, n8n instance/operator, Google OAuth project owner, Sellora test organization and HTTPS host in the private client operations record. Do not put credentials in this sheet. Agree hosting, access and retention for email content in n8n and Sellora. Complete the selected connector's Part 14 operations runbook, including incident contact, revocation and disconnect steps.
2. Import [the selected workflow](../../n8n/sellora-gmail-intake-workflow.json) **inactive**. Replace its invalid example host; bind a dedicated organization `WEBHOOK_ONLY` bearer key. Check that it has only Gmail Trigger → normalize → Sellora HTTP nodes, with no Gmail write, CRM writeback or send node.
3. Set one Gmail OAuth credential to the exact `gmail.readonly` scope and inspect the granted scope in the client project. Confirm the trigger watches only the agreed inbox and excludes drafts, sent mail, attachments and self-addressed mail. Prove the configured workflow stops after **50 distinct incoming test emails per UTC day**, including failures and duplicates delivered by the mailbox; the saved 10-per-poll setting does not enforce this. Keep it inactive if the stop is absent.
4. Confirm the test organization has a staff reviewer, at least one approved test knowledge source, a running Sellora workflow worker and a recovery path for failed runs. Use sanitized synthetic messages only. Record baseline counts of Gmail test messages, Sellora webhook events, runs and drafts; record actual provider and n8n usage as measured or **unknown**, never assumed zero.

## Live cases (all count toward the 50-message/day ceiling)

| Case | Exact action | Required observation |
| --- | --- | --- |
| Normal | Deliver one synthetic question email to the one inbox. | One version-1 event, one run and one reviewable Sellora draft; Activity links to the same draft ID; no message or mailbox draft is written. |
| Duplicate | Replay the same Gmail message ID through a controlled n8n retry, then poll again. | Same event/run/draft IDs; no second draft or external write. A changed payload under the same ID is an actionable 409. |
| Missing/partial | Deliver one short or question-free synthetic message, then a message whose answer cannot be grounded. | n8n mapping or Sellora records a visible failure, or Sellora creates a review-required refusal with the original message; staff can identify the failed item. |
| Delayed | Disable the inactive test workflow, deliver one message, then resume within the agreed window. | Exactly one eventual task with the original Gmail ID; record actual delay and whether the trigger catches up. |
| Revoked | Revoke the client's Gmail grant, deliver one synthetic message, then restore the grant only after recording the error. Separately revoke the Sellora webhook key and retry one known event. | n8n shows actionable credential/401 errors; no task from an unauthenticated submission and no mailbox write. Record whether controlled recovery replays exactly once. |
| Rate limit | Use a controlled test-only Sellora rate-limit setting or n8n retry fixture for a known event. | 429 is visible, retries respect backoff, and recovery creates at most one task. Do not change a client production limit for this case. |
| Outage | In the test environment only, make the Sellora endpoint temporarily unavailable for one known event, then restore it. | n8n records the failure, controlled retry reaches one task, and no message is lost or duplicated. |

Record each case's UTC time, Gmail ID (redacted/hash in shared evidence), event/run/draft IDs, observed HTTP status, retry count, actual delay, n8n executions, Sellora provider usage and operator. An unrun case stays **UNRUN**. Stop at the agreed ceiling or on unexpected mailbox writes, credential scope expansion, cross-organization output, missing retry evidence or unknown duplicate behavior.

## Disconnect and evidence closeout

Disable the n8n workflow, revoke its Gmail grant and Sellora webhook key, then verify another poll and authenticated POST fail. Record retained test messages, n8n execution data, Sellora events/drafts and the agreed deletion/retention disposition; do not claim erasure until verified. Complete a client reviewer walk-through of the exact draft and Activity link. Record Google/n8n/Sellora measured usage and unresolved provider behavior. Keep 11D open until all live cases and disconnect evidence pass.
