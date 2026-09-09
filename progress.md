# CallYourAgent progress

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. Agents can escalate important decisions without freezing unrelated scopes; owners can independently request callbacks for progress/questions/steering; human input is persisted as structured state and consumed only at explicit safe checkpoints rather than pretending to interrupt in-flight model generation.

The repository includes deterministic fake and production CALL-E providers, SQLite persistence, replayable/idempotent call attempts, polling/webhook convergence, branch-scoped blocking, owner decision persistence, durable per-run instruction queues, exact instruction acknowledgement, quiet hours/call budgets, bounded lifecycle recovery, fail-closed ambiguous/stalled handling, privacy-aware audit history, scoped HTTP authentication, a typed TypeScript client, a real stdio MCP adapter, deterministic end-to-end/demo flows, an operator console, a Claude Code host-acceptance runbook, and a single-instance persistent-volume Compose reference deployment.

This run clarified and directly verified the provider restart boundary. The deterministic fake provider intentionally owns process-local active-call state and therefore uses the optional `CallProvider.rehydrate(...)` hook after restart. Production CALL-E is different: once a concrete provider call id has been durably accepted, the remote provider owns execution state and a restarted control plane must resume by polling that same id with `GET /v1/calls/{id}`. A restart alone must never replay `POST /v1/calls` for an already accepted call.

## Exact repo state inspected this run

The run started from `main` HEAD `4500be801248a2e7f6fc21f758eb89d5e2f573e4`, immediately after PR #13 made active `queued -> in_progress` observations atomic with their causal audit event.

Before making changes, inspected the complete recursive repository tree (`truncated: false`) and the current architecture, recent commits, all PRs, and issues. There were no open issues. Prior PRs #1-#13 cover call reservation/idempotency, ambiguous recovery single-flight, recovery/webhook precedence, stale poll/webhook protection, accepted-call timeout semantics, in-flight provider-create protection, lifecycle stale-sweep races, lifecycle state/audit atomicity, recovery restart guarantees, accepted-provider identity preservation after audit failures, atomic terminal polling, and atomic active-provider progress.

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

Also inspected `src/call-provider.ts`, `src/calle-provider.ts`, `src/control-plane.ts`, `src/store.ts`, and the existing fake-provider restart and SQLite reliability tests.

The audit confirmed a documentation/testing ambiguity rather than a production-state-machine defect: `FakeCallProvider.rehydrate(...)` reconstructs intentionally process-local fake state, whereas `CalleCallProvider` has no rehydrate hook and should simply query the remotely durable CALL-E call by the persisted provider id after restart.

## Changes made this run

### Production-style CALL-E restart regressions

Added `tests/calle-provider-restart.test.ts` with two SQLite close/reopen tests using fresh `CalleCallProvider` instances and deterministic mocked HTTP.

1. **Owner callback restart**
   - the first process creates exactly one CALL-E call and persists the returned `providerCallId`;
   - SQLite is closed and reopened and a fresh production adapter is constructed;
   - callback reconciliation is required to issue only `GET /v1/calls/{persisted-id}`;
   - any restarted `POST /v1/calls` would fail the test;
   - terminal steering becomes one durable queued instruction;
   - retrying the already-terminal callback performs no extra provider request and does not duplicate steering.

2. **Branch-blocking owner decision restart**
   - one blocking `release-approval` decision call is accepted while unrelated `documentation` remains the current scope;
   - after SQLite close/reopen, reconciliation is required to poll only the original provider call id;
   - the returned owner decision is persisted once;
   - only the blocked decision scope is released while unrelated current work remains unchanged;
   - retrying the resolved escalation performs no extra CALL-E request and does not duplicate decisions.

These tests exercise the real `CalleCallProvider` HTTP contract rather than the fake-provider rehydration hook. They intentionally do not make a live external request or claim live CALL-E success.

### Provider restart semantics documentation

Added `docs/PROVIDER_RESTART_SEMANTICS.md` to make the distinction explicit:

- fake `rehydrate()` is deterministic local-test reconstruction only;
- production CALL-E execution state is remote once a concrete call id exists;
- normal accepted-call restart recovery uses `GET /v1/calls/{id}`;
- only ambiguous create recovery may replay `POST /v1/calls`, always with the exact original idempotency key and bounded fail-closed semantics;
- branch-scoped decisions and callback steering retain their exactly-once/safe-checkpoint invariants across restart.

No production logic was rewritten because the audit did not reproduce a production bug at this boundary.

