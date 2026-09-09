# CallYourAgent progress

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. Agents can escalate important decisions without freezing unrelated scopes; owners can independently request callbacks for progress/questions/steering; human input is persisted as structured state and consumed only at explicit safe checkpoints rather than pretending to interrupt in-flight model generation.

The repository includes deterministic fake and production CALL-E providers, SQLite persistence, replayable/idempotent call attempts, polling/webhook convergence, branch-scoped blocking, owner decision persistence, durable per-run instruction queues, exact instruction acknowledgement, quiet hours/call budgets, bounded lifecycle recovery, fail-closed ambiguous/stalled handling, privacy-aware audit history, scoped HTTP authentication, a typed TypeScript client, a real stdio MCP adapter, deterministic end-to-end/demo flows, an operator console, a Claude Code host-acceptance runbook, and a single-instance persistent-volume Compose reference deployment.

This run closed a concrete concurrency hole in ambiguous provider-create recovery. Lifecycle recovery and an explicit reconciliation could previously enter `recoverCallAttempt` for the same ambiguous `CallAttempt` at the same time and both replay the provider create before either result returned. Provider idempotency reduced physical duplicate-call risk, but the control plane itself still allowed concurrent local recovery operations and stale recovery writes. Recovery is now single-flight per call attempt within the supported single-instance control-plane process, and recovery completion re-reads current durable state before writing so a concurrent terminal transition cannot be overwritten by a stale recovery result.

## Exact repo state inspected this run

The run started from `main` HEAD `7d769b8033ece1bcf81187c066535d7634230fa3`.

Before any change, inspected the complete recursive repository tree and current architecture. The recursive Git tree response was complete (`truncated: false`). Inspected recent commits, repository issues, and pull requests. There were no repository issues; prior PR #1 (`Fix concurrent call idempotency reservation`) was confirmed closed and merged.

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

Also inspected the relevant implementation and verification surfaces, especially:

- `src/control-plane.ts`
- `src/lifecycle.ts`
- `src/domain.ts`
- `src/call-provider.ts`
- `src/calle-provider.ts`
- `tests/sqlite-call-reservation-concurrency.test.ts`

Repository mutation and executable verification used the connected GitHub integration and GitHub Actions. No unsupported local-execution claim is made.

## Changes made this run

### Single-flight ambiguous call recovery

Production commit on PR #2: `d3a05e8e692fe5f37e798d46a20cc4e38463afca` (`fix: single-flight ambiguous call recovery`).

`ControlPlane` now owns a process-local `recoveryInFlight` map keyed by durable `callAttemptId`.

When two callers request recovery of the same ambiguous call concurrently:

1. the first caller starts the replay using the exact persisted provider request and original idempotency key;
2. the second caller receives the same in-flight promise rather than invoking `CallProvider.start` again;
3. provider I/O remains outside the database transaction;
4. once the provider operation returns or fails, the control plane re-reads the current durable `CallAttempt` before applying the result;
5. if another path has already moved the attempt out of `ambiguous`, the stale recovery result is discarded rather than overwriting newer state;
6. the single-flight entry is removed in `finally`, allowing a later legitimate retry if the attempt remains ambiguous.

This change deliberately targets the documented supported **single-process SQLite topology**. It is not presented as a distributed lease or multi-instance lock.

### SQLite lifecycle-vs-explicit recovery regression

Test commit on PR #2: `749b67f4698eb695c390f963f771c6ad40eff207` (`test: race lifecycle and explicit ambiguous recovery`).

Added `tests/sqlite-ambiguous-recovery-singleflight.test.ts` using a real temporary `SqliteControlPlaneStore` and a gated provider:

- the initial callback provider-create throws, leaving exactly one durable ambiguous attempt;
- the lifecycle sweep begins automatic recovery and the provider replay is deliberately held open;
- while that replay is in flight, explicit `reconcileCallback` runs for the same call attempt;
- the test requires only two provider `start()` invocations total: the original ambiguous create plus exactly one recovery replay;
- both recovery callers converge on the same durable call attempt and provider call id;
- the audit contains one `call_attempt_created`, one initial `call_attempt_ambiguous`, one recovered `call_attempt_started`, and one `owner_callback_requested` transition.

PR #2 (`Single-flight concurrent ambiguous call recovery`) passed verification and was merged into `main` as merge commit `2dcfbed59d01030753d8b9a9d01c3452ee8216bd`.

## Verification performed

PR head `749b67f4698eb695c390f963f771c6ad40eff207` passed every repository verification surface:

- CI run `34338183559` — **success**. Node `24.20.0`; `npm run check` completed TypeScript typecheck, build, and **106/106 tests passed**, 0 failures. The new `lifecycle and explicit reconciliation single-flight the same ambiguous SQLite call recovery` regression passed.
- Container run `34338183593` — **success**. Production container verification passed.
- Compose deployment run `34338183502` — **success**. The existing full Docker/SQLite/scoped-credential deployment acceptance, including the real compiled stdio MCP integration and restart/recovery flows, remained green.

`package.json` has no separate lint script and no standalone migration/schema-check command. The available `check` path covers typechecking, build, and tests; SQLite tests exercise schema/transaction behavior, while Container and Compose provide production runtime/deployment checks.

No live CALL-E phone call was attempted or claimed.

## Architecture decisions made this run

1. In the currently supported single-control-plane-process topology, ambiguous recovery should be single-flight by durable `callAttemptId` so lifecycle work and explicit reconciliation cannot independently replay one logical provider create at the same time.
2. Provider-side idempotency remains mandatory and is still the cross-process/provider defense. The new control-plane single-flight is an additional local concurrency guarantee, not a replacement for provider idempotency.
3. Provider network I/O remains outside SQLite transactions. Holding a SQL transaction open while waiting on CALL-E would trade duplicate-risk reduction for lock contention and shutdown/recovery hazards.
4. Any asynchronous recovery result must re-read current durable call state before writing. A webhook, polling path, or another terminal transition that wins while provider replay is in flight must not be overwritten by a stale `ambiguous -> queued` or stale error write.
5. This is not evidence of multi-instance/distributed safety. Horizontal scaling still requires a shared transactional store plus a durable distributed claim/lease mechanism (or equivalent serialization) and shared rate limiting.
6. The exact original provider idempotency key and replayable request remain the source of truth for ambiguous recovery.
7. Branch-specific blocking and safe-checkpoint steering semantics are unchanged: unrelated work continues, and owner instructions still enter durable queued state instead of interrupting in-flight generation.
8. Deterministic fake-provider evidence remains separate from live CALL-E evidence.

## CALL-E integration status

- **Fake provider:** deterministic, credential-free, provider-idempotent, restart-rehydratable from durable accepted-call state, and now used with SQLite to prove lifecycle/API recovery convergence while provider replay is actively in flight.
- **Production CALL-E adapter:** implemented against the asynchronous Calls API with server-only `CALLE_API_KEY`, stable `Idempotency-Key`, structured result schemas, bounded create/poll requests, persisted correlation, polling/webhook convergence, duplicate prevention, fail-closed ambiguous/stalled handling, and privacy-safe provider errors. This run did not alter or live-test the adapter.
- **Control-plane concurrency:** initial callback/decision call identities are reserved before provider awaits; ambiguous recovery now also converges concurrent callers on one in-process replay and re-checks durable state before applying the result.
- **Shared surfaces:** HTTP, TypeScript SDK, stdio MCP, lifecycle worker, and deployment verification continue to share the same persistent control-plane semantics rather than adapter-specific state machines.
- **Claude Code:** the built stdio MCP process is exercised as a real external child and the documented host acceptance matches the tested lifecycle. An actual Claude Code host session still has not been observed and must not be claimed.
- **Live status:** no authorized real CALL-E phone call has been performed, so live provider/phone/webhook success remains unverified.

## Current blockers / external prerequisites

No repository-development blocker prevents further useful work.

A true Claude Code host acceptance requires an actual Claude Code environment/CLI to register and exercise the built stdio MCP server.

Live CALL-E verification still requires user-controlled prerequisites: a valid/authorized CALL-E credential, an authorized owner phone destination, and stable public HTTPS webhook ingress configured with the application-owned webhook capability token.

## Highest-value next actions

1. Add a deterministic race between an in-flight ambiguous recovery replay and terminal webhook application for the same call attempt. Prove the new durable-state re-read prevents the late recovery response from overwriting `completed`/`failed` state or duplicating owner decisions/callback instructions.
2. Audit concurrent terminal polling/webhook application and lifecycle stale marking for remaining stale-object overwrites or duplicate audit transitions under asynchronous interleavings, while preserving the shared `applyTerminalOutcome` path.
3. Document fake-provider `rehydrate` behavior more explicitly in `docs/ARCHITECTURE.md`, clearly separating deterministic process-local reconstruction from production CALL-E's remotely durable provider identity.
4. Continue auditing model-/operator-facing diagnostics and read projections for accidental task-context, owner-phone, bearer-token, webhook-token, callback-prompt, or instruction disclosure.
5. Run the documented acceptance in a genuine Claude Code host when that external prerequisite is available and record only observed host/version behavior.
6. When the user-controlled CALL-E prerequisites are available, perform one tightly bounded live provider acceptance and record only observed behavior.
