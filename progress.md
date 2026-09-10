# CallYourAgent progress

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. Agents can escalate important decisions without freezing unrelated scopes; owners can independently request callbacks for progress/questions/steering; human input is persisted as structured state and consumed only at explicit safe checkpoints rather than pretending to interrupt in-flight model generation.

The repository includes deterministic fake and production CALL-E providers, SQLite persistence, replayable/idempotent call attempts, polling/webhook convergence, branch-scoped blocking, owner decision persistence, durable per-run instruction queues, exact instruction acknowledgement, quiet hours/call budgets, bounded lifecycle recovery, fail-closed ambiguous/stalled handling, privacy-aware audit history, scoped HTTP authentication, a typed TypeScript client, a real stdio MCP adapter, deterministic end-to-end/demo flows, an operator console, a Claude Code host-acceptance runbook, and a single-instance persistent-volume Compose reference deployment.

This run audited the multi-instruction safe-checkpoint acknowledgement boundary under deterministic SQLite failure injection. The production implementation already had the correct architecture: the full acknowledgement batch runs inside one store transaction. A failure while persisting the second instruction's causal audit event rolls back every instruction mutation and every consumption audit from that batch, including the in-memory mirrors; after SQLite close/reopen the entire batch is still queued. Retrying then consumes each exact instruction once, and later acknowledgement retries remain idempotent. No unnecessary production state-machine change was made.

## Exact repo state inspected this run

The run started from `main` HEAD `63e672b8a4b06910c635abb88ac161995c3ea5b2`, immediately after PR #19 and its progress handoff documented the provider-reentry dispatch invariant.

Before changing code, inspected the complete recursive repository tree through GitHub's recursive tree API. It reported `truncated: false` and covered the root, `.github/workflows`, `deploy`, all `docs`, all `src`, and all `tests` files. Inspected the recent commit chain through PR #19. There were no open issues and no open pull requests before this run.

Read in full before changing code:

- `AGENTS.md`
- `progress.md`
- `README.md`
- `docs/ARCHITECTURE.md`
- `docs/INTEGRATIONS.md`
- `docs/API_SECURITY.md`
- `docs/CALL_POLICY.md`
- `docs/CLAUDE_CODE_ACCEPTANCE.md`
- `docs/DEPLOYMENT.md`
- `docs/OPERATOR_CONSOLE.md`
- `docs/PROVIDER_RESTART_SEMANTICS.md`

Also inspected the relevant implementation and test surfaces, especially `src/control-plane.ts`, `src/sqlite-store.ts`, `tests/instruction-acknowledgement.test.ts`, and `tests/sqlite-core-state-audit-atomicity.test.ts`.

The audit confirmed `ControlPlane.acknowledgeInstructions` validates the requested instruction ids before mutation, then executes status updates plus `owner_instruction_consumed` audit writes inside one `store.transaction(...)`. `SqliteControlPlaneStore.transaction` uses `BEGIN IMMEDIATE`/`COMMIT`; on any failure it executes `ROLLBACK` and reloads every SQLite-backed map/set, preventing committed SQL and in-memory state from diverging.

## Changes made this run

PR #20, `Test multi-instruction acknowledgement atomicity`, added `tests/sqlite-instruction-batch-atomicity.test.ts`.

The deterministic regression creates three queued owner instructions for one run, injects a failure on the second `owner_instruction_consumed` audit write, and proves:

- the acknowledgement call fails rather than reporting partial success;
- all three instructions remain `queued`;
- zero `owner_instruction_consumed` events survive the failed transaction;
- the next non-consuming checkpoint returns the full original batch;
- closing and reopening SQLite preserves that fully rolled-back state;
- retrying acknowledgement consumes all three instructions successfully;
- each instruction receives exactly one durable consumption audit event;
- a later retry, even with reordered ids, creates no duplicate consumption events;
- no instruction remains queued after the successful acknowledgement.

### Production behavior intentionally unchanged

No production lock, schema change, API change, or acknowledgement-state rewrite was added. Failure injection demonstrated that the existing transaction boundary already provides the required all-or-nothing semantics. Adding more machinery would increase complexity without fixing a reproduced bug.

## Verification performed

Direct repository execution in the automation container remains unavailable, so verification used the repository's GitHub Actions surfaces.

