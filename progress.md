# CallYourAgent progress

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. Agents can escalate important decisions without freezing unrelated scopes; owners can independently request callbacks for progress/questions/steering; human input is persisted as structured state and consumed only at explicit safe checkpoints rather than pretending to interrupt in-flight model generation.

The repository includes deterministic fake and production CALL-E providers, SQLite persistence, replayable/idempotent call attempts, polling/webhook convergence, branch-scoped blocking, owner decision persistence, durable per-run instruction queues, exact instruction acknowledgement, quiet hours/call budgets, bounded lifecycle recovery, fail-closed ambiguous/stalled handling, privacy-aware audit history, scoped HTTP authentication, a typed TypeScript client, a real stdio MCP adapter, deterministic end-to-end/demo flows, an operator console, a Claude Code host-acceptance runbook, and a single-instance persistent-volume Compose reference deployment.

This run hardened four remaining core local state-plus-audit boundaries. Agent registration, run creation, heartbeat/status reporting, and direct owner-instruction enqueue now commit their domain mutation and causal audit event in the same store transaction. In particular, a failed `owner_instruction_queued` audit can no longer leave steering durably queued for an agent to consume even though the caller observed an exception.

## Exact repo state inspected this run

The run started from `main` HEAD `14c49f53d4e01a42240ef31b8a23d636cf1e8dd1`, immediately after PR #17 and its progress handoff made owner callback reservation plus `owner_callback_requested` causal audit atomic before provider dispatch.

Before changing code, inspected the complete recursive repository tree and current architecture, recent commits, relevant issues, and pull requests. The tree was not truncated and covered the repository root, `.github/workflows`, `deploy`, all `docs`, `src`, and `tests` files. There were no open issues. Recent merged work through PR #17 was reviewed, including concurrent call reservation, ambiguous-recovery single-flight, webhook/poll races, stale accepted-call handling, lifecycle state/audit atomicity, restart guarantees, accepted provider-identity preservation, terminal polling atomicity, active-provider progress atomicity, production CALL-E restart semantics, escalation policy atomicity, initial owner-decision creation atomicity, and owner-callback request reservation atomicity.

Read in full before changing code:

- `AGENTS.md`
- `progress.md`
- `README.md`
- `docs/ARCHITECTURE.md`
- `docs/INTEGRATIONS.md`
- `docs/API_SECURITY.md`
- `docs/CALL_POLICY.md`

Also inspected the relevant implementation and durability surfaces, especially `src/control-plane.ts`, `src/store.ts`, `src/sqlite-store.ts`, the existing SQLite failure-injection pattern in `tests/sqlite-callback-request-atomicity.test.ts`, and the repository verification scripts in `package.json`.

The audit confirmed four remaining split-write paths in `ControlPlane`: `registerAgent`, `startRun`, `heartbeat`, and direct `enqueueInstruction` persisted state before recording the matching audit event. Under SQLite, an injected audit write failure therefore allowed the API operation to throw after its domain state had already become durable. The most consequential case was instruction enqueue: steering from an apparently failed operation could remain queued and later be consumed at a safe checkpoint without its causal audit record.

## Changes made this run

PR #18, `Make core state and audit writes atomic`, transactionally coupled those four local boundaries and added deterministic SQLite rollback/retry coverage.

### Agent registration

`registerAgent` now commits the new `AgentRegistration` and `agent_registered` audit event in one `store.transaction(...)`. If causal audit persistence fails, the registration does not survive in SQLite or the in-memory mirror.

### Run creation

`startRun` now commits the new running `AgentRun` and `run_started` audit event in one transaction. A failed audit therefore cannot leave an active run whose creation call threw.

### Heartbeat/status reporting

`heartbeat` now performs the run mutation and `run_status_reported` audit in one transaction. It also re-reads and revalidates the current run inside that transaction before applying the update, so the mutation is based on the state protected by the same local durability boundary.

### Direct owner instruction enqueue

`enqueueInstruction` now commits the queued `OwnerInstruction` and `owner_instruction_queued` audit together. This is important for safe-checkpoint correctness: a local persistence/audit failure cannot leave a hidden queued steering item that the agent could later consume despite the enqueue operation having failed.

The SQLite store already supports nested synchronous transactions by joining an existing outer transaction. Therefore callback terminal reconciliation can continue to invoke `enqueueInstruction` while its broader terminal outcome is transactional; the instruction write and audit participate in that existing atomic terminal unit rather than starting provider/network work or a second SQL transaction.

No HTTP, MCP, SDK, persistence schema, call-policy, provider, or public API contract changed. Provider/CALL-E I/O remains outside database transactions.

### SQLite failure-injection regressions

Added `tests/sqlite-core-state-audit-atomicity.test.ts` with four deterministic regressions. They inject one failure while writing each causal audit event and prove:

- `agent_registered` failure leaves zero registered agents and zero registration audit; a clean retry succeeds once;
- `run_started` failure leaves zero runs and zero start audit; a clean retry succeeds once;
- `run_status_reported` failure restores the exact previous run state and leaves zero status audit; a clean retry applies the heartbeat once;
- `owner_instruction_queued` failure leaves zero queued instructions, an empty checkpoint instruction list, and zero queue audit; a clean retry queues one durable instruction visible at the next safe checkpoint.

