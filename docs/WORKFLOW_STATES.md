# Workflow processing and ownership

Packet 06A defines processing state separately from human review and external
delivery. Packet 06B adds lease ownership and bounded retry scheduling. These
statuses describe local work only; no `COMPLETED` run is an approved reply or a
sent email.

| Processing status | Meaning | Allowed next status |
| --- | --- | --- |
| `QUEUED` | Accepted supported work, not claimed | `RUNNING`, `CANCELLED` |
| `RUNNING` | One current lease owner may process | `COMPLETED`, `RETRY_WAIT`, `FAILED`, `CANCELLED` |
| `RETRY_WAIT` | Attempt failed or lease expired; retry after `nextAttemptAt` | `RUNNING`, `FAILED`, `CANCELLED` |
| `COMPLETED` | Local processing produced an output, including an explicit refusal | terminal |
| `FAILED` | No automatic attempts remain or error is non-retryable | terminal |
| `CANCELLED` | Explicitly stopped before terminal processing | terminal |

Historical `NEEDS_REVIEW` rows migrate to `COMPLETED` with `reviewStatus=REQUIRED`.
The old enum label remains for PostgreSQL compatibility but new code never emits
it. `reviewStatus` defaults to `NOT_REQUESTED` and may become `REQUIRED` when a
refusal or incomplete question needs staff inspection. `APPROVED` and `REJECTED`
are future states; this packet adds no approval action. `deliveryStatus` defaults
to `NOT_REQUESTED`; `PENDING`, `SENT`, and `FAILED` reserve vocabulary for a later
selected integration. Processing completion cannot set approval or delivery.

Terminal processing states have `completedAt`; active states do not. A claim
sets `startedAt`, increments attempts and ownership version. Retryable failure
keeps the output/error evidence and schedules bounded backoff. The last attempt
sets terminal `FAILED`. A lease expiry is treated as unknown interrupted work,
not a successful completion. An owner may finalize only while its lease is
current; a reclaimed worker's token is fenced out.

The database worker polls sequentially, up to the configured batch size per
cycle. Claims use row locking with `SKIP LOCKED`, a unique owner UUID and an
incrementing lease version. The default lease lasts 60 seconds and renews
every 20 seconds; work from a killed process becomes eligible after expiry.
Default maximum attempts is three, with exponential 1–30 second backoff.
An exhausted expired lease becomes terminal `FAILED`. A graceful stop aborts
the active provider wait and stops admitting jobs; a hard stop relies on lease
expiry. Local model SDK calls can outlive their wait boundary, but stale owners
cannot publish a workflow result. Provider work already attempted before a
crash may have unknown usage; lease recovery does not claim it was zero.

Only `SALES_EVENT_EXTRACTION` and `GROUNDED_TECHNICAL_ANSWER` have processors.
Unsupported webhook event types fail before event/run insertion. Existing CRM
webhook examples may receive HTTP 400 until a real processor is selected; they
are not production integrations.

Packet 06C scopes webhook idempotency to organization, source and event type.
An explicit key, or a derived external object identity when no key is supplied,
resolves repeated intake to one event/run. Reuse with different payload,
external identity or integration returns 409. No key or external identity means
each intake is a new event. Duplicate processing claims cannot publish a second
result.

Staff ADMIN, MANAGER and REP can inspect a scoped run and its recent activity,
retry a `FAILED` or `RETRY_WAIT` run, or cancel `QUEUED`, `RUNNING` or
`RETRY_WAIT` work. A cancelled run is terminal; cancellation fences a running
owner. Manual retry resets the attempt budget and schedules the same run while
retaining its last error, partial output and activity trail. Checkpoints preserve
completed extraction and per-question outcomes across retry. Operator actions
do not approve, deliver or send externally. Cancelling before the first claim
records the action time as `startedAt` to satisfy the terminal-state database
contract; it does not mean provider processing began.