PR #20 head `ff3a5eb85d893f261ec0d83f63a0235333459c61` passed the full repository verification path:

- CI run `34435437889` — **success** on Node `24.20.0`; `npm run check` completed typechecking, build, and the Node test suite with **141 tests, 141 passed, 0 failed, 0 cancelled, 0 skipped, 0 todo**. The new SQLite batch-rollback/retry regression passed explicitly.
- Container run `34435437950` — **success**; production image build and fake-provider runtime smoke test passed.
- Compose deployment run `34435437954` — **success**; generated least-privilege credentials, Compose validation, fake-provider deployment, health/readiness, compiled stdio MCP, durable branch-blocking owner decision across restart, branch-specific release, owner callback across restart, exactly-once steering, another persistence restart, and safe-checkpoint steering consumption all passed.

PR #20 was squash-merged into `main` as `b364e2f57afc0883a73decf7ac054ea82c1fcf91`.

`package.json` still has no separate lint script and no standalone migration/schema-check command. `npm run check` covers typechecking, build, and tests; SQLite tests exercise the durable schema and transaction path; Container and Compose exercise the production image/runtime/deployment behavior.

No live CALL-E phone call was attempted or claimed.

## Architecture decisions made this run

1. Multi-instruction acknowledgement is one local durability unit. If any instruction-state or causal-audit write fails, none of the batch may be considered consumed.
2. Safe-checkpoint semantics remain exact: a failed acknowledgement leaves the entire batch available for a later checkpoint/retry instead of partially hiding owner steering from the agent.
3. SQLite rollback must restore both durable rows and the synchronous in-memory mirrors. The new close/reopen assertion makes the durable side of that invariant executable as well.
4. Repeated acknowledgement remains idempotent at the instruction level and must never duplicate `owner_instruction_consumed` history.
5. Do not change production logic merely because a boundary is important; change it only when failure injection or concurrency testing demonstrates a real incorrect state. Here the existing transaction was correct.
6. This path performs no provider/CALL-E network I/O, and the change does not alter branch-scoped blocking or the rule that human steering is consumed only at safe checkpoints.

## CALL-E integration status

- **Fake provider:** deterministic, credential-free, idempotent, restart-rehydratable from durable accepted-call state, and still the primary full-flow development/acceptance provider.
- **Production CALL-E adapter:** remains implemented against the asynchronous Calls API with server-only `CALLE_API_KEY`, stable `Idempotency-Key`, structured result schemas, bounded create/poll requests, persisted correlation, polling/webhook convergence, duplicate prevention, restart-by-provider-id semantics, and fail-closed ambiguous/stalled handling. This run did not alter provider behavior.
- **Shared surfaces:** HTTP, TypeScript SDK, stdio MCP, lifecycle worker, operator console, and deployment flows continue to share the same persistent control-plane state machine.
- **Claude Code:** compiled stdio MCP behavior remains covered by automated and Compose acceptance. A genuine Claude Code host session has still not been observed and is not claimed.
- **Live status:** no authorized real CALL-E phone call has been performed, so live provider connectivity, owner-phone authorization, and public webhook success remain unverified.

## Current blockers / external prerequisites

No repository-development blocker prevents further useful work.

A true Claude Code host acceptance requires an actual Claude Code environment/CLI to register and exercise the compiled stdio MCP server.

Live CALL-E verification still requires user-controlled prerequisites: a valid/authorized CALL-E credential, an authorized owner phone destination, and stable public HTTPS webhook ingress configured with the application-owned webhook capability token.

## Highest-value next actions

1. Audit provider/result/error and operator-visible surfaces for accidental disclosure of task context, callback prompt, owner decision answer, owner instruction text, owner phone number, API credential, or webhook capability token. Add deterministic regressions for any privacy boundary that is not already executable.
2. Review shutdown/lifecycle overlap around provider polling and callback/decision reconciliation for same-attempt concurrent observe/apply paths not already covered by webhook/poll race tests; alter production synchronization only for a reproduced divergence.
3. Continue auditing remaining local state/audit boundaries only where a plausible partial-write failure can still exist, avoiding speculative transaction rewrites.
4. Run the documented acceptance in a genuine Claude Code host when that external prerequisite is available and record only observed host/version behavior.
5. When the user-controlled CALL-E prerequisites are available, perform one tightly bounded live provider acceptance and record only observed behavior.
