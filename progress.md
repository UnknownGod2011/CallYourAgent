# CallYourAgent progress

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. Agents can raise important owner decisions without freezing unrelated scopes; owners can independently request callbacks for progress/questions/steering; human input is persisted and consumed only at explicit safe checkpoints rather than pretending to interrupt in-flight model generation.

The repository includes SQLite persistence, deterministic fake and production CALL-E providers, replayable/idempotent call attempts, polling/webhook convergence, scoped authenticated HTTP APIs, a typed TypeScript client, stdio MCP, branch-scoped blocking, call policy/quiet hours/budgets, privacy-aware audit history, bounded lifecycle recovery, fail-closed ambiguous/stalled handling, API abuse controls, graceful shutdown, readiness/liveness surfaces, deterministic demos, and a single-instance persistent-volume Compose deployment.

This run closed the fake-provider restart gap left by the prior run. A persisted non-terminal fake phone call can now survive reconstruction of the control-plane process and the in-memory fake provider. On the first normal reconciliation after restart, the control plane can restore only the provider-local active-call state from the already-durable `CallAttempt`, then continue through the existing observation/terminal transition path. No fake mutation HTTP endpoint, duplicate provider create, or second business state machine was introduced.

## Exact repo state inspected this run

The run started from `main` HEAD `521367bead128d8eb68237b43c98f44342225960`.

Before making any change, inspected the complete recursive repository tree and current architecture, recent commits, and repository issues/pull requests. There were no open issues or pull requests.

Read in full before implementation:

- `AGENTS.md`
- `progress.md`
- `README.md`
- `docs/ARCHITECTURE.md`
- `docs/INTEGRATIONS.md`
- `docs/API_SECURITY.md`
- `docs/CALL_POLICY.md`
- `docs/DEPLOYMENT.md`
- `docs/OPERATOR_CONSOLE.md`
- `deploy/README.md`

Also inspected the relevant implementation/test/deployment surfaces before and during the change:

- `src/call-provider.ts`
- `src/domain.ts`
- `src/control-plane.ts`
- `src/lifecycle.ts`
- `tests/fake-provider-auto-completion.test.ts`
- `tests/sqlite-store.test.ts`
- `.github/workflows/compose.yml`
- `package.json`

The previous run had already made fake provider call identifiers deterministic from the provider idempotency key and proved durable MCP steering across a control-plane restart. However, a fresh `FakeCallProvider` still had an empty in-memory call map. A durable `queued` or `in_progress` call could therefore exist correctly in SQLite while normal reconciliation against the newly constructed fake provider failed with `Unknown fake call`. That was the smallest high-value reliability gap selected for this run.

## Changes made this run

### Provider-local rehydration capability

Added an optional `CallProvider.rehydrate(...)` capability. Its input contains only state the control plane already persisted before a restart:

- stable provider call id;
- stable provider idempotency key;
- call purpose;
- persisted active state (`queued` or `in_progress`);
- exact replayable task;
- exact persisted metadata.

This capability is optional. The production CALL-E adapter does not implement it because CALL-E is a remote durable provider and its active call should continue to be observed through the real provider API. The hook exists for provider adapters whose active state is intentionally process-local, principally the deterministic fake provider.

### FakeCallProvider restores an accepted in-flight call safely

`FakeCallProvider.rehydrate` now rebuilds its process-local active-call entry from durable state without sending or simulating a second provider create.

It validates that the supplied provider call id is exactly the deterministic SHA-256-derived identity for the persisted idempotency key. It rejects a conflicting idempotency mapping or purpose mismatch, preventing corrupt durable input from silently becoming a different logical phone call.

When valid, it restores the persisted `queued`/`in_progress` state and initializes only provider-local observation bookkeeping. Existing in-memory calls are left intact. Auto-completion remains opt-in and deterministic; after process recreation its local observation counter naturally restarts because that counter is fake-provider implementation state rather than domain truth.

### Normal reconciliation performs rehydration only when needed

`ControlPlane.reconcileEscalation` and `ControlPlane.reconcileCallback` now call a small shared `rehydrateProviderCallIfSupported` helper immediately before ordinary provider observation when:

- the provider implements the optional capability;
- the durable attempt has a provider call id; and
- the durable attempt is still `queued` or `in_progress`.

The helper uses the existing persisted `CallAttempt` request/idempotency/provider state. It does not create an audit event, update the durable attempt, change timestamps, or invoke `start()`. Therefore a process-local restoration cannot masquerade as a second accepted phone side effect or refresh stale-call timing.

All subsequent progress/terminal handling remains in the existing `observe` -> `applyActiveObservation` / `applyTerminalOutcome` path. Branch-scoped blocking, owner decisions, callback steering, instruction queues, webhook convergence, recovery budgets, and CALL-E behavior are unchanged.

### Restart regression coverage

Added `tests/fake-provider-rehydration.test.ts` with three regressions:

1. A queued owner callback is persisted in SQLite, the store is closed, and a completely fresh fake provider/control plane is constructed. Normal callback reconciliation then rehydrates the same provider identity, completes through deterministic fake observation, queues one owner instruction, leaves one durable call attempt, and leaves the number of `call_attempt_started` events at exactly one.
2. An `in_progress` fake callback survives SQLite reopen even when the restarted fake provider's constructor default is `queued`. Reconciliation preserves the durable `in_progress` state and creates no artificial `call_attempt_progressed` event.
3. Fake-provider rehydration rejects a provider call id that does not correspond to the persisted idempotency key.

