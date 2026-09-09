# CallYourAgent progress

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. Agents can escalate important decisions without freezing unrelated scopes; owners can independently request callbacks for progress/questions/steering; human input is persisted as structured state and consumed only at explicit safe checkpoints rather than pretending to interrupt in-flight model generation.

The repository includes deterministic fake and production CALL-E providers, SQLite persistence, replayable/idempotent call attempts, polling/webhook convergence, branch-scoped blocking, owner decision persistence, durable per-run instruction queues, exact instruction acknowledgement, quiet hours/call budgets, bounded lifecycle recovery, fail-closed ambiguous/stalled handling, privacy-aware audit history, scoped HTTP authentication, a typed TypeScript client, a real stdio MCP adapter, deterministic end-to-end/demo flows, an operator console, a Claude Code host-acceptance runbook, and a single-instance persistent-volume Compose reference deployment.

This run audited the previously flagged successful ambiguous-recovery bookkeeping boundary and found no reproducible correctness failure that justified a production rewrite. Once `recoverCallAttempt()` successfully persists a non-ambiguous provider state with a durable `providerCallId`, a restart no longer treats that call as ambiguous, so lifecycle reconciliation rehydrates/polls the existing call rather than replaying provider create merely because `automaticRecoveryAttempts` was not yet updated. A new deterministic SQLite restart regression now proves that exact crash boundary. Two additional restart tests prove that the newly atomic recovery-scheduled and recovery-exhausted state/audit pairs survive close/reopen together.

## Exact repo state inspected this run

The run started from `main` HEAD `205ddf4b3e482e191abdcddd82fdce5559d19c4b`, which recorded the lifecycle state/audit atomicity hardening merged in PR #9.

Before any change, inspected the recursive repository tree/current architecture, recent commits, open issues, and open pull requests. There were no open issues or PRs at the start of the run. Recent history showed PRs #1-#9 already merged, covering transactional logical call reservation, ambiguous-recovery single-flight, recovery-vs-webhook precedence, stale poll-vs-webhook protection, provider-acceptance stale-timeout semantics, SQLite in-flight provider-create coverage, overdue lifecycle sweep vs terminal webhook races, and atomic lifecycle state/audit writes.

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

Also inspected the source/test inventory and the implementation surfaces relevant to the selected increment, especially:

- `src/lifecycle.ts` for ambiguous recovery scheduling/exhaustion and successful-recovery bookkeeping;
- `src/control-plane.ts` for `recoverCallAttempt`, provider rehydration, reconciliation, durable state re-reads, and the no-replay semantics once provider identity is durable;
- `src/call-provider.ts` for deterministic fake-provider identity and `rehydrate` behavior;
- `tests/sqlite-lifecycle-atomicity.test.ts` and existing restart/concurrency/provider tests;
- `package.json` and the repository verification workflow behavior.

Direct unauthenticated cloning from the automation container was unavailable because that runtime could not resolve `github.com`; repository inspection, writes, PR creation, CI inspection, and merge operations therefore used the authenticated GitHub integration instead. This did not prevent repository progress or external CI verification.

## Changes made this run

### Successful ambiguous-recovery crash-boundary regression

Added a deterministic SQLite restart test in `tests/sqlite-lifecycle-restart.test.ts` that reproduces the exact bookkeeping boundary flagged by the prior run:

1. a callback create becomes `ambiguous`;
2. `recoverCallAttempt()` retries the exact same logical create and successfully persists `providerCallId` + `queued` state;
3. no lifecycle `automaticRecoveryAttempts` bookkeeping is written, simulating process exit at that exact boundary;
4. SQLite is closed and reopened with a fresh fake-provider process;
5. lifecycle sweep runs against the restarted control plane.

The restarted provider is deliberately implemented so any call to `start()` fails the test. The test proves:

- the recovered call remains non-ambiguous with the same durable provider id after reopen;
- lifecycle reports zero new recoveries attempted;
- provider `start()` is called zero times after restart;
- fake-provider `rehydrate` plus ordinary observation handles the existing call;
- missing automatic-recovery bookkeeping at this successful boundary is conservative metadata loss, not duplicate-call risk.

This evidence is why no production state-machine rewrite was added.

### Restart durability for recovery scheduling

Added a SQLite close/reopen regression that creates an ambiguous owner-decision call, lets lifecycle perform one bounded recovery attempt, persists `automaticRecoveryAttempts=1` and `nextAutomaticRecoveryAt` together with one `call_recovery_scheduled` audit event, then reopens the database.

The test proves the scheduling metadata and matching audit event survive restart together exactly once.

### Restart durability for recovery exhaustion

Added a SQLite close/reopen regression with `maxAutomaticRecoveryAttempts=0`. Lifecycle marks the ambiguous call exhausted and writes one `call_recovery_exhausted` audit event; after reopening SQLite, the exact `automaticRecoveryExhaustedAt` marker and the audit event are both still present.

This complements the prior rollback/failure-injection tests by proving both sides of the invariant: state + audit roll back together on failure and survive restart together on success.

## Verification performed

The substantive PR #10 head `74e772afe29afd160fe7fe4804879823b4db6df3` passed every repository verification surface:

- CI run `34386979395` — **success**. GitHub Actions used Node `24.20.0`, installed locked dependencies, completed TypeScript typecheck and build, and passed **120/120 tests** with 0 failures, 0 cancelled, and 0 skipped. All three new SQLite restart regressions passed.
- Container run `34386979320` — **success**. The production image build/runtime smoke remained green.
- Compose deployment run `34386979303` — **success**. The full reference deployment acceptance remained green, preserving durable SQLite state, generated least-privilege credentials, authenticated HTTP control plane, real compiled stdio MCP process, branch-specific blocking/release, restart during active decision and callback calls, exactly-once steering, persistence across restart, and safe-checkpoint acknowledgement.

`package.json` still has no separate lint script and no standalone migration/schema-check command. `npm run check` covers typechecking/build/tests; SQLite tests execute the durable schema/transaction path; Container and Compose cover production runtime/deployment behavior.

No live CALL-E phone call was attempted or claimed.

## Architecture decisions made this run

1. A successful ambiguous recovery becomes authoritative when the recovered non-ambiguous `CallAttempt` with durable `providerCallId` is persisted. Lifecycle retry bookkeeping is secondary metadata and must not be allowed to force another provider create after restart.
2. The existing state machine already satisfies that invariant: after recovery succeeds, restart reconciliation follows the accepted-call path and provider rehydration/observation rather than the ambiguous-create replay path.
3. Do not add a transaction spanning `recoverCallAttempt()` provider I/O and lifecycle bookkeeping. Network I/O must remain outside SQLite transactions.
4. Missing `automaticRecoveryAttempts` metadata after a crash at the successful-recovery boundary is conservative bookkeeping, not a duplicate-call or retry-budget correctness failure, because the call is no longer ambiguous.
5. Recovery-scheduled and recovery-exhausted metadata remain paired with their lifecycle audit events as one local durability invariant. New restart tests now complement the prior rollback tests.
6. Fake-provider `rehydrate` is a deterministic local reconstruction mechanism for process-local fake state. Production CALL-E does not depend on this local reconstruction because its provider identity/state is remotely durable and observed through the Calls API.
7. Existing branch/scope semantics, owner-decision exactly-once semantics, callback steering exactly-once semantics, and safe-checkpoint consumption are unchanged.
8. The supported durable topology remains one control-plane process backed by SQLite; this work does not claim multi-instance/distributed safety.
9. Fake-provider verification remains separate from live CALL-E evidence.

## CALL-E integration status

- **Fake provider:** deterministic, credential-free, idempotent, restart-rehydratable from durable accepted-call state, and exercised across the full control-plane/lifecycle/SQLite test suite. This run explicitly proves rehydration after the successful-ambiguous-recovery bookkeeping crash boundary without replaying provider create.
- **Production CALL-E adapter:** implemented against the asynchronous Calls API with server-only `CALLE_API_KEY`, stable `Idempotency-Key`, structured result schemas, bounded create/poll requests, persisted correlation, polling/webhook convergence, duplicate prevention, fail-closed ambiguous/stalled handling, and privacy-safe provider errors. This run did not alter or live-test that adapter.
- **Control-plane concurrency/durability:** logical callback/decision call identities are reserved before provider awaits; ambiguous recovery is single-flight per durable call attempt within the supported process; recovery and ordinary polling re-check durable state after provider I/O; terminal webhook precedence is covered against ambiguous recovery, stale direct polls, and overdue lifecycle sweeps; lifecycle state/audit pairs are atomic and now explicitly restart-tested.
- **Shared surfaces:** HTTP, TypeScript SDK, stdio MCP, lifecycle worker, operator/deployment paths continue to share one persistent control-plane state machine rather than adapter-specific behavior.
- **Claude Code:** the built stdio MCP process is exercised as a real external child in repository/deployment tests and the host-acceptance runbook remains aligned. An actual Claude Code host session still has not been observed and must not be claimed.
- **Live status:** no authorized real CALL-E phone call has been performed, so live provider connectivity, owner-phone authorization, and public webhook success remain unverified.

## Current blockers / external prerequisites

No repository-development blocker prevents further useful work.

A true Claude Code host acceptance requires an actual Claude Code environment/CLI to register and exercise the built stdio MCP server.

Live CALL-E verification still requires user-controlled prerequisites: a valid/authorized CALL-E credential, an authorized owner phone destination, and stable public HTTPS webhook ingress configured with the application-owned webhook capability token.

## Highest-value next actions

1. Add explicit documentation to `docs/ARCHITECTURE.md` distinguishing fake-provider `rehydrate` reconstruction from production CALL-E's remotely durable provider state, now that the restart behavior has direct regression evidence.
2. Continue auditing operator/model-facing diagnostics and read projections for accidental task-context, owner-phone, bearer-token, webhook-token, callback-prompt, or instruction disclosure.
3. Audit whether the successful recovery state transition and its `call_attempt_started` audit event should be transactionally coupled as a local post-provider-I/O invariant; only change production logic if a failure-injection regression demonstrates meaningful unaudited durable state.
4. Continue the `dispatchCallAttempt()` stale-object audit only if a genuinely reachable competing transition is found; do not add speculative state-machine complexity without a reproducible race.
5. Run the documented acceptance in a genuine Claude Code host when that external prerequisite is available and record only observed host/version behavior.
6. When the user-controlled CALL-E prerequisites are available, perform one tightly bounded live provider acceptance and record only observed behavior.