These regressions exercise both SQLite rollback and the store's in-memory-mirror reload behavior after rollback.

## Verification performed

Direct repository execution in the automation container remains unavailable, so verification used the repository's GitHub Actions surfaces.

Final substantive PR #18 head `2140925200c7d9cfbf22b7ca481f0a7de378fc35` passed every repository verification surface before merge:

- CI run `34427807425` — **success**. Node `24.20.0`; locked dependencies installed; TypeScript no-emit typecheck succeeded; build succeeded; Node test suite finished with **138 tests, 138 passed, 0 failed, 0 cancelled, 0 skipped, 0 todo**. All four new SQLite core state/audit rollback regressions passed explicitly.
- Container run `34427807432` — **success**.
- Compose deployment run `34427807407` — **success**, preserving the production-style container/Compose acceptance path and the existing durable SQLite + compiled stdio MCP + restart/recovery + branch-safe decision + owner-callback steering + safe-checkpoint behavior.

`package.json` still has no separate lint script and no standalone migration/schema-check command. `npm run check` covers typechecking, build, and tests; SQLite tests exercise the durable schema and transaction path; Container and Compose exercise production image/runtime/deployment behavior.

PR #18 was squash-merged as `a5b9b56d48533396c17f972e8d2e350cbf359afc`.

No live CALL-E phone call was attempted or claimed.

## Architecture decisions made this run

1. A successful local control-plane mutation should not outlive a failed causal audit write when both are purely local state. Registration, run creation, status reporting, and direct instruction enqueue therefore share one durability unit with their audit event.
2. Durable steering is correctness-sensitive state, not merely logging-adjacent data. If an enqueue operation fails, the system must not later surface that instruction at a safe checkpoint unless the enqueue and its causal audit both committed.
3. Heartbeat re-reads the run inside the transaction before mutation. This keeps the reported status transition tied to the state protected by the same local SQLite boundary.
4. Nested local transactions intentionally join the outer SQLite transaction. Callback terminal application can therefore call the now-transactional `enqueueInstruction` without weakening the already-established all-or-nothing terminal outcome semantics.
5. Provider/CALL-E network I/O remains outside SQLite transactions. This increment changes only local persistence/audit atomicity and does not hold a database transaction across external side effects.
6. Existing branch/scope semantics are unchanged: blocked work remains scoped, unrelated work can continue, and owner instructions still enter a durable queue consumed only at explicit safe checkpoints.
7. No distributed/multi-instance claim is introduced; the supported durable reference topology remains one control-plane process with SQLite.

## CALL-E integration status

- **Fake provider:** deterministic, credential-free, idempotent, restart-rehydratable from durable accepted-call state, and still the primary full-flow development/acceptance provider. Existing decision/callback/restart/safe-checkpoint paths remained green after this increment.
- **Production CALL-E adapter:** remains implemented against the asynchronous Calls API with server-only `CALLE_API_KEY`, stable `Idempotency-Key`, structured result schemas, bounded create/poll requests, persisted correlation, polling/webhook convergence, duplicate prevention, restart-by-provider-id semantics, and fail-closed ambiguous/stalled handling. This run did not alter its external behavior.
- **Shared surfaces:** HTTP, TypeScript SDK, stdio MCP, lifecycle worker, operator console, and deployment flows continue to share the same persistent control-plane state machine.
- **Claude Code:** compiled stdio MCP behavior remains covered by automated and Compose acceptance. A genuine Claude Code host session has still not been observed and is not claimed.
- **Live status:** no authorized real CALL-E phone call has been performed, so live provider connectivity, owner-phone authorization, and public webhook success remain unverified.

## Current blockers / external prerequisites

No repository-development blocker prevents further useful work.

A true Claude Code host acceptance requires an actual Claude Code environment/CLI to register and exercise the compiled stdio MCP server.

Live CALL-E verification still requires user-controlled prerequisites: a valid/authorized CALL-E credential, an authorized owner phone destination, and stable public HTTPS webhook ingress configured with the application-owned webhook capability token.

## Highest-value next actions

1. Audit callback reservation concurrency at the exact local-commit/provider-start boundary. The current durable reservation prevents duplicate local call attempts, but verify whether two concurrent idempotent `requestOwnerCallback` callers can both receive the same still-unaccepted reservation and independently enter `dispatchCallAttempt` before `providerCallId` is written. Add an in-process single-flight dispatch guard only if that race is reproducible; retain provider idempotency as a second line of defense rather than the primary guard.
2. Audit the analogous decision-call dispatch boundary after durable reservation, especially any path where the reserving request and a concurrent reconciliation can both observe a queued reservation without a provider id. Existing tests cover important variants, so change production logic only for a newly reproducible gap.
3. Continue provider/result privacy audits for accidental task context, callback prompt, decision answer, instruction text, owner phone, API credential, or webhook-token disclosure.
4. Run the documented acceptance in a genuine Claude Code host when that external prerequisite is available and record only observed host/version behavior.
5. When the user-controlled CALL-E prerequisites are available, perform one tightly bounded live provider acceptance and record only observed behavior.
