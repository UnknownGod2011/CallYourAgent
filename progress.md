# CallYourAgent progress

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. Agents can escalate important decisions without freezing unrelated scopes; owners can independently request callbacks for progress/questions/steering; human input is persisted as structured state and consumed only at explicit safe checkpoints rather than pretending to interrupt in-flight model generation.

The repository includes deterministic fake and production CALL-E providers, SQLite persistence, replayable/idempotent call attempts, polling/webhook convergence, branch-scoped blocking, owner decision persistence, durable per-run instruction queues, exact instruction acknowledgement, quiet hours/call budgets, bounded lifecycle recovery, fail-closed ambiguous/stalled handling, privacy-aware audit history, scoped HTTP authentication, a typed TypeScript client, a real stdio MCP adapter, deterministic end-to-end/demo flows, an operator console, a Claude Code host-acceptance runbook, and a single-instance persistent-volume Compose reference deployment.

This run closed a real polling/webhook stale-object race. Provider `observe()` calls happen outside the durable store transaction, so a terminal webhook may legitimately complete a call while an earlier poll is still awaiting the provider. The shared active/terminal observation application paths now re-read the current durable `CallAttempt` before mutating anything. A late stale active or failed poll therefore cannot downgrade a completed callback, overwrite a completed decision call, duplicate steering/decisions, or fabricate later progress/failure audit transitions.

## Exact repo state inspected this run

The run started from `main` HEAD `771a0568e256dcfdddbf2ddd9d45fc7fc08f6b6c`, the merge of PR #4 (`Race terminal decision webhook against ambiguous recovery`).

Before any change, inspected the recursive repository tree and current architecture, recent commits, and open repository issue/PR activity. There were no open issues or pull requests before this run's branch was created.

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
- `src/call-provider.ts`
- `tests/sqlite-decision-recovery-webhook-race.test.ts`
- the repository-wide `tests/` inventory
- `package.json`

The audit found that `reconcileEscalation` and `reconcileCallback` correctly awaited provider polling outside SQLite transactions, but then passed the pre-await `CallAttempt` object into `applyActiveObservation` / `applyTerminalOutcome`. If a webhook committed terminal state during that await, the late poll could still apply against the stale snapshot. This was a genuine production-state race rather than only a missing regression.

Repository mutation and executable verification used the connected GitHub integration and GitHub Actions.

## Changes made this run

### Durable re-validation at the provider-observation boundary

Updated `src/control-plane.ts` on PR #5 so both shared provider-observation transition helpers re-read the current durable `CallAttempt` by id immediately before applying provider evidence.

`applyActiveObservation` now:

1. reloads the current attempt from the store;
2. verifies provider correlation against the current durable attempt;
3. returns the current attempt unchanged when it is no longer active;
4. only permits the existing forward `queued -> in_progress` transition;
5. derives audit metadata from that current durable state.

`applyTerminalOutcome` now:

1. reloads the current attempt from the store;
2. returns the already-terminal durable attempt unchanged if another delivery path won first;
3. applies terminal/ambiguous state and business effects only from the current durable state;
4. correlates owner decisions and callback steering using that current attempt rather than the stale pre-await object.

This keeps provider network I/O outside the database transaction while making the post-I/O mutation conditional on fresh durable truth. HTTP reconciliation, lifecycle polling, decision calls, and owner callbacks all use the same shared protection.

### SQLite polling-vs-webhook concurrency regressions

Added `tests/sqlite-poll-webhook-race.test.ts` with two gated deterministic provider tests against a real temporary `SqliteControlPlaneStore`.

The callback test forces:

1. one owner callback is accepted;
2. callback reconciliation begins `observe()` and is held in flight;
3. a terminal webhook completes the same callback and queues exactly one steering instruction;
4. the delayed poll returns stale `in_progress` evidence;
5. the callback remains `completed`, steering remains exactly once, and no `call_attempt_progressed` event is fabricated after completion.

The decision test forces:

1. a blocking `release-approval` escalation is created while independent `documentation` work remains the run's current scope;
2. reconciliation begins `observe()` and is held in flight;
3. a terminal webhook completes the decision call, creates exactly one `OwnerDecision`, and releases only `release-approval`;
4. the delayed poll returns stale `failed` evidence;
5. the attempt remains `completed`, the escalation remains `resolved`, the original decision id/answer remains authoritative, no duplicate decision is created, and no `call_attempt_failed` event is fabricated.

The first PR verification attempt exposed a test-only TypeScript mistake: the synthetic failed `CallOutcome` included an unsupported `error` property. That compile failure was corrected in commit `8f2c2d5560975208d9dbe77a4116cb178bdff656`; no production-code change was required by the failure.

## Verification performed

Corrected PR #5 head `8f2c2d5560975208d9dbe77a4116cb178bdff656` passed every repository verification surface:

- CI run `34355108181` — **success**. Node `24.20.0`, locked dependency install, TypeScript typecheck, build, and **110/110 tests passed** with 0 failures. Both new SQLite race regressions passed.
- Container run `34355108131` — **success**. Production image/runtime verification passed.
- Compose deployment run `34355108051` — **success**. The full single-instance reference deployment remained green, including generated least-privilege credentials, Compose validation, deterministic fake-provider operation, SQLite persistence/restarts, real compiled stdio MCP acceptance, active decision/callback recovery, branch-specific resume behavior, exactly-once steering, and safe-checkpoint instruction acknowledgement.

The earlier PR-head runs `34354975693` (CI), `34354975746` (Container), and `34354976030` (Compose) failed because CI typechecking stopped on the invalid test-only `error` field described above. The corrected head was then fully green across all three workflows.

`package.json` has no separate lint script and no standalone migration/schema-check command. The available `npm run check` path covers typechecking/build/tests; SQLite tests exercise durable schema/transaction behavior; Container and Compose exercise the production runtime/deployment path.

No live CALL-E phone call was attempted or claimed.

## Architecture decisions made this run

1. Durable terminal state wins over stale provider observations regardless of whether the losing observation is active or terminal.
2. Provider polling remains outside the SQLite transaction. Correctness comes from re-reading durable state after provider I/O, not from holding a database lock across network latency.
3. The stale-state guard belongs in the shared observation-application boundary rather than separately in HTTP, lifecycle, callback, or decision adapters. This prevents semantic drift across integration surfaces.
4. A late active poll cannot downgrade a terminal attempt, refresh its age, or emit a false `call_attempt_progressed` transition.
5. A late terminal poll cannot replace the winning webhook's business effects. Exactly one owner decision or callback steering result remains durable.
6. Branch-level semantics remain explicit: completing the `release-approval` decision removes only that blocked scope while unrelated `documentation` work is never represented as interrupted.
7. Webhook event-id deduplication and durable state re-validation remain complementary layers: event dedup handles repeated webhook delivery, while fresh-state validation handles independently arriving stale polls.
8. The concurrency guarantee remains scoped to the documented single-process SQLite topology; this change is not represented as distributed multi-instance coordination.
9. Deterministic fake-provider evidence remains separate from live CALL-E evidence.

## CALL-E integration status

- **Fake provider:** deterministic, credential-free, provider-idempotent, restart-rehydratable from durable accepted-call state, and now used with SQLite to prove that terminal webhook state cannot be downgraded by a stale in-flight provider poll.
- **Production CALL-E adapter:** implemented against the asynchronous Calls API with server-only `CALLE_API_KEY`, stable `Idempotency-Key`, structured result schemas, bounded create/poll requests, persisted correlation, polling/webhook convergence, duplicate prevention, fail-closed ambiguous/stalled handling, and privacy-safe provider errors. This run hardened shared control-plane reconciliation semantics but did not alter or live-test the provider adapter.
- **Control-plane concurrency:** callback/decision identities are reserved before provider awaits; ambiguous recovery is single-flight per durable call attempt within the supported process; recovery and ordinary polling now both re-check durable state after provider I/O; terminal webhook precedence is regression-tested against ambiguous recovery and against stale active/terminal polling.
- **Shared surfaces:** HTTP, TypeScript SDK, stdio MCP, lifecycle worker, operator/deployment paths continue to share the same persistent control-plane semantics rather than adapter-specific state machines.
- **Claude Code:** the built stdio MCP process is exercised as a real external child and the documented host acceptance matches the tested lifecycle. An actual Claude Code host session still has not been observed and must not be claimed.
- **Live status:** no authorized real CALL-E phone call has been performed, so live provider/phone/webhook success remains unverified.

## Current blockers / external prerequisites

No repository-development blocker prevents further useful work.

A true Claude Code host acceptance requires an actual Claude Code environment/CLI to register and exercise the built stdio MCP server.

Live CALL-E verification still requires user-controlled prerequisites: a valid/authorized CALL-E credential, an authorized owner phone destination, and stable public HTTPS webhook ingress configured with the application-owned webhook capability token.

## Highest-value next actions

1. Audit lifecycle stale marking against concurrent terminal webhook application: make the stale-age sweep evaluate an accepted call while a webhook completes it, then prove the sweep cannot leave the newer terminal attempt in `stalled` or emit a false stale transition.
2. Audit initial provider-start completion for the same stale-object pattern. In particular, determine whether a delayed create response can overwrite state changed by another legitimate reconciliation/recovery path, and add a deterministic regression before changing code.
3. Document fake-provider `rehydrate` behavior more explicitly in `docs/ARCHITECTURE.md`, separating deterministic local reconstruction from production CALL-E's remotely durable provider identity.
4. Continue auditing model-/operator-facing diagnostics and read projections for accidental task-context, owner-phone, bearer-token, webhook-token, callback-prompt, or instruction disclosure.
5. Run the documented acceptance in a genuine Claude Code host when that external prerequisite is available and record only observed host/version behavior.
6. When the user-controlled CALL-E prerequisites are available, perform one tightly bounded live provider acceptance and record only observed behavior.
