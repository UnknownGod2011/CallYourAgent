# CallYourAgent progress

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. Agents can escalate important decisions without freezing unrelated scopes; owners can independently request callbacks for progress/questions/steering; human input is persisted as structured state and consumed only at explicit safe checkpoints rather than pretending to interrupt in-flight model generation.

The repository includes deterministic fake and production CALL-E providers, SQLite persistence, replayable/idempotent call attempts, polling/webhook convergence, branch-scoped blocking, owner decision persistence, durable per-run instruction queues, exact instruction acknowledgement, quiet hours/call budgets, bounded lifecycle recovery, fail-closed ambiguous/stalled handling, privacy-aware audit history, scoped HTTP authentication, a typed TypeScript client, a real stdio MCP adapter, deterministic end-to-end/demo flows, an operator console, a Claude Code host-acceptance runbook, and a single-instance persistent-volume Compose reference deployment.

This run closed the remaining known check-before-await duplication windows in both real-world phone-call creation paths. Owner callbacks now reserve their durable local `CallAttempt` and callback idempotency mapping transactionally before awaiting the provider. Owner-decision calls now reserve their durable `CallAttempt` and link the escalation to that attempt as `calling` transactionally before awaiting the provider. Concurrent duplicate requests or reconciliation therefore converge on one local call identity and one audit chain instead of relying only on provider-side idempotency to prevent a second physical phone call.

## Exact repo state inspected this run

The run started from `main` HEAD `c318800a8c925acb0e8e1c25b7625f819b834055`.

Before any change, inspected the complete recursive repository tree and current architecture. The recursive Git tree response was complete (`truncated: false`). Inspected recent commits and searched repository issues and pull requests; there were no open issues and no open PRs before this run.

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

Also inspected the relevant implementation and verification surfaces, especially `src/control-plane.ts`, `src/store.ts`, `tests/control-plane.test.ts`, the restart/audit regressions, and `package.json`.

The automation container still could not clone the repository because DNS resolution for `github.com` failed. Repository mutation therefore used the connected GitHub integration and executable verification used GitHub Actions. No unsupported local-execution claim is made.

## Changes made this run

### Transactional owner-callback identity reservation

Merged implementation: `465d929e21f890c50d83c1aa95ef0baf7fce1316` (`fix: reserve call identities before provider awaits`).

`ControlPlane.requestOwnerCallback` previously checked `callbackByIdempotencyKey`, then awaited `startCall`, and only afterward persisted the callback idempotency mapping. Two truly concurrent requests with the same logical callback key could therefore create two local `CallAttempt`/audit records while the first provider call was still being created. The fake/real provider idempotency key protected the physical call, but the control plane could still have duplicate local identities.

The callback path now:

1. checks the existing callback idempotency mapping;
2. inside one synchronous store transaction, persists the replayable `CallAttempt`, records `call_attempt_created`, and stores the callback idempotency mapping;
3. only then awaits the provider side effect;
4. updates that same reserved attempt to started or ambiguous.

Added `tests/callback-idempotency-concurrency.test.ts` with a gated provider that deliberately holds the first `start()` call open. A concurrent retry must return the already-reserved local attempt immediately. The test proves one provider start, one local call attempt, one callback mapping, one `call_attempt_created`, one `call_attempt_started`, and one `owner_callback_requested` audit event.

### Transactional owner-decision call reservation

The audit found the equivalent race in `startEscalationCallIfAllowed`. `requestOwnerDecision` already persisted the escalation/idempotency key before awaiting the provider, but the escalation's `callAttemptId` was not linked until after provider start returned. A concurrent `reconcileEscalation` during that await could therefore see a pending escalation with no attempt and start a second local call attempt using the same provider idempotency key.

The decision path now, after policy allows a call:

1. enters a store transaction;
2. rereads the current escalation and exits if another path already linked an attempt;
3. persists exactly one replayable `CallAttempt`;
4. atomically changes the escalation to `calling` and stores that exact `callAttemptId`;
5. exits the transaction and only then awaits provider start;
6. returns the durable escalation linked to the reserved call attempt.

Added `tests/decision-idempotency-concurrency.test.ts` with the same deterministic gated-provider pattern. While the first provider start is held open, reconciliation sees the already-linked call attempt and cannot create another local attempt or provider start. The affected `release-approval` branch remains blocking while unrelated run work remains independent.

### Shared call-start refactor

Split the former `startCall` implementation into:

- `persistCallAttempt(...)` — creates replayable durable local identity and `call_attempt_created` audit state without contacting the provider;
- `dispatchCallAttempt(...)` — performs the external provider start and transitions the same attempt to accepted or ambiguous;
- `startCall(...)` — retains the existing convenience behavior by composing the two helpers for paths that do not need a larger atomic reservation transaction.

This keeps provider retry/ambiguity semantics unchanged while making the persistence-before-side-effect ordering explicit and reusable.

## Verification performed

