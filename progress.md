# CallYourAgent progress

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. Agents can escalate important decisions without freezing unrelated scopes; owners can independently request callbacks for progress/questions/steering; human input is persisted as structured state and consumed only at explicit safe checkpoints rather than pretending to interrupt in-flight model generation.

The repository includes deterministic fake and production CALL-E providers, SQLite persistence, replayable/idempotent call attempts, polling/webhook convergence, branch-scoped blocking, owner decision persistence, durable per-run instruction queues, exact instruction acknowledgement, quiet hours/call budgets, bounded lifecycle recovery, fail-closed ambiguous/stalled handling, privacy-aware audit history, scoped HTTP authentication, a typed TypeScript client, a real stdio MCP adapter, deterministic end-to-end/demo flows, an operator console, a Claude Code host-acceptance runbook, and a single-instance persistent-volume Compose reference deployment.

This run strengthened the accepted-call timeout guarantee through the complete durable lifecycle-worker path. It added deterministic SQLite races for both owner callbacks and blocking owner decisions where a call is already overdue, `LifecycleManager.sweep()` is waiting on provider observation, and a terminal webhook wins before the stale observation returns. The completed terminal state remains authoritative, no false `call_attempt_stalled` transition is emitted, callback steering/owner decisions remain exactly once, and unrelated branch work remains active.

## Exact repo state inspected this run

The run started from `main` HEAD `711b38f9220a731e8d97a131fdf9500342cb2e08`, which recorded the SQLite in-flight provider-create coverage merged in PR #7.

Before any change, inspected the recursive repository tree and current architecture, recent commits, repository issue activity, and pull-request history. There were no open repository issues. PRs #1-#7 were already merged and collectively covered transactional logical call reservation, ambiguous-recovery single-flight, recovery-vs-webhook precedence, stale poll-vs-webhook protection, provider-acceptance stale-timeout semantics, and SQLite coverage for a provider create still in flight past the stale threshold.

Read in full before implementation:

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
- `deploy/README.md`

Also inspected the complete source/test inventory from the recursive tree and the implementation/verification surfaces relevant to the next action, especially:

- `src/lifecycle.ts`, including the escalation/callback sweep, provider reconciliation await boundary, accepted-call timeout, recovery bookkeeping, and lifecycle audit writes;
- `src/store.ts` and `src/sqlite-store.ts`, including the synchronous transaction contract and SQLite-backed maps;
- `tests/lifecycle.test.ts` for ordinary stale/stalled semantics;
- `tests/sqlite-poll-webhook-race.test.ts` for the existing direct-reconciliation poll-vs-webhook races;
- the existing SQLite recovery, reservation, restart, and in-flight-create concurrency tests;
- `package.json` and the repository verification commands.

The audit refined the previously stated target. In the supported single Node control-plane process, the final `markStalledIfOverdue()` state mutation itself is synchronous, so a webhook cannot literally interleave inside that small write after the function begins. The real concurrency boundary is earlier: `LifecycleManager.sweep()` awaits provider `observe()` through reconciliation, a terminal webhook can complete the durable call during that await, and the stale provider observation can then return before the sweep reaches its age check. That is the interleaving exercised this run. It is materially different from inventing a fake multi-threaded race the current topology does not support.

Repository mutation and executable verification used the connected GitHub integration and GitHub Actions. A direct local clone attempt from the automation container again failed because that environment could not resolve `github.com`; this did not block repository work because the connected GitHub integration and all repository Actions workflows were available.

The coherent increment was merged as PR #8, merge commit `0ee57e6f0f62fe4859813c7fc01bbddc212267c3`.

## Changes made this run

### Durable lifecycle stale-sweep vs terminal-webhook regressions

Added `tests/sqlite-lifecycle-webhook-stall-race.test.ts` with two deterministic tests using the real `SqliteControlPlaneStore`, a mutable clock, the real `LifecycleManager`, the real `ControlPlane`, and a gated deterministic fake provider.