## Verification performed

Direct repository execution in this automation container is unavailable because its network namespace cannot resolve `github.com`, so verification used the repository's GitHub Actions execution surfaces.

The substantive PR #14 head `e020946c68fbd14d58a59795486375398c2bb914` passed every repository verification surface before merge:

- CI run `34410600503` — **success**. Locked dependencies installed under Node 24; the `Typecheck and test` step completed successfully, covering TypeScript validation, build, and the complete Node test suite including both new CALL-E restart regressions.
- Container run `34410600502` — **success**. The production image built successfully and the fake-provider runtime smoke test passed.
- Compose deployment run `34410600445` — **success**. The full reference acceptance remained green: generated scoped credentials, Compose validation, fake-provider boot/readiness, credential capability checks, the real compiled stdio MCP against the deployed control plane, SQLite restart during an active branch-blocking owner decision, release of only that blocked branch, owner-requested context-aware callback, SQLite restart during the active callback, exactly-once restored callback steering, another restart after durable steering, and steering consumption only at a safe checkpoint.

`package.json` still has no separate lint script and no standalone migration/schema-check command. The normal repository check path covers typechecking/build/tests, while SQLite tests execute the durable schema/transaction path and Container/Compose cover production runtime/deployment behavior.

PR #14 was squash-merged as `01c08df1e29f187ecb14b6f93a261ba3decd609e`.

No live CALL-E phone call was attempted or claimed.

## Architecture decisions made this run

1. The optional provider `rehydrate()` hook is an adapter-local restoration capability, not a production-provider requirement.
2. A persisted concrete `providerCallId` is sufficient correlation for normal production restart reconciliation; accepted calls are resumed by remote observation, not recreated.
3. Restart alone is never a reason to generate a new call idempotency key or replay provider create.
4. Ambiguous create recovery remains a distinct path because it specifically means the provider may have accepted a request without returning a concrete call id to the control plane.
5. Fake-provider reconstruction must never masquerade as a second call create or produce a second started audit event.
6. Production CALL-E restart verification should prove HTTP method behavior (`GET`, no `POST`) in addition to final domain state.
7. Branch-scoped blocking and safe-checkpoint instruction consumption remain independent of provider runtime persistence mechanics.
8. The supported durable topology remains one control-plane process backed by SQLite; no multi-instance/distributed claim is added.

## CALL-E integration status

- **Fake provider:** deterministic, credential-free, idempotent, and restart-rehydratable from durable accepted-call state. Its `rehydrate()` hook restores only process-local test/provider state.
- **Production CALL-E adapter:** implemented against the asynchronous Calls API with server-only `CALLE_API_KEY`, stable `Idempotency-Key`, structured result schemas, bounded create/poll requests, persisted correlation, polling/webhook convergence, duplicate prevention, and fail-closed ambiguous/stalled handling. This run adds explicit SQLite restart tests that require accepted production-style calls to resume through `GET /v1/calls/{id}` without provider-create replay.
- **Shared surfaces:** HTTP, TypeScript SDK, stdio MCP, lifecycle worker, and operator/deployment paths continue to share the same persistent control-plane state machine.
- **Claude Code:** the compiled stdio MCP child remains covered by repository/deployment tests and the host-acceptance runbook remains valid. A real Claude Code host session still has not been observed and is not claimed.
- **Live status:** no authorized real CALL-E phone call has been performed, so live provider connectivity, owner-phone authorization, and public webhook success remain unverified.

## Current blockers / external prerequisites

No repository-development blocker prevents further useful work.

A true Claude Code host acceptance requires an actual Claude Code environment/CLI to register and exercise the compiled stdio MCP server.

Live CALL-E verification still requires user-controlled prerequisites: a valid/authorized CALL-E credential, an authorized owner phone destination, and stable public HTTPS webhook ingress configured with the application-owned webhook capability token.

## Highest-value next actions

1. Audit escalation expiry and call-policy deferral/release transitions for split SQLite state/audit writes; add failure-injection coverage and transactional coupling only where a real durable inconsistency is reproducible.
2. Continue provider/result privacy audits for accidental task context, callback prompt, decision answer, instruction text, owner phone, API credential, or webhook-token disclosure.
3. Run the documented acceptance in a genuine Claude Code host when that external prerequisite is available and record only observed host/version behavior.
4. When the user-controlled CALL-E prerequisites are available, perform one tightly bounded live provider acceptance and record only observed behavior.
