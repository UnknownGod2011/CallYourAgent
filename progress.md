# CallYourAgent progress

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. Agents can escalate important decisions without freezing unrelated scopes; owners can independently request callbacks for progress/questions/steering; human input is persisted as structured state and consumed only at explicit safe checkpoints rather than pretending to interrupt in-flight model generation.

The repository includes deterministic fake and production CALL-E providers, SQLite persistence, replayable/idempotent call attempts, polling/webhook convergence, branch-scoped blocking, owner decision persistence, durable per-run instruction queues, exact instruction acknowledgement, quiet hours/call budgets, bounded lifecycle recovery, fail-closed ambiguous/stalled handling, privacy-aware audit history, scoped HTTP authentication, a typed TypeScript client, a real stdio MCP adapter, deterministic end-to-end/demo flows, an operator console, a Claude Code host-acceptance runbook, and a single-instance persistent-volume Compose reference deployment.

This run fixed a real active-provider-observation atomicity gap. A genuine provider `queued -> in_progress` observation previously persisted the new `CallAttempt` state and then separately recorded `call_attempt_progressed`. If local audit persistence failed, SQLite could retain `in_progress` without the corresponding causal audit event. Active polling now applies the synchronous state transition and its audit in one store transaction after provider observation returns. Provider rehydration and `CallProvider.observe()` remain outside SQLite transactions.

## Exact repo state inspected this run

The run started from `main` HEAD `d4020748a47c21a7ae998d36187ae92fee32056b`, immediately after PR #12's polled-terminal atomicity hardening and its progress update.

Before implementation, inspected the complete recursive repository tree (`truncated: false`) and current architecture, recent commits, issues, and pull requests. There were no open issues. Prior PRs #1-#12 covered local call reservation, ambiguous-recovery single-flight, recovery/webhook precedence, stale poll/webhook protection, provider-acceptance timeout semantics, durable in-flight provider-create coverage, lifecycle stale-sweep races, lifecycle state/audit atomicity, recovery restart guarantees, accepted-provider identity preservation across local audit failure, and atomic application of terminal polling outcomes.

Read in full for this run:

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

Also inspected the relevant `src/control-plane.ts`, `src/call-provider.ts`, `src/sqlite-store.ts`, existing SQLite lifecycle atomicity tests, provider-observation tests, and the CI/Container/Compose verification setup. The audit reproduced the remaining local split: `applyActiveObservation()` wrote the call state first and its `call_attempt_progressed` audit second, while its polling callers did not provide a transaction boundary.

## Changes made this run

### Active provider progress and audit now commit atomically

Changed the active-observation branches of both provider polling entry points:

- `reconcileEscalation()`
- `reconcileCallback()`

Both now apply `applyActiveObservation(...)` through `store.transaction(...)`. Provider rehydration and `CallProvider.observe()` still complete before the transaction begins. Only the synchronous durable state/audit transition is transactional.

No state-machine rewrite was introduced. Existing semantics remain unchanged:

- only a real `queued -> in_progress` forward transition is persisted;
- repeated `in_progress` observations remain no-ops and do not refresh `updatedAt`;
- stale `queued` observations cannot downgrade `in_progress`;
- terminal polling and webhooks continue to use the shared terminal transition;
- no phone-provider side effect occurs inside the transaction.

### Deterministic SQLite failure-injection regressions

Added `tests/sqlite-active-observation-atomicity.test.ts` with two regressions.

1. **Owner callback progress**
   - create one durable queued callback through the normal fake-provider path;
   - move the provider-side call to `in_progress`;
   - deliberately fail persistence of `call_attempt_progressed`;
   - reconciliation rejects and SQLite rolls the call back to `queued` with zero progress audit events;
   - retrying the same provider evidence advances the same call to `in_progress` exactly once;
   - another identical poll remains a no-op and does not duplicate the audit event.

2. **Branch-blocking owner decision progress**
   - create a blocking `release-approval` escalation while the run continues `documentation` work;
   - move the provider-side decision call to `in_progress`;
   - deliberately fail persistence of `call_attempt_progressed`;
   - reconciliation rejects and rolls the call back to `queued` with zero progress audit events;
   - the escalation remains `calling`, only `release-approval` remains blocked, and unrelated `documentation` work remains current;
   - retrying advances the same call to `in_progress` exactly once without changing branch-scoped blocking semantics;
   - a repeated identical poll does not add another progress event.

The PR diff is intentionally narrow: two transaction wrappers plus the focused SQLite regression file.

## Verification performed

The substantive PR #13 head `15c3c919cbdc20ddabdc5eaf9bada079f8265a72` passed every repository verification surface:

- CI run `34404690565` — **success**. GitHub Actions used Node `24.20.0`, installed locked dependencies, completed TypeScript typecheck and build, and passed **126/126 tests** with 0 failures, 0 cancelled, and 0 skipped. Both new active-observation rollback/retry regressions passed.
- Container run `34404690617` — **success**. The production image build/runtime smoke remained green.
- Compose deployment run `34404690587` — **success**. The full reference acceptance remained green, including generated scoped credentials, authenticated HTTP state, the compiled stdio MCP integration, durable SQLite restart during an active owner decision, release of only the blocked branch, restart during an active owner callback, exactly-once steering, another persistence restart, and safe-checkpoint steering consumption.

`package.json` still has no separate lint script and no standalone migration/schema-check command. `npm run check` covers typechecking/build/tests; SQLite tests execute the durable schema/transaction path; Container and Compose cover production runtime/deployment behavior.

No live CALL-E phone call was attempted or claimed.

## Architecture decisions made this run

1. A meaningful active-provider transition and its matching causal audit event are one local durability unit. SQLite must not persist one without the other.
2. Provider/network I/O remains outside SQLite transactions. Transactional atomicity begins only after `observe()` returns a typed active observation.
3. On a local audit/storage failure, rolling `in_progress` back to the prior `queued` state is safe because no new external provider side effect is being created; the same remote observation can be retried.
4. Existing monotonic active-state semantics remain authoritative: repeated active evidence cannot refresh stale-call age indefinitely, and stale queued evidence cannot downgrade an in-progress call.
5. Branch-scoped blocking remains independent from phone progress bookkeeping. A failed local progress transaction neither releases nor broadens a blocked scope.
6. The supported durable topology remains one control-plane process backed by SQLite; this does not claim multi-instance/distributed transaction safety.
7. Fake-provider evidence remains separate from live CALL-E evidence.

## CALL-E integration status

- **Fake provider:** deterministic, credential-free, idempotent, restart-rehydratable from durable accepted-call state, and now explicitly covers rollback/retry of active provider progress when audit persistence fails.
- **Production CALL-E adapter:** implemented against the asynchronous Calls API with server-only `CALLE_API_KEY`, stable `Idempotency-Key`, structured result schemas, bounded create/poll requests, persisted correlation, polling/webhook convergence, duplicate prevention, fail-closed ambiguous/stalled handling, and privacy-safe provider errors. This run changed provider-independent local transaction boundaries only; the CALL-E wire contract was not changed.
- **Control-plane concurrency/durability:** callback/decision identities are reserved before provider awaits; accepted provider identities survive local started-audit failures; ambiguous recovery is single-flight within the supported process; polling/recovery re-check durable state after provider I/O; terminal webhook precedence is covered against stale/recovery races; terminal polling atomically persists terminal call plus owner state; and active polling now atomically persists genuine forward progress plus its audit.
- **Shared surfaces:** HTTP, TypeScript SDK, stdio MCP, lifecycle worker, operator/deployment paths continue to share the same persistent control-plane state machine.
- **Claude Code:** the compiled stdio MCP child remains covered by repository/deployment tests and the host-acceptance runbook remains valid. A real Claude Code host session still has not been observed and is not claimed.
- **Live status:** no authorized real CALL-E phone call has been performed, so live provider connectivity, owner-phone authorization, and public webhook success remain unverified.

## Current blockers / external prerequisites

No repository-development blocker prevents further useful work.

A true Claude Code host acceptance requires an actual Claude Code environment/CLI to register and exercise the compiled stdio MCP server.

Live CALL-E verification still requires user-controlled prerequisites: a valid/authorized CALL-E credential, an authorized owner phone destination, and stable public HTTPS webhook ingress configured with the application-owned webhook capability token.

## Highest-value next actions

1. Audit local escalation lifecycle transitions that still pair a state mutation with a separate audit write, especially expiry and policy deferral/release, and add SQLite rollback coverage only where a real split durable state is reproducible.
2. Add explicit architecture documentation distinguishing deterministic fake-provider `rehydrate()` reconstruction from production CALL-E's remotely durable provider state so restart behavior cannot be misinterpreted as a production-provider requirement.
3. Continue operator/model-facing privacy audits for accidental task-context, owner-phone, bearer-token, webhook-token, callback-prompt, or instruction disclosure.
4. Run the documented acceptance in a genuine Claude Code host when that external prerequisite is available and record only observed host/version behavior.
5. When the user-controlled CALL-E prerequisites are available, perform one tightly bounded live provider acceptance and record only observed behavior.