#### Owner callback path

The first regression forces this exact sequence:

1. an active run continues unrelated `documentation` work;
2. the owner requests a callback and the provider accepts it, giving the durable attempt a provider call id;
3. time advances beyond `maxInProgressCallAgeMs`, so the accepted call is objectively overdue;
4. `LifecycleManager.sweep()` begins callback reconciliation and is deliberately held inside provider `observe()`;
5. while the poll is in flight, a terminal webhook completes the original callback and queues one durable owner instruction;
6. the stale provider poll is released and returns `in_progress`;
7. the lifecycle sweep resumes and must report zero stale calls;
8. the call must remain `completed`, exactly one steering instruction must exist, and `documentation` must remain the current unrelated scope;
9. the audit timeline must contain exactly one `call_attempt_completed`, zero `call_attempt_stalled`, zero stale `call_attempt_progressed`, and exactly one `owner_instruction_queued` for that call.

#### Blocking owner-decision path

The second regression forces the same lifecycle interleaving for a branch-blocking `release-approval` decision while `documentation` remains the active independent scope:

1. the accepted decision call becomes overdue;
2. lifecycle polling is held in flight;
3. a terminal webhook records the owner's durable answer first;
4. only `release-approval` is released while `documentation` remains the current scope;
5. the stale provider poll is released and returns `in_progress`;
6. the lifecycle sweep must record zero stale calls and preserve the terminal call/escalation state;
7. exactly one `OwnerDecision` remains authoritative;
8. the audit timeline must contain one completion and one owner-decision event, with zero stalled/progressed events for the stale poll.

No production API, HTTP, MCP, SDK, persistence schema, CALL-E adapter, or UI contract changed. The existing post-provider-I/O durable re-read introduced by earlier poll/webhook hardening was already correct; this run extends evidence to the full background lifecycle worker and its subsequent stale-age check rather than adding speculative production complexity.

## Verification performed

PR #8 head `4cf4a5422060670aa0c646580fc479133f66f485` passed every repository verification surface before merge:

- CI run `34374192899` — **success**. Node `24.20.0`, locked dependency install, TypeScript typecheck, build, and **114/114 tests passed** with 0 failures, 0 cancelled, and 0 skipped. Both new SQLite lifecycle/webhook/stall race tests passed.
- Container run `34374192993` — **success**. The production image build and deterministic fake-provider runtime smoke remained green.
- Compose deployment run `34374192944` — **success**. The full reference deployment acceptance remained green, preserving the generated least-privilege credential split, durable SQLite state, authenticated HTTP control plane, real compiled stdio MCP process, branch-specific blocking/release, restart during an active decision call, restart during an active owner callback, exactly-once steering, persistence across another restart, and safe-checkpoint instruction acknowledgement.

`package.json` still has no separate lint script and no standalone migration/schema-check command. `npm run check` covers typechecking/build/tests; SQLite tests execute the durable schema/transaction path; Container and Compose cover the production runtime/deployment path.

The automation container could not independently clone from `github.com` because DNS resolution failed there, so no local test result is claimed. GitHub Actions is the executable verification evidence for this run.

No live CALL-E phone call was attempted or claimed.

## Architecture decisions made this run

1. Terminal provider evidence remains authoritative over a local age threshold when it arrives while lifecycle polling is in flight.
2. The meaningful stale-sweep concurrency boundary is the asynchronous provider observation, not an invented concurrent interleaving inside the synchronous stale-state write of the supported single-process topology.
3. The existing durable re-read after provider I/O is now covered not only by direct `reconcileCallback` / `reconcileEscalation` tests but by the complete `LifecycleManager.sweep()` path followed by its overdue-call check.
4. The accepted-call timeout remains fail-closed: genuinely overdue calls without terminal evidence still become `stalled`; this run does not weaken that safety behavior.
5. Branch-scoped semantics remain explicit in the decision regression: terminal resolution releases only the owner-gated scope and does not disturb independent current work.
6. Provider I/O remains outside SQLite transactions. Correctness is achieved by durable state convergence after I/O rather than holding a DB transaction across a network request.
7. Exactly-once human state remains the invariant: callback completion queues one instruction; decision completion records one owner decision; a stale observation cannot duplicate either.
8. The supported guarantee remains one control-plane process backed by SQLite. These tests do not imply distributed multi-process safety.
9. Deterministic fake-provider evidence remains separate from live CALL-E evidence.

