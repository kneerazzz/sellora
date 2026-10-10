---
name: sellora-packet-runner
description: Execute a bounded Sellora roadmap packet or continue authorized local repairs, resolving the next eligible task and recording actual acceptance evidence.
---

# Sellora packet runner

Work on one subpacket at a time. A single-packet request ends after its handoff;
an explicit continuation request may cover successive eligible packets. An unnamed
request uses README's current next action and the latest report/plan evidence.
Do not ask the user to choose a packet already identified there. Respect a pending
review gate before implementation; creating agent configuration is not that review.

## Steps

1. Read README.md and AGENTS.md, the selected SELLORA_BUILD_PLAN.md subpacket,
   its docs/EXECUTION_PLAYBOOK.md card, and related PROJECT_REPORT.md evidence.
   Latest dated evidence overrides historical checkpoint text. If local ignored
   records are absent, use README and tracked runbooks for context, but do not
   invent acceptance or bypass a gate whose evidence is unavailable.
2. Inspect the current git diff. Identify what is already changed and leave
   unrelated work alone. Preserve the existing edit in
   apps/server/scripts/bulkIngest.ts.
3. State in a few lines: the one deliverable, its acceptance checks, and what
   is out of scope.
4. Implement the smallest complete change. Do not mix schema redesign, UI
   redesign, and integration work.
5. Follow the card's check profile and docs/DEVELOPMENT.md. Use the owned
   disposable runner for database checks and deterministic providers. Do not run
   bulk-ingest, crawler, operational cleanup or vector-alteration scripts for
   validation. The runner's cleanup of its own disposable resources is expected.
6. Review your own diff for compatibility, failure paths, and
   migration/rollback effects.
7. Update PROJECT_REPORT.md first, then the plan's checkbox/ledger, then README
   when current state changes. Record:
   deliverable, changed areas, checks actually run (exact commands and
   outcomes), unresolved limits, and the next packet. Never present older
   results as fresh.
8. Emit the playbook handoff with base/final commit or exact dirty paths,
   acceptance-to-check mapping and actual review status. Commit only owned work
   locally under the part-boundary policy; never force-add ignored records or
   push. Record scope-changing defects as follow-ups. Continue only within the
   user's execution scope and after required review/dependency gates pass.

## Do not

- Start unrelated or dependency-blocked packets.
- Deploy, call paid providers, or contact anyone.
- Mark a packet VERIFIED unless its acceptance checks passed with dated evidence.

## Delegation

Use one executor by default. When delegation is requested, give each child a
packet, exclusive files/responsibility, check scope and handoff target. Tell it
others share the tree and it must preserve their changes. Keep schema, shared
contracts, route registration and evidence updates serialized. The lead owns
integration, status and commits. Agent availability alone does not request a team.
