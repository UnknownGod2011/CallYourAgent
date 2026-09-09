# CallYourAgent progress

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. Agents can escalate important decisions without freezing unrelated scopes; owners can independently request callbacks for progress/questions/steering; human input is persisted as structured state and consumed only at explicit safe checkpoints rather than pretending to interrupt in-flight model generation.

The repository includes deterministic fake and production CALL-E providers, SQLite persistence, replayable/idempotent call attempts, polling/webhook convergence, branch-scoped blocking, owner decision persistence, durable per-run instruction queues, exact instruction acknowledgement, quiet hours/call budgets, bounded lifecycle recovery, fail-closed ambiguous/stalled handling, privacy-aware audit history, scoped HTTP authentication, a typed TypeScript client, a real stdio MCP adapter, deterministic end-to-end/demo flows, an operator console, a Claude Code host-acceptance runbook, and a single-instance persistent-volume Compose reference deployment.

This run strengthened the previous call-identity reservation hardening by proving the same concurrent owner-callback retry and owner-decision reconciliation races against the real SQLite transaction adapter. The deterministic tests hold the provider create request open while a competing operation runs, and require SQLite to expose exactly one durable local `CallAttempt`, one logical mapping/link, one provider start, and one audit chain before and after the provider side effect completes.

## Exact repo state inspected this run

The run started from `main` HEAD `9e21627c724f864b43b1ed03979a6610cd4348cc`.

Before any change, inspected the complete recursive repository tree and current architecture. The recursive Git tree response was complete (`truncated: false`). Inspected recent commits and repository issues/pull requests; there were no open issues or open PRs at the start of this run.

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
- `src/store.ts`
- `src/sqlite-store.ts`
- `src/lifecycle.ts`
- `tests/callback-idempotency-concurrency.test.ts`
- `tests/decision-idempotency-concurrency.test.ts`
- `tests/sqlite-store.test.ts`
- `package.json`

Repository mutation and executable verification used the connected GitHub integration and GitHub Actions. No unsupported local-execution claim is made.

## Changes made this run

### SQLite-backed concurrent call-reservation regressions

Implementation/test commit: `142b75a051b7d503e92030f1479a7cb64534fb0b` (`test: prove call reservation races on sqlite`).

Added `tests/sqlite-call-reservation-concurrency.test.ts` with two deterministic gated-provider tests using a real temporary `SqliteControlPlaneStore`.

#### Owner callback retry race

The first callback request is allowed to persist its logical callback identity and enter `CallProvider.start`, then the provider start is deliberately held open. A concurrent retry with the same callback idempotency key must immediately converge on the already-reserved SQLite-backed attempt rather than create another local attempt.

The test requires, while provider creation is still in flight:

- exactly one provider `start()` invocation;
- exactly one persisted `CallAttempt`;
- the callback idempotency mapping to reference that attempt;
- no `providerCallId` yet on the retry-visible durable attempt;
- exactly one `call_attempt_created` audit event;
- zero `call_attempt_started` events before the provider is released.

After provider release it requires the original request and retry to share the same attempt id, exactly one accepted provider call, and one each of `call_attempt_created`, `call_attempt_started`, and `owner_callback_requested`.

#### Owner-decision reconciliation race

The first blocking owner-decision request similarly holds provider creation open after SQLite has transactionally persisted the `CallAttempt` and changed the escalation to `calling` with that exact `callAttemptId`.

A concurrent `reconcileEscalation` must observe the already-linked attempt and cannot reserve or dispatch another call. The test requires:

- escalation status `calling` with a durable `callAttemptId` before provider completion;
- exactly one SQLite-backed call attempt;
- exactly one provider `start()` invocation even after concurrent reconciliation;
- the `release-approval` branch to remain the unresolved blocking scope while unrelated run work remains independent;
- one `call_attempt_created` and zero `call_attempt_started` before provider release;
- one `escalation_created`, one `call_attempt_created`, and one `call_attempt_started` after completion.

No production HTTP, MCP, SDK, state-machine, CALL-E adapter, branch-blocking, or safe-checkpoint behavior was changed in this run. The increment adds durable SQL-path evidence for the existing persistence-before-side-effect invariant.

## Verification performed

Substantive commit `142b75a051b7d503e92030f1479a7cb64534fb0b` passed every repository verification surface:

- CI run `34332572512` — **success**. Node `24.20.0`; `npm run check` completed TypeScript typecheck, build, and **105/105 tests passed**, 0 failures. Both new SQLite concurrency regressions passed.
- Container run `34332572539` — **success**. Production image build and fake-provider runtime smoke both passed.
- Compose deployment run `34332572554` — **success**. Generated least-privilege credentials, Compose validation, fake-provider deployment, real built stdio MCP verification, restart while an owner-decision call was active, branch-specific release, owner callback creation, restart while the callback was active, exactly-once restored callback reconciliation/steering, restart after steering became durable, and safe-checkpoint exact acknowledgement all passed.