## CALL-E integration status

- **Fake provider:** deterministic, credential-free, idempotent, restart-rehydratable from durable accepted-call state, and now used with SQLite plus the real lifecycle manager to prove terminal webhook precedence even when an accepted call is already past the local stale threshold while provider polling is in flight.
- **Production CALL-E adapter:** implemented against the asynchronous Calls API with server-only `CALLE_API_KEY`, stable `Idempotency-Key`, structured result schemas, bounded create/poll requests, persisted correlation, polling/webhook convergence, duplicate prevention, fail-closed ambiguous/stalled handling, and privacy-safe provider errors. This run did not alter or live-test that adapter.
- **Control-plane concurrency:** callback/decision identities are reserved before provider awaits; ambiguous recovery is single-flight per durable call attempt within the supported process; recovery and ordinary polling re-check durable state after provider I/O; terminal webhook precedence is covered against ambiguous recovery, stale direct reconciliation polls, and now the full overdue lifecycle sweep for both callbacks and decisions.
- **Shared surfaces:** HTTP, TypeScript SDK, stdio MCP, lifecycle worker, operator/deployment paths continue to share one persistent control-plane state machine rather than adapter-specific behavior.
- **Claude Code:** the built stdio MCP process is exercised as a real external child in repository/deployment tests and the host-acceptance runbook remains aligned. An actual Claude Code host session still has not been observed and must not be claimed.
- **Live status:** no authorized real CALL-E phone call has been performed, so live provider connectivity, owner-phone authorization, and public webhook success remain unverified.

## Current blockers / external prerequisites

No repository-development blocker prevents further useful work.

A true Claude Code host acceptance requires an actual Claude Code environment/CLI to register and exercise the built stdio MCP server.

Live CALL-E verification still requires user-controlled prerequisites: a valid/authorized CALL-E credential, an authorized owner phone destination, and stable public HTTPS webhook ingress configured with the application-owned webhook capability token.

The automation container's inability to resolve `github.com` prevented an additional local clone/check during this run, but the connected GitHub integration and all three GitHub Actions workflows remained available and successful, so this was not a repository-development blocker.

## Highest-value next actions

1. Audit lifecycle **state + audit atomicity** on SQLite. `markStalledIfOverdue`, recovery scheduling, and recovery exhaustion currently perform a durable call-attempt write and the matching lifecycle audit write as separate map operations. The next strongest reliability increment is to make each local lifecycle transition atomic through `store.transaction()` and add a deterministic rollback/failure regression, while keeping provider I/O outside the transaction.
2. Add process-restart coverage specifically around the reservation/acceptance boundary if a realistic restart interleaving can be modeled without pretending an in-flight network request survives process death. Recovery must reuse the original logical identity rather than create a replacement call.
3. Document fake-provider `rehydrate` behavior more explicitly in `docs/ARCHITECTURE.md`, separating deterministic local reconstruction from production CALL-E's remotely durable provider identity.
4. Continue auditing model-/operator-facing diagnostics and read projections for accidental task-context, owner-phone, bearer-token, webhook-token, callback-prompt, or instruction disclosure.
5. Continue the `dispatchCallAttempt()` stale-object audit only if a genuinely reachable competing transition is found; do not add speculative state-machine complexity without a reproducible race.
6. Run the documented acceptance in a genuine Claude Code host when that external prerequisite is available and record only observed host/version behavior.
7. When the user-controlled CALL-E prerequisites are available, perform one tightly bounded live provider acceptance and record only observed behavior.