Commits made before this progress update:

- `342143e8e09dfa9478be199654694630161e9cdd` — `feat: rehydrate persisted fake calls after restart`
- `7df11a76aae8dadd54eb5e908504b0a4005d9c5f` — `fix: restore active provider state before reconciliation`
- `c05f7431b40e62b479c64836ae4a96640cb23a02` — `test: cover active fake calls across process restart`

## Verification performed

The automation environment did not provide a local repository checkout suitable for running the repository's Node/Docker commands directly, so no local execution claim is made. Executable verification used the repository's GitHub Actions workflows on implementation commit `c05f7431b40e62b479c64836ae4a96640cb23a02`.

- CI run `34266516503` — **success**. Node 24 locked dependency install, TypeScript typecheck, build, and the complete test suite passed: **94 tests, 94 passed, 0 failed**. The three new active-call restart regressions all passed.
- Container run `34266516647` — **success**. The production image build and fake-provider runtime smoke passed.
- Compose deployment run `34266516561` — **success**. The existing least-privilege credential checks, real stdio MCP subprocess path, control-plane restart, branch-scoped decision/callback flow, SQLite persistence, safe-checkpoint steering acknowledgement, and authorization boundaries all remained green with the new provider behavior.

`package.json` still has no separate lint script and no standalone migration/schema-check command. Available executable verification remains `npm run check` through CI plus the Container and Compose workflows.

No live CALL-E phone call was attempted or claimed.

## Architecture decisions made this run

1. Durable control-plane state remains authoritative. Rehydration reconstructs only process-local provider simulation state from a persisted `CallAttempt`; it does not introduce provider state as a second source of truth.
2. Rehydration is optional at the provider port. Remote CALL-E continues normal API observation and receives no fake-only restart behavior.
3. Rehydration is not recovery by re-creation. It must not call `start()`, generate a new idempotency key, create a replacement phone attempt, refresh the durable timeout anchor, or emit another `call_attempt_started` event.
4. The fake provider verifies provider identity against the persisted idempotency key before accepting rehydration. A mismatch fails closed instead of silently creating a new logical call.
5. The persisted active status wins over a new fake provider constructor default. This avoids inventing a `queued -> in_progress` transition after restart and keeps lifecycle timeout/audit semantics accurate.
6. Fake auto-completion observation counters remain provider-local test machinery rather than new persisted domain state. Persisting them would add fake-specific state to the core schema without improving production correctness.
7. Existing safe-checkpoint semantics are unchanged: callback instructions become durable only through the normal terminal outcome path and are still consumed solely by explicit agent checkpoint/acknowledgement.

## CALL-E integration status

- Fake provider: deterministic, credential-free, restart-stable for provider identity, and now able to restore a durable accepted `queued`/`in_progress` fake call after complete provider-process reconstruction. Tested with SQLite reopen, deterministic terminal completion, durable steering, HTTP/SDK/MCP paths, branch-scoped decisions, callbacks, exact acknowledgement, and deployment restart coverage.
- Production CALL-E adapter: implemented with server-only `CALLE_API_KEY`, idempotent create, structured results, active-state observation, polling/webhook terminal convergence, bounded HTTP requests, exact-key ambiguous recovery, duplicate prevention, and fail-closed stalled handling. It does not use the fake rehydration hook.
- HTTP, SDK, MCP, and lifecycle reconciliation continue to share the same persistent `ControlPlane` semantics.
- Live CALL-E success remains unverified; no authorized real phone call was made.

## Current blockers / external prerequisites

No repository-development blocker prevents further useful work.

Live CALL-E verification still requires user-controlled prerequisites: a valid/authorized CALL-E credential, an authorized owner phone destination, and stable public HTTPS webhook ingress configured with the application-owned webhook capability token.

Actual Claude Code host acceptance still requires executing the documented host registration in a real Claude Code environment. The repository proves the built stdio subprocess, official MCP protocol, authenticated HTTP boundary, SQLite durability, and control-plane restart behavior, but this is not represented as a real Claude Code host run.

## Highest-value next actions

1. Extend the real Compose deployment acceptance so the service is restarted **while an accepted fake owner-decision/callback call is still non-terminal**, then reconcile it after restart. This will elevate the new SQLite/domain regression into container-level deployment evidence.
2. Verify the same in-flight restart case through the external stdio MCP path, ensuring the agent host never receives a duplicate owner decision or callback instruction.
3. Consider a narrowly scoped architecture note for optional provider rehydration once the deployment-level acceptance is in place; keep it clearly fake/process-local and do not imply CALL-E needs local reconstruction.
4. Add a compact real-host runbook/fixture for Claude Code using the existing least-privilege agent credential and already-proven stdio tools.
5. Continue auditing restart/provider diagnostics for bearer/webhook secret exposure and fail-closed behavior.
6. When the user-controlled CALL-E prerequisites are available, perform one bounded live provider acceptance and record only observed behavior.
