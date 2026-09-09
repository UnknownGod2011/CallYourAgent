# CallYourAgent progress

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. Agents can escalate important decisions without freezing unrelated scopes; owners can independently request callbacks for progress/questions/steering; human input is persisted as structured state and consumed only at explicit safe checkpoints rather than pretending to interrupt in-flight model generation.

The repository includes deterministic fake and production CALL-E providers, SQLite persistence, replayable/idempotent call attempts, polling/webhook convergence, branch-scoped blocking, owner decision persistence, durable per-run instruction queues, exact instruction acknowledgement, quiet hours/call budgets, bounded lifecycle recovery, fail-closed ambiguous/stalled handling, privacy-aware audit history, scoped HTTP authentication, a typed TypeScript client, a real stdio MCP adapter, deterministic end-to-end/demo flows, an operator console, a Claude Code host-acceptance runbook, and a single-instance persistent-volume Compose reference deployment.

This run closed an accepted-call timeout race discovered while auditing lifecycle stale marking. A `CallAttempt` is deliberately persisted as local `queued` state before `CallProvider.start()` is awaited, so a slow provider create can leave a durable queued attempt with no provider identity while the network request is still in flight. The lifecycle stale-call timeout now applies only after a durable `providerCallId` exists. A locally reserved/in-flight create therefore cannot be falsely labeled `stalled`, while genuinely provider-accepted queued/in-progress calls retain the existing fail-closed timeout behavior.

## Exact repo state inspected this run

The run started from `main` HEAD `5940ee5c62a13263a50f0a90e7fb4a6cba84c118`, the merge of PR #5 (`Prevent stale provider polls from overwriting terminal webhook state`).

Before any change, inspected the full recursive repository tree (`truncated: false`), current architecture, recent commits, repository issue activity, and pull-request history. There were no open repository issues. The recent PR history showed the preceding concurrency hardening in PRs #1-#5, including call identity reservation, ambiguous-recovery single-flight, recovery-vs-webhook precedence, and stale poll-vs-webhook protection.

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

- `src/lifecycle.ts`
- `src/control-plane.ts`
- `tests/lifecycle.test.ts`
- the full repository `tests/` inventory
- `package.json`

The audit began with the previous next action: lifecycle stale marking versus concurrent terminal evidence. The stronger concrete flaw was at the earlier lifecycle boundary. `persistCallAttempt()` records a new phone attempt as `queued` before provider I/O, and `dispatchCallAttempt()` then awaits `CallProvider.start()`. During that await, a lifecycle sweep could see the old local reservation, find no `providerCallId`, and still age it into `stalled` because `markStalledIfOverdue()` previously checked only the local status and timestamp. That violated the documented meaning of the stale **accepted-call** timeout.

Repository mutation and executable verification used the connected GitHub integration and GitHub Actions. The coherent implementation was merged as PR #6; merge commit `721a3fdf997a5fe34cf27565c6249ea36eab437f`.

## Changes made this run

### Accepted-call stale-timeout guard

Updated `src/lifecycle.ts` so `markStalledIfOverdue()` returns without mutation when the attempt does not yet have a durable `providerCallId`.

The resulting distinction is explicit:

1. `queued` + no `providerCallId` = local persisted reservation / provider create still unresolved; not eligible for accepted-call stale timeout;
2. `queued` or `in_progress` + durable `providerCallId` = provider-accepted call; eligible for the existing bounded stale timeout;
3. `ambiguous` remains governed by bounded idempotent recovery rather than the accepted-call timeout;
4. terminal/stalled attempts remain no-ops for ordinary stale marking.

No database transaction is held across provider network I/O, no replacement call is created, and no CALL-E-facing contract changed.

### Deterministic in-flight-create regression

Added `tests/lifecycle-inflight-create-stall.test.ts` with a gated `FakeCallProvider.start()`.

The regression forces this exact interleaving:

1. an owner callback is requested while the run continues unrelated `documentation` work;
2. the durable callback `CallAttempt` is reserved as `queued` before provider creation returns;
3. provider `start()` is deliberately held in flight, so the attempt has no `providerCallId`;
4. the test clock advances beyond `maxInProgressCallAgeMs`;
5. a lifecycle sweep runs while provider creation is still unresolved;
6. the sweep must record zero stale calls, leave the reservation `queued`, and emit no `call_attempt_stalled` event;
7. provider creation is released afterward and the exact same durable attempt receives one provider identity and one `call_attempt_started` transition.

The test also verifies the run's unrelated current scope remains `documentation` throughout, preserving the product's branch/non-disturbance semantics.

## Verification performed

PR #6 head `7adf0d4c68c6b258bf29ef4810a10cb058bc1bd8` passed every repository verification surface before merge:

- CI run `34361292765` — **success**. Node `24.20.0`, locked dependency install, TypeScript typecheck, build, and **111/111 tests passed** with 0 failures. The new deterministic in-flight provider-create regression passed.
- Container run `34361292983` — **success**. Production image build and deterministic fake-provider runtime smoke passed.
- Compose deployment run `34361292908` — **success**. Generated least-privilege credentials, Compose validation, fake-provider deployment, deployed HTTP state, real compiled stdio MCP acceptance, restart during an active branch-blocking owner-decision call, branch-specific release, restart during an active owner callback, exactly-once callback steering, a subsequent persistence restart, and safe-checkpoint instruction acknowledgement all remained green.

`package.json` has no separate lint script and no standalone migration/schema-check command. `npm run check` covers typechecking/build/tests; SQLite tests exercise the durable schema/transaction path; Container and Compose cover the production runtime/deployment path.

No live CALL-E phone call was attempted or claimed.

## Architecture decisions made this run

1. The persisted pre-provider `queued` state is a reservation state as well as a provider-visible active state; provider identity distinguishes the two phases.
2. The accepted-call stale timeout begins only after a durable `providerCallId` exists. A local reservation waiting on `CallProvider.start()` must not be treated as an already accepted phone call.
3. Persist-before-side-effect remains non-negotiable. The fix does not move persistence after the network call merely to avoid exposing the intermediate state.
4. Provider I/O remains outside store transactions. Correctness is expressed through explicit durable-state guards, not long database locks around network latency.
5. Fail-closed `stalled` semantics are unchanged for genuinely accepted queued/in-progress calls: no replacement call is created, automatic polling pauses, and late terminal evidence can still resolve the original provider call.
6. Branch-level semantics remain explicit. A phone transport delay must not imply that unrelated agent scopes were interrupted or stalled.
7. The guarantee remains scoped to the documented single-process SQLite reference topology; this is not represented as distributed multi-instance coordination.
8. Deterministic fake-provider evidence remains separate from live CALL-E evidence.

## CALL-E integration status

- **Fake provider:** deterministic, credential-free, provider-idempotent, restart-rehydratable from durable accepted-call state, and now used to prove that a local persisted callback reservation cannot be mistaken for a stale provider-accepted call while provider creation is still in flight.
- **Production CALL-E adapter:** implemented against the asynchronous Calls API with server-only `CALLE_API_KEY`, stable `Idempotency-Key`, structured result schemas, bounded create/poll requests, persisted correlation, polling/webhook convergence, duplicate prevention, fail-closed ambiguous/stalled handling, and privacy-safe provider errors. This run changed lifecycle interpretation of pre-acceptance state only; it did not alter or live-test the CALL-E adapter.
- **Control-plane concurrency:** callback/decision identities are reserved before provider awaits; ambiguous recovery is single-flight per durable call attempt within the supported process; recovery and ordinary polling re-check durable state after provider I/O; terminal webhook precedence is covered against ambiguous recovery and stale polling; accepted-call timeout no longer races a still-unresolved provider create by misclassifying the local reservation.
- **Shared surfaces:** HTTP, TypeScript SDK, stdio MCP, lifecycle worker, operator/deployment paths continue to share one persistent control-plane state machine rather than adapter-specific behavior.
- **Claude Code:** the built stdio MCP process is exercised as a real external child in repository/deployment tests and the host-acceptance runbook remains aligned. An actual Claude Code host session still has not been observed and must not be claimed.
- **Live status:** no authorized real CALL-E phone call has been performed, so live provider, phone, and public-webhook success remain unverified.

## Current blockers / external prerequisites

No repository-development blocker prevents further useful work.

A true Claude Code host acceptance requires an actual Claude Code environment/CLI to register and exercise the built stdio MCP server.

Live CALL-E verification still requires user-controlled prerequisites: a valid/authorized CALL-E credential, an authorized owner phone destination, and stable public HTTPS webhook ingress configured with the application-owned webhook capability token.

## Highest-value next actions

1. Audit `dispatchCallAttempt()` for the same post-network stale-object class already fixed in polling/recovery. It currently constructs its accepted/ambiguous write from the original pre-await attempt; add a deterministic race first and, if reproducible, re-read durable state before applying the provider-create result so a delayed create response cannot overwrite a newer legitimate transition.
2. Add a SQLite-backed version of the in-flight provider-create/lifecycle sweep regression so the reservation-vs-accepted distinction is explicitly exercised through the durable SQL adapter as well as the deterministic in-memory store.
3. Continue the stale-sweep audit for already accepted calls, especially any interleaving in which terminal evidence becomes durable before a stale transition is applied; preserve terminal precedence without holding store transactions across provider I/O.
4. Document fake-provider `rehydrate` behavior more explicitly in `docs/ARCHITECTURE.md`, separating deterministic local reconstruction from production CALL-E's remotely durable provider identity.
5. Continue auditing model-/operator-facing diagnostics and read projections for accidental task-context, owner-phone, bearer-token, webhook-token, callback-prompt, or instruction disclosure.
6. Run the documented acceptance in a genuine Claude Code host when that external prerequisite is available and record only observed host/version behavior.
7. When the user-controlled CALL-E prerequisites are available, perform one tightly bounded live provider acceptance and record only observed behavior.
