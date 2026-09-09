# CallYourAgent progress

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. Agents can escalate important decisions without freezing unrelated scopes; owners can independently request callbacks for progress/questions/steering; human input is persisted as structured state and consumed only at explicit safe checkpoints rather than pretending to interrupt in-flight model generation.

The repository includes deterministic fake and production CALL-E providers, SQLite persistence, replayable/idempotent call attempts, polling/webhook convergence, branch-scoped blocking, owner decision persistence, durable per-run instruction queues, exact instruction acknowledgement, quiet hours/call budgets, bounded lifecycle recovery, fail-closed ambiguous/stalled handling, privacy-aware audit history, scoped HTTP authentication, a typed TypeScript client, a real stdio MCP adapter, deterministic end-to-end/demo flows, an operator console, a Claude Code host-acceptance runbook, and a single-instance persistent-volume Compose reference deployment.

This run closed a durability gap in lifecycle bookkeeping. The local lifecycle transitions that mark a call stalled, schedule another bounded ambiguous-call recovery, or mark automatic recovery exhausted now persist the CallAttempt mutation and its matching audit event inside one `store.transaction()` boundary. Provider network I/O remains outside the transaction. Deterministic SQLite failure-injection tests prove that if the matching audit write fails, the CallAttempt mutation rolls back in both SQLite and the in-memory mirror, and the same transition can then succeed exactly once after the injected failure is removed.

## Exact repo state inspected this run

The run started from `main` HEAD `bbe248b8b3ff3746df9bad0ce49afdb54ca6f9b6`, which recorded the accepted-call lifecycle sweep vs terminal-webhook race coverage merged in PR #8.

Before any change, inspected the recursive repository tree and current architecture, recent commits, open repository issues, and open pull requests. There were no open issues or PRs. The recent history showed PRs #1-#8 already merged, covering transactional logical call reservation, ambiguous-recovery single-flight, recovery-vs-webhook precedence, stale poll-vs-webhook protection, provider-acceptance stale-timeout semantics, SQLite coverage for in-flight provider creation, and overdue lifecycle sweep vs terminal webhook races.

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

Also inspected the complete source/test inventory from the recursive repository tree and the implementation surfaces relevant to the selected increment, especially:

- `src/lifecycle.ts` for stale-call, recovery scheduling, recovery exhaustion, and lifecycle audit writes;
- `src/store.ts` for the synchronous transaction contract;
- `src/sqlite-store.ts` for `BEGIN IMMEDIATE`, rollback, and mirror reload semantics;
- `tests/lifecycle.test.ts` and the existing SQLite lifecycle/concurrency/restart tests;
- `package.json` and the repository verification workflow behavior.

The audit confirmed the next reliability gap described by the previous run: `markStalledIfOverdue`, recovery scheduling, and `markRecoveryExhausted` wrote the durable CallAttempt first and the corresponding lifecycle audit event second. On SQLite, a failure between those map operations could leave a state transition without the audit record intended to explain it. This is a local synchronous mutation boundary and therefore can be made atomic without holding a database transaction across provider network I/O.

The coherent implementation was merged as PR #9, merge commit `9f2e99eff19ed9afa058b242ad751421c04795a3`.

## Changes made this run

### Atomic lifecycle state + audit transitions

Updated `src/lifecycle.ts` so these three local lifecycle transitions execute inside `store.transaction()`:

1. accepted call becomes `stalled` + `call_attempt_stalled` audit event;
2. ambiguous recovery receives `automaticRecoveryAttempts` / `nextAutomaticRecoveryAt` + `call_recovery_scheduled` audit event;
3. automatic recovery becomes exhausted + `call_recovery_exhausted` audit event.

The transaction boundary begins only after any provider request/recovery await has completed. No CALL-E/fake-provider network or provider I/O occurs inside the SQLite transaction.

The existing successful-recovery path that updates automatic-recovery bookkeeping without a lifecycle audit event was intentionally left unchanged; there is no matching two-write audit invariant to couple there.

### Deterministic SQLite rollback regressions

Added `tests/sqlite-lifecycle-atomicity.test.ts` with three failure-injection tests against the real `SqliteControlPlaneStore`.

#### Stalled transition rollback

The test creates an accepted callback, advances beyond the stale threshold, injects a failure only when `call_attempt_stalled` is written, and runs the real lifecycle sweep. It proves:

- the sweep reports the injected lifecycle error;
- the CallAttempt rolls back from the attempted `stalled` mutation to `queued`;
- `stalledAt` is absent;
- no `call_attempt_stalled` audit event survives;
- after restoring normal audit writes, the next sweep marks the same call stalled exactly once and records exactly one audit event.

#### Recovery scheduling rollback

The test uses an always-ambiguous provider, lets lifecycle perform the provider recovery attempt outside the transaction, then injects a failure only for `call_recovery_scheduled`. It proves:

- the call remains durably `ambiguous`;
- `automaticRecoveryAttempts` and `nextAutomaticRecoveryAt` from the failed local scheduling transition are rolled back;
- no scheduling audit event survives;
- after removing the injected failure, the next sweep persists attempt number 1, the expected backoff timestamp, and exactly one scheduling audit event;
- provider retries continue to reuse the same logical idempotency identity rather than creating a replacement call.

#### Recovery exhaustion rollback

The test configures zero automatic recovery attempts, injects a failure only for `call_recovery_exhausted`, and proves:

- `automaticRecoveryExhaustedAt` does not survive the failed transition;
- no exhaustion audit event survives;
- after restoring normal writes, the next sweep persists the exhaustion marker and exactly one exhaustion audit event.