`package.json` has no separate lint script and no standalone migration/schema-check command. The available `check` path covers typechecking, build, and tests; the SQLite tests exercise schema creation/transaction behavior, while Container and Compose provide production runtime/deployment checks.

No live CALL-E phone call was attempted or claimed.

## Architecture decisions made this run

1. The persistence-before-provider-side-effect invariant must be proven against the durable SQL adapter, not only against the in-memory reference store.
2. A callback logical identity is not considered safely reserved until the SQLite transaction contains both the durable `CallAttempt` and callback idempotency mapping before external provider I/O begins.
3. An owner-decision call is not considered safely reserved until the SQLite transaction contains both the `CallAttempt` and escalation `pending -> calling` linkage before external provider I/O begins.
4. External provider I/O remains outside the SQLite transaction. The transaction protects local intent/identity; provider uncertainty is still modeled through the existing ambiguous/recovery state machine and the exact original provider idempotency key.
5. These tests strengthen the supported **single-instance SQLite** topology only. They are not evidence of multi-instance/distributed safety and do not change the documented requirement for a shared transactional store before horizontal scaling.
6. Provider idempotency remains a second line of defense. The control plane must independently converge concurrent local operations on one durable call identity.
7. Branch-specific semantics and safe-checkpoint steering are unchanged: only the affected blocking scope waits for owner judgment, and owner instructions are consumed only at explicit work boundaries.
8. Deterministic fake-provider evidence remains separate from live CALL-E evidence.

## CALL-E integration status

- **Fake provider:** deterministic, credential-free, provider-idempotent, restart-rehydratable from durable accepted-call state, and now used to prove the callback/decision simultaneous-start reservation races through the actual SQLite transaction adapter.
- **Production CALL-E adapter:** implemented against the asynchronous Calls API with server-only `CALLE_API_KEY`, stable `Idempotency-Key`, structured result schemas, bounded create/poll requests, persisted correlation, polling/webhook convergence, duplicate prevention, fail-closed ambiguous/stalled handling, and privacy-safe provider errors. This run did not alter or live-test the adapter.
- **Control-plane concurrency:** callback logical identity and owner-decision call linkage are reserved before provider awaits, with matching deterministic evidence for both in-memory and SQLite stores in the supported single-instance topology.
- **Shared surfaces:** HTTP, TypeScript SDK, stdio MCP, lifecycle worker, and deployment verification continue to share the same persistent control-plane semantics rather than adapter-specific state machines.
- **Claude Code:** the built stdio MCP process is exercised as a real external child and the documented host acceptance matches the tested lifecycle. An actual Claude Code host session still has not been observed and must not be claimed.
- **Live status:** no authorized real CALL-E phone call has been performed, so live provider/phone/webhook success remains unverified.

## Current blockers / external prerequisites

No repository-development blocker prevents further useful work.

A true Claude Code host acceptance requires an actual Claude Code environment/CLI to register and exercise the built stdio MCP server.

Live CALL-E verification still requires user-controlled prerequisites: a valid/authorized CALL-E credential, an authorized owner phone destination, and stable public HTTPS webhook ingress configured with the application-owned webhook capability token.

## Highest-value next actions

1. Re-audit concurrent ambiguous-call recovery. In particular, test whether lifecycle recovery and explicit reconciliation can enter `recoverCallAttempt` for the same ambiguous attempt at the same time before either provider replay returns. If the race is reproducible, add a durable single-flight/claim transition that preserves the rule that provider I/O stays outside the database transaction and that every replay uses the original idempotency key.
2. Audit concurrent terminal polling/webhook application and lifecycle stale marking for any remaining stale-object overwrites or duplicate audit transitions under asynchronous interleavings, while preserving the existing shared `applyTerminalOutcome` convergence path.
3. Document fake-provider `rehydrate` behavior more explicitly in `docs/ARCHITECTURE.md`, separating deterministic process-local reconstruction from production CALL-E's remotely durable provider call identity.
4. Continue auditing model-/operator-facing diagnostics and read projections for accidental task-context, owner-phone, bearer-token, webhook-token, callback-prompt, or instruction disclosure.
5. Run the documented acceptance in a genuine Claude Code host when that external prerequisite is available and record only observed host/version behavior.
6. When the user-controlled CALL-E prerequisites are available, perform one tightly bounded live provider acceptance and record only observed behavior.
