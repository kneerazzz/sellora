# Usage accounting contract

Sellora records expensive work as an organization-owned `UsageTrace` with ordered
`UsageAttempt` rows. A trace is correlated to a server-generated request ID, a
workflow-run ID, or both. Workload reservations control admission; usage traces
describe what actually ran. They are related but deliberately not the same total,
so retries are not hidden inside one reservation estimate.

## Outcomes and measurements

- An attempt row is inserted before provider or local work begins and finalized
  once as succeeded, failed, cancelled, or deadline-exceeded.
- Provider retries are separate attempts. Failed and interrupted attempts retain
  nullable quantities with `UNKNOWN` measurement status; unknown never means zero.
- A successful provider attempt records measured token quantities only when the
  provider supplied the complete validated usage fields. Missing fields remain
  null/unknown.
- Local embedding, reranking, parsing, chunking, and storage quantities are
  engineering estimates in characters or bytes. They are not provider tokens.
- A refusal is a trace outcome. A refusal before any costly dispatch correctly has
  zero attempt rows; a refusal after retrieval retains every attempt already made.
- Trace and attempt finalization is idempotent only for the same outcome. A
  conflicting second completion is rejected.

Historical `AiInteraction` rows predate this contract. Migration backfill creates
an `UNKNOWN` attempt with null quantities and rate version
`legacy-unavailable-v1`; legacy token-looking columns are not promoted to measured
usage.

## Cost categories and rates

Attempts use separate categories: `PROVIDER`, `LOCAL_COMPUTE`, `STORAGE`,
`INFRASTRUCTURE`, `AUTOMATION`, and `HUMAN_SUPPORT`. Provider and local processing
are recorded automatically in current expensive service paths. The ledger service
also accepts explicit entries for infrastructure, automation subscriptions, and
human support when an operator has a real source measurement.

Every trace and attempt snapshots a rate version. The current default is
`unpriced-v1`: currency, rates, and estimated monetary cost remain null. A later
rate table or import must create a new version and currency snapshot rather than
rewriting historical rows. The ledger is not an invoice and must not be used for
customer billing until provider invoices, infrastructure allocation, support-time
policy, currency, and buyer-approved allowances are reconciled.

## Operator controls

`GET /api/v1/usage/summary` is available to ADMIN and MANAGER staff in their own
organization. It shows the rolling engineering-unit allowance, active reservations,
unknown measurements, recent failed/cancelled traces, largest reservations and
recent alert events. `PUT /api/v1/usage/pause` with `{ "paused": true|false }` is
ADMIN-only. The switch is stored in PostgreSQL and checked under the same
organization lock as every reservation. Pausing blocks new expensive work for
JWT, API-key and internal worker paths; admitted in-flight work may finish.
An exhausted allowance also denies work before dispatch. Unknown attempted work
keeps its reservation charged until the rolling period expires. There is no
automatic conversion from unknown provider tokens to a monetary amount.

Allowance denials create a deduplicated `ALLOWANCE_EXHAUSTED` event; pause and
resume create `WORK_PAUSED` and `WORK_RESUMED` events. These are database events,
not delivered notifications. The configured unit allowance remains an engineering
ceiling, not a buyer agreement or a verified invoice.

## Current boundaries

The ledger is organization-scoped and stored in PostgreSQL. It contains provider
and model identifiers, outcomes, elapsed time, quantities, and correlations, but
not prompts, document text, credentials, or response bodies. The operator screen
does not reconcile invoices or deliver alerts. Part 06 still owns worker leases
and crash recovery. No background invoice reconciliation job exists yet.