## Verification performed

PR #9 substantive head `cce1b64f6e801ea47296be6ff90e86a67cca8d94` passed every repository verification surface before merge:

- CI run `34380273943` — **success**. Node `24.20.0`, locked dependency install, TypeScript typecheck, build, and **117/117 tests passed** with 0 failures, 0 cancelled, and 0 skipped. All three new SQLite lifecycle atomicity regressions passed.
- Container run `34380273996` — **success**. Production image build/runtime smoke remained green.
- Compose deployment run `34380273947` — **success**. The full reference deployment acceptance remained green, preserving generated least-privilege credentials, durable SQLite state, authenticated HTTP control plane, the real compiled stdio MCP process, branch-specific blocking/release, restart during active decision and callback calls, exactly-once steering, persistence across restart, and safe-checkpoint acknowledgement.

`package.json` still has no separate lint script and no standalone migration/schema-check command. `npm run check` covers typechecking/build/tests; SQLite tests execute the durable schema/transaction path; Container and Compose cover the production runtime/deployment path.

No live CALL-E phone call was attempted or claimed.

## Architecture decisions made this run

1. Lifecycle state and the lifecycle audit event that explains that state are one local durability invariant and should commit or roll back together.
2. Provider network I/O must remain outside the database transaction. Atomicity is applied only to the synchronous post-I/O local mutation boundary.
3. SQLite rollback must restore both SQL rows and in-memory mirrors; the regression tests intentionally verify state through the same live store after rollback rather than reopening only from disk.
4. A lifecycle audit failure is treated as a failed local transition rather than silently accepting unaudited state.
5. Retry after a rolled-back local transition remains safe because the logical call identity and provider idempotency state are unchanged.
6. The accepted-call stale timeout remains fail-closed, but a failed audit write cannot leave an unexplained `stalled` state behind.
7. Automatic-recovery scheduling/exhaustion remains bounded and durable, but scheduling metadata is not allowed to outlive its corresponding audit event.
8. Existing branch/scope semantics, owner-decision exactly-once semantics, callback steering exactly-once semantics, and safe-checkpoint consumption are unchanged.
9. The supported durable topology remains one control-plane process backed by SQLite; this work does not claim multi-instance/distributed transaction safety.
10. Fake-provider verification remains separate from live CALL-E evidence.

## CALL-E integration status

- **Fake provider:** deterministic, credential-free, idempotent, restart-rehydratable from durable accepted-call state, and exercised across the full control-plane/lifecycle/SQLite test suite.
- **Production CALL-E adapter:** implemented against the asynchronous Calls API with server-only `CALLE_API_KEY`, stable `Idempotency-Key`, structured result schemas, bounded create/poll requests, persisted correlation, polling/webhook convergence, duplicate prevention, fail-closed ambiguous/stalled handling, and privacy-safe provider errors. This run did not alter or live-test that adapter.
- **Control-plane concurrency/durability:** logical callback/decision call identities are reserved before provider awaits; ambiguous recovery is single-flight per durable call attempt within the supported process; recovery and ordinary polling re-check durable state after provider I/O; terminal webhook precedence is covered against ambiguous recovery, stale direct polls, and overdue lifecycle sweeps; local stalled/schedule/exhausted state is now transactionally coupled to its audit event.
- **Shared surfaces:** HTTP, TypeScript SDK, stdio MCP, lifecycle worker, operator/deployment paths continue to share one persistent control-plane state machine rather than adapter-specific behavior.
- **Claude Code:** the built stdio MCP process is exercised as a real external child in repository/deployment tests and the host-acceptance runbook remains aligned. An actual Claude Code host session still has not been observed and must not be claimed.
- **Live status:** no authorized real CALL-E phone call has been performed, so live provider connectivity, owner-phone authorization, and public webhook success remain unverified.

## Current blockers / external prerequisites

No repository-development blocker prevents further useful work.

A true Claude Code host acceptance requires an actual Claude Code environment/CLI to register and exercise the built stdio MCP server.

Live CALL-E verification still requires user-controlled prerequisites: a valid/authorized CALL-E credential, an authorized owner phone destination, and stable public HTTPS webhook ingress configured with the application-owned webhook capability token.

## Highest-value next actions

1. Audit the **successful ambiguous-recovery bookkeeping** path. When provider recovery returns a non-ambiguous attempt, lifecycle currently applies automatic-recovery attempt metadata in a separate local write after `recoverCallAttempt()` has already persisted the provider-state transition. Determine whether restart between those writes can produce incorrect retry accounting or merely conservative bookkeeping; add a regression only if a real correctness issue is reproducible.
2. Add process-restart coverage around recovery scheduling/exhaustion so the newly atomic state+audit pair is explicitly shown to survive close/reopen together.
3. Document fake-provider `rehydrate` behavior more explicitly in `docs/ARCHITECTURE.md`, separating deterministic local reconstruction from production CALL-E's remotely durable provider identity.
4. Continue auditing operator/model-facing diagnostics and read projections for accidental task-context, owner-phone, bearer-token, webhook-token, callback-prompt, or instruction disclosure.
5. Continue the `dispatchCallAttempt()` stale-object audit only if a genuinely reachable competing transition is found; do not add speculative state-machine complexity without a reproducible race.
6. Run the documented acceptance in a genuine Claude Code host when that external prerequisite is available and record only observed host/version behavior.
7. When the user-controlled CALL-E prerequisites are available, perform one tightly bounded live provider acceptance and record only observed behavior.