The final PR head `c62ccf5722242a8c0b889b6c16c683982c5a909d` passed every repository verification surface before merge:

- CI run `34327780582` — **success**. Node `24.20.0`; `npm run check` completed TypeScript typecheck, build, and **103/103 tests passed**, 0 failures. Both new deterministic concurrency regressions passed.
- Container run `34327780593` — **success**. Production image build and fake-provider runtime smoke passed.
- Compose deployment run `34327780592` — **success**. Generated least-privilege credentials, Compose validation, fake-provider deployment, real built stdio MCP verification, restart while an owner-decision call was active, branch-specific release, owner callback creation, restart while the callback was active, exactly-once restored callback reconciliation/steering, restart after steering became durable, and safe-checkpoint exact acknowledgement all passed.

The callback-only intermediate state at `ee2fb8b9f40046a3a4f2f2ea76efbe891211101c` had also passed CI (**102/102 tests**), Container, and Compose before the owner-decision race was subsequently fixed in the same coherent PR.

`package.json` has no separate lint script and no standalone migration/schema-check command. The available `check` path covers typechecking, build, and tests; Container and Compose provide the production runtime/deployment checks.

No live CALL-E phone call was attempted or claimed.

## Architecture decisions made this run

1. Provider idempotency is a second line of defense, not the control plane's only concurrency mechanism. One logical call must first have one durable local identity before any external await.
2. For owner callbacks, `CallAttempt` creation and `callbackByIdempotencyKey` reservation belong in the same transaction so a concurrent duplicate can immediately converge on the reserved attempt.
3. For owner decisions, `CallAttempt` creation and escalation `pending -> calling` linkage belong in the same transaction so lifecycle reconciliation cannot mistake an in-flight provider create for an escalation that still needs a call.
4. External provider I/O remains outside the store transaction. The transaction protects durable local intent/identity; provider timeout or transport uncertainty is still represented as `ambiguous` and recovered with the exact original provider idempotency key.
5. Branch-specific semantics are unchanged: only the affected blocking scope waits for owner judgment; unrelated scopes remain free to continue.
6. Callback steering and owner decisions remain durable structured state. Steering is still consumed only at explicit safe checkpoints; no path pretends to interrupt in-flight model/token generation.
7. Deterministic fake-provider evidence remains distinct from live CALL-E evidence.

## CALL-E integration status

- **Fake provider:** deterministic, credential-free, provider-idempotent, restart-rehydratable from durable accepted-call state, and now explicitly covered for simultaneous callback retry and decision-reconciliation races before provider start completes.
- **Production CALL-E adapter:** implemented against the asynchronous Calls API with server-only `CALLE_API_KEY`, stable `Idempotency-Key`, structured result schemas, bounded create/poll requests, persisted correlation, polling/webhook convergence, duplicate prevention, fail-closed ambiguous/stalled handling, and privacy-safe provider errors.
- **Control-plane concurrency:** callback logical identity and owner-decision call linkage are now reserved before provider awaits in the supported single-instance SQLite topology. Provider idempotency still protects retries/recovery across process/network uncertainty.
- **Shared surfaces:** HTTP, TypeScript SDK, stdio MCP, lifecycle worker, and deployment verification continue to share the same persistent control-plane semantics rather than adapter-specific state machines.
- **Claude Code:** the built stdio MCP process is exercised as a real external child and the documented host acceptance matches the tested lifecycle. An actual Claude Code host session still has not been observed and must not be claimed.
- **Live status:** no authorized real CALL-E phone call has been performed, so live provider/phone/webhook success remains unverified.

## Current blockers / external prerequisites

No repository-development blocker prevents further useful work.

A true Claude Code host acceptance requires an actual Claude Code environment/CLI to register and exercise the built stdio MCP server.

Live CALL-E verification still requires user-controlled prerequisites: a valid/authorized CALL-E credential, an authorized owner phone destination, and stable public HTTPS webhook ingress configured with the application-owned webhook capability token.

## Highest-value next actions

1. Add a SQLite-backed concurrency regression for the new reservation semantics so the same simultaneous callback/decision-start race is proven against the durable SQL transaction adapter, not only the deterministic in-memory store.
2. Re-audit other asynchronous state transitions for check-then-await races, especially ambiguous recovery/reconciliation paths, while preserving the rule that external provider I/O stays outside database transactions.
3. Document fake-provider `rehydrate` behavior more explicitly in `docs/ARCHITECTURE.md`, separating deterministic process-local reconstruction from production CALL-E's remotely durable provider call identity.
4. Continue auditing model-/operator-facing diagnostics and read projections for accidental task-context, owner-phone, bearer-token, webhook-token, callback-prompt, or instruction disclosure.
5. Run the documented acceptance in a genuine Claude Code host when that external prerequisite is available and record only observed host/version behavior.
6. When the user-controlled CALL-E prerequisites are available, perform one tightly bounded live provider acceptance and record only observed behavior.
