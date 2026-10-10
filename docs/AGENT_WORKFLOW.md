# Sellora agents and skills

These are project-local Codex development helpers. They add no agents to the
Sellora application and make no provider calls themselves. Skills describe a
workflow; agents perform assigned work in a separate context.

## Quick start

Open Codex at this repository root. Skills live in `.agents/skills/`, and custom
agents live in `.codex/agents/`. If newly added entries are not visible in the
current session, start a fresh session in this project. No global installation,
plugin, model override or new application dependency is required.

Use these as prompts in Codex, not shell commands:

```text
Use $sellora-packet-runner to resolve the next action from README and the latest
report/plan evidence. Complete one eligible packet, respecting any pending review.
```

```text
Use $sellora-provider-work with $sellora-packet-runner to execute 05A only after
the recorded Part 04 review gate is satisfied. Split it into bounded slices.
```

```text
Use $sellora-verification to verify packet 05A against its acceptance criteria.
Report actual commands/results and unrun checks; do not repair application code.
```

As recorded on October 10, the next action remains Astra review of the 04C.2
repair (`7feefb6`), then 05A after that review passes. Creating these helpers does
not perform the review. Read README for the current pointer in future sessions.

## Helpers

| Name | Responsibility |
| --- | --- |
| `sellora_executor` | Implement an assigned packet/slice with explicit file ownership; return changes and evidence to the lead |
| `sellora_verifier` | Run assigned checks against a stable candidate; report failures without editing source/tests |
| `sellora_reviewer` | Read-only review of committed and dirty changes against acceptance and evidence |
| `$sellora-packet-runner` | Resolve scope/dependencies, execute one packet at a time and prepare the evidence handoff |
| `$sellora-provider-work` | Part 05 transport, cancellation/retries, reservations and usage invariants |
| `$sellora-verification` | Select relevant checks and distinguish source, mocked, SQL, HTTP, browser and live evidence |

Agents inherit the session's model. `sellora_reviewer` is a role, not an Astra
model selection. When the plan requires Astra, select that model in an available
session/tool and record the actual review identity and verdict. A review by a
different model must not be relabelled Astra or close that gate automatically.

## Delegating work

One executor is the default. Request agents explicitly when useful; for example:

```text
Have sellora_reviewer review the 04C.2 repair at 7feefb6 against its parent and
the October 7 repair evidence. Return defects, unsupported claims and missing
tests. Do not change code or begin 05A. Record the actual reviewer model.
```

For implementation, assign `sellora_executor` one packet/slice and exclusive
files. Run `sellora_verifier` after that candidate is stable, then use
`sellora_reviewer` for an independent review. The lead integrates results and
owns report/plan/README updates and local commits. Normally use at most two
focused children; serialize schema, shared DTO, route registration and ledger
changes. Do not run tests against source another agent is still modifying.

The verifier needs workspace-write because builds and disposable test artifacts
write files, but its instructions prohibit source edits. The reviewer has a
read-only sandbox. Tool approvals still apply; agent configuration does not grant
Docker, external-provider or deployment authority.

## Records and portability

Read README first, then local AGENTS.md and the selected plan/report sections.
Latest dated evidence takes precedence over historical snapshots. The existing
EXECUTION_PLAYBOOK.md contains detailed task cards but is currently local and
untracked; this setup does not stage it. AGENTS.md, SELLORA_BUILD_PLAN.md and
PROJECT_REPORT.md remain ignored local operator records. On a fresh checkout,
use tracked README/runbooks for orientation and restore the local task card and
evidence when needed. Missing records cannot be treated as passed acceptance.

The core contract also lives in the tracked skills: preserve unrelated work and
bulkIngest.ts, use deterministic providers and disposable DBs, keep unknown usage
visible, update report → plan → README, commit owned work locally and never push.
Buyer decisions remain distinct from engineering defaults. No helper authorizes
outreach, purchases, deployment or live-provider usage.

Configuration follows the [official Codex custom-agent format](https://developers.openai.com/codex/subagents).
The setup was checked with Python TOML/YAML parsing and the skill-creator
validator. Runtime discovery and delegated agent behavior need a fresh-session
smoke check; format validation is not application acceptance.
