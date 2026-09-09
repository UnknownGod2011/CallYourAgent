# CallYourAgent progress

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. Agents can escalate important decisions without freezing unrelated scopes; owners can independently request callbacks for progress/questions/steering; human input is persisted as structured state and consumed only at explicit safe checkpoints rather than pretending to interrupt in-flight model generation.

The repository includes deterministic fake and production CALL-E providers, SQLite persistence, replayable/idempotent call attempts, polling/webhook convergence, branch-scoped blocking, owner decision persistence, durable per-run instruction queues, exact instruction acknowledgement, quiet hours/call budgets, bounded lifecycle recovery, fail-closed ambiguous/stalled handling, privacy-aware audit history, scoped HTTP authentication, a typed TypeScript client, a real stdio MCP adapter, deterministic end-to-end/demo flows, an operator console, a Claude Code host-acceptance runbook, and a single-instance persistent-volume Compose reference deployment.

This run fixed a real polling terminal-outcome atomicity gap. Terminal CALL-E/fake-provider evidence returned by direct or lifecycle polling used the shared `applyTerminalOutcome()` domain transition, but unlike webhook delivery it was not wrapped in a store transaction. A local failure while creating callback steering, an owner decision, or the corresponding audit event could therefore leave a durable `CallAttempt` terminal while the human state that justified that terminal transition was missing. Terminal polling now enters the synchronous store transaction only after provider observation returns, so call state, owner decisions/instructions, escalation release/failure, and their audits commit or roll back together. Provider network I/O remains outside SQLite transactions.

## Exact repo state inspected this run

The run started from `main` HEAD `3aa247a53b6bddc55b068bd2c9e666ffd3cc52dd`, immediately after the provider-identity/audit-failure hardening from PR #11.

Before making any change, inspected the complete recursive repository tree (`truncated: false`), current source/test architecture, recent commits, relevant issues, and pull requests. There were no open issues. Prior PRs #1-#11 covered local call reservation, ambiguous-recovery single-flight, recovery/webhook precedence, stale poll/webhook protection, provider-acceptance timeout semantics, SQLite in-flight provider-create coverage, lifecycle stale-sweep races, lifecycle state/audit atomicity, recovery restart guarantees, and accepted-provider identity preservation across local audit failure.

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

Also inspected the full `src/control-plane.ts`, `src/call-provider.ts`, `src/store.ts`, `src/sqlite-store.ts`, the existing SQLite lifecycle atomicity tests, recent race/recovery tests, and the CI/Container/Compose verification setup. The audit confirmed that webhook terminal reconciliation was already transactional while direct/lifecycle polling was the remaining local terminal-application gap.

## Changes made this run

### Polled terminal state and human state now commit atomically

Changed the terminal branches of both polling entry points:

- `reconcileEscalation()`
- `reconcileCallback()`

Provider rehydration and `CallProvider.observe()` still happen before the transaction. Only the synchronous application of a returned terminal observation is wrapped in `store.transaction(() => applyTerminalOutcome(...))`.

This deliberately aligns polling with the already-transactional webhook domain semantics without holding SQLite locks across CALL-E/fake-provider network or provider-local work.

### Deterministic SQLite failure-injection regressions

Added `tests/sqlite-poll-terminal-atomicity.test.ts` with two regressions.

1. **Callback terminal poll + steering persistence failure**
   - a fake callback reaches provider-completed state with one owner instruction;
   - `owner_instruction_queued` audit persistence is deliberately failed;
   - reconciliation rejects;
   - SQLite rollback restores the call to non-terminal `queued`, leaves zero queued instructions, and leaves zero terminal/instruction audit events;
   - retrying the same provider observation completes the same call exactly once and queues exactly one instruction.

2. **Blocking decision terminal poll + owner-decision audit failure**
   - a blocking `release-approval` escalation receives a completed owner decision from the provider;
   - `owner_decision_recorded` audit persistence is deliberately failed;
   - reconciliation rejects;
   - SQLite rollback restores the call to `queued`, leaves the escalation `calling`, creates no durable decision, and keeps only `release-approval` blocked while unrelated `documentation` work remains independent;
   - retrying the same provider observation resolves the same escalation exactly once, creates one decision, and releases the blocked scope.

The substantive PR diff remained intentionally small: two transaction wrappers in production code plus the focused regression file.

## Verification performed

The final PR #12 head `bd042c689d14d3cfecff63006a9bb3d8143a3af8` passed every repository verification surface before merge:

- CI run `34398729646` — **success**. GitHub Actions used Node `24.20.0`, installed locked dependencies, completed TypeScript typecheck and build, and passed **124/124 tests** with 0 failures, 0 cancelled, and 0 skipped. Both new SQLite polling-terminal rollback/retry regressions passed.
- Container run `34398729632` — **success**. The production image build/runtime smoke remained green.
- Compose deployment run `34398729672` — **success**. The reference deployment acceptance remained green, preserving generated least-privilege credentials, authenticated HTTP state, compiled stdio MCP integration, durable SQLite restart behavior, branch-specific owner-decision release, owner-callback restart/recovery, exactly-once steering, and safe-checkpoint instruction consumption.

PR #12 was squash-merged to `main` as `26ab9d6ff402971d525b836d7c9597bd790a245d`.

`package.json` still has no separate lint script and no standalone migration/schema-check command. `npm run check` covers typechecking/build/tests; SQLite tests execute the durable schema/transaction path; Container and Compose cover production runtime/deployment behavior.

No live CALL-E phone call was attempted or claimed.

## Architecture decisions made this run

1. Terminal provider evidence must have one domain-level atomicity guarantee regardless of delivery mechanism: webhook and polling both commit call state plus dependent human state together.
2. Provider I/O remains outside SQLite transactions. The transaction begins only after a terminal observation has already been returned.
3. A failed local callback-instruction/decision/audit mutation must not strand a durable terminal call with missing human state. Rollback returns the local attempt to its prior observable state so the same remote terminal evidence can be safely retried.
4. Branch-scoped blocking is released only when the owner-decision transaction commits. A failed terminal application cannot accidentally unblock the affected scope.
5. The shared `applyTerminalOutcome()` state machine remains the single business transition for polling and webhooks; no adapter-specific terminal logic was introduced.
6. Existing provider-side/local idempotency, ambiguous-create recovery, stale-poll precedence, and safe-checkpoint semantics remain unchanged.
7. The supported durable topology remains one control-plane process backed by SQLite; this work does not claim multi-instance/distributed transaction safety.
8. Fake-provider evidence remains separate from live CALL-E evidence.

## CALL-E integration status

- **Fake provider:** deterministic, credential-free, idempotent, restart-rehydratable from durable accepted-call state, and now explicitly exercises rollback/retry of terminal provider evidence when downstream owner-state persistence fails.
- **Production CALL-E adapter:** implemented against the asynchronous Calls API with server-only `CALLE_API_KEY`, stable `Idempotency-Key`, structured result schemas, bounded create/poll requests, persisted correlation, polling/webhook convergence, duplicate prevention, fail-closed ambiguous/stalled handling, and privacy-safe provider errors. This run changed provider-independent control-plane transaction boundaries, not the adapter or wire contract.
- **Control-plane concurrency/durability:** callback/decision identities are reserved before provider awaits; accepted provider identities survive local started-audit failures; ambiguous recovery is single-flight within the supported process; polling/recovery re-check durable state after provider I/O; terminal webhook precedence is covered against stale/recovery races; and terminal polling now atomically persists the terminal call with the corresponding owner decision or callback steering.
- **Shared surfaces:** HTTP, TypeScript SDK, stdio MCP, lifecycle worker, operator/deployment paths continue to share the same persistent control-plane state machine.
- **Claude Code:** the compiled stdio MCP child remains covered in repository/deployment tests and the host-acceptance runbook remains valid. A real Claude Code host session still has not been observed and is not claimed.
- **Live status:** no authorized real CALL-E phone call has been performed, so live provider connectivity, owner-phone authorization, and public webhook success remain unverified.

## Current blockers / external prerequisites

No repository-development blocker prevents further useful work.

A true Claude Code host acceptance requires an actual Claude Code environment/CLI to register and exercise the compiled stdio MCP server.

Live CALL-E verification still requires user-controlled prerequisites: a valid/authorized CALL-E credential, an authorized owner phone destination, and stable public HTTPS webhook ingress configured with the application-owned webhook capability token.

## Highest-value next actions

1. Audit `applyActiveObservation()` state + audit atomicity under SQLite failure injection. It currently persists the `queued -> in_progress` call mutation and then records `call_attempt_progressed`; because this transition has no new external side effect, rolling the state back with the audit on local failure may be the cleanest invariant if a split durable state is reproducible.
2. Add explicit architecture documentation distinguishing deterministic fake-provider `rehydrate()` reconstruction from production CALL-E's remotely durable provider state so restart behavior cannot be misinterpreted as a production-provider requirement.
3. Continue operator/model-facing privacy audits for accidental task-context, owner-phone, bearer-token, webhook-token, callback-prompt, or instruction disclosure.
4. Run the documented acceptance in a genuine Claude Code host when that external prerequisite is available and record only observed host/version behavior.
5. When the user-controlled CALL-E prerequisites are available, perform one tightly bounded live provider acceptance and record only observed behavior.
