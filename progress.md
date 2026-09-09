# CallYourAgent progress

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. Agents can escalate important decisions without freezing unrelated scopes; owners can independently request callbacks for progress/questions/steering; human input is persisted as structured state and consumed only at explicit safe checkpoints rather than pretending to interrupt in-flight model generation.

The repository includes deterministic fake and production CALL-E providers, SQLite persistence, replayable/idempotent call attempts, polling/webhook convergence, branch-scoped blocking, owner decision persistence, durable per-run instruction queues, exact instruction acknowledgement, quiet hours/call budgets, bounded lifecycle recovery, fail-closed ambiguous/stalled handling, privacy-aware audit history, scoped HTTP authentication, a typed TypeScript client, a real stdio MCP adapter, deterministic end-to-end/demo flows, an operator console, a Claude Code host-acceptance runbook, and a single-instance persistent-volume Compose reference deployment.

This run fixed a real duplicate-call safety hazard at the provider-start boundary. Previously, `dispatchCallAttempt()` and `recoverCallAttempt()` wrapped both provider `start()` and the subsequent local state/audit writes in the same `try/catch`. If CALL-E/fake-provider successfully returned a concrete provider call id but the local `call_attempt_started` audit write then threw, the code could misclassify that local failure as a provider ambiguity and overwrite the known provider identity. A later recovery could then replay provider create despite the control plane having already received an accepted provider id. Provider/network failure handling is now deliberately separated from post-provider persistence/audit handling: only a failure from `CallProvider.start()` can create an `ambiguous` attempt. Once a concrete provider id has been returned, that identity is persisted and is never erased or relabeled ambiguous merely because audit recording fails.

## Exact repo state inspected this run

The run started from `main` HEAD `06461f0d34abb233e7526dfcfde21dc9570df1b0`, the merge of PR #10 proving lifecycle recovery metadata/restart guarantees.

Before making any change, inspected the full recursive repository tree and current source/test architecture, recent commits, relevant issues, and pull requests. There were no open issues. Prior PRs #1-#10 covered transactional call reservation, ambiguous-recovery single-flight, recovery/webhook precedence, stale poll/webhook protection, provider-acceptance timeout semantics, SQLite in-flight provider-create coverage, lifecycle stale-sweep races, lifecycle state/audit atomicity, and recovery restart guarantees.

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

Also inspected the complete `src/control-plane.ts`, the lifecycle atomicity/restart tests, the CALL-E/fake provider types, the SQLite store semantics, and the repository CI/Compose verification architecture. Direct unauthenticated cloning from the automation container remained unavailable because that runtime could not resolve `github.com`, so repository reads/writes, PR work, CI inspection, and merge operations used the authenticated GitHub integration. This did not block implementation or external verification.

## Changes made this run

### Provider-start error boundary hardening

Changed both initial dispatch and ambiguous recovery so `CallProvider.start()` has a narrow provider/network `try/catch`.

For an actual provider/network exception:

- the attempt remains/enters `ambiguous`;
- the exact original replayable request and idempotency key remain durable;
- the privacy-safe ambiguity audit is attempted normally.

For a successful provider start:

- the returned `providerCallId` and accepted state are persisted first;
- the matching `call_attempt_started` audit is then written;
- if that local audit write fails, the error may surface to the caller, but the known provider identity is not erased, not rewritten as `ambiguous`, and not eligible for another provider-create replay simply because observability failed.

This ordering is intentional. A concrete provider identity is safety-critical real-world side-effect state; an audit event is important operational metadata but must not be allowed to destroy evidence that a phone side effect was already accepted.

### Deterministic SQLite failure-injection regressions

Added `tests/sqlite-provider-start-audit-failure.test.ts` with two regressions.

1. **Initial provider acceptance + failed started audit**
   - provider start succeeds exactly once;
   - `call_attempt_started` audit insertion is deliberately failed;
   - the API operation rejects with the injected local error;
   - the durable callback attempt still retains its concrete provider id and accepted `queued` status;
   - it is not rewritten to `ambiguous` and has no fake provider-error `lastError`;
   - retrying the same callback idempotency key returns the same attempt and performs zero additional provider starts;
   - close/reopen proves the accepted provider identity survives SQLite restart.

2. **Ambiguous recovery succeeds + failed recovery-started audit**
   - the initial create becomes ambiguous;
   - replay with the same logical idempotency key successfully returns a provider id;
   - `call_attempt_started` audit insertion is deliberately failed;
   - the durable attempt still becomes accepted/non-ambiguous with that provider id;
   - a subsequent recovery call does not invoke provider `start()` again;
   - close/reopen proves the recovered provider identity remains durable.

The implementation was merged through PR #11 with a focused final diff: 31 production-line changes plus the new regression file. Intermediate branch experiments were squash-merged so `main` receives only the coherent final state.

## Verification performed

The final PR #11 head `6def1861ae9b9f4fc2c8fd842adb645f1fc19d58` passed every repository verification surface before merge:

- CI run `34393094376` — **success**. GitHub Actions used Node `24.20.0`, installed locked dependencies, completed TypeScript typecheck and build, and passed **122/122 tests** with 0 failures, 0 cancelled, and 0 skipped. Both new provider-start/audit failure regressions passed.
- Container run `34393094394` — **success**. The production image build/runtime smoke remained green.
- Compose deployment run `34393094391` — **success**. The full reference deployment acceptance remained green, including generated least-privilege credentials, authenticated HTTP control plane, the real compiled stdio MCP process, restart during an active owner-decision call, branch-specific release, restart during an active owner callback, exactly-once steering, another persistence restart, and safe-checkpoint instruction consumption.

PR #11 was squash-merged to `main` as `c5e77a193ca1f9686f3d88bdcbc5ef9856281d1b`.

`package.json` still has no separate lint script and no standalone migration/schema-check command. `npm run check` covers typechecking/build/tests; SQLite tests execute the durable schema/transaction path; Container and Compose cover production runtime/deployment behavior.

No live CALL-E phone call was attempted or claimed.

## Architecture decisions made this run

1. Only uncertainty/failure from the provider side-effect request itself may transition a create/recovery to `ambiguous`. A local audit/storage exception after the provider returned a concrete id is not provider ambiguity.
2. A returned `providerCallId` is safety-critical evidence that the real-world side effect was accepted. Once known, it must not be rolled back merely to preserve audit atomicity.
3. Provider I/O remains outside SQLite transactions. No database transaction is held across CALL-E network work.
4. For provider-start acceptance, durable provider identity takes precedence over perfect audit coupling. It is safer to surface an operational audit failure while preserving the known call identity than to erase that identity and risk a duplicate phone call.
5. Stable callback/escalation idempotency reservations remain the first local duplicate-prevention layer; provider-side idempotency remains the second layer.
6. Ambiguous recovery remains single-flight inside the supported single-instance process, and a recovered non-ambiguous attempt is no longer eligible for another create replay.
7. Existing branch/scope blocking, owner-decision exactly-once behavior, callback steering queues, and safe-checkpoint semantics are unchanged.
8. The supported durable topology remains one control-plane process backed by SQLite; this work does not claim multi-instance/distributed safety.
9. Fake-provider evidence remains separate from live CALL-E evidence.

## CALL-E integration status

- **Fake provider:** deterministic, credential-free, idempotent, restart-rehydratable from durable accepted-call state, and exercised across the full control-plane/lifecycle/SQLite test suite. This run additionally failure-injects local observability errors after fake-provider acceptance and proves provider identity is not lost or replayed.
- **Production CALL-E adapter:** implemented against the asynchronous Calls API with server-only `CALLE_API_KEY`, stable `Idempotency-Key`, structured result schemas, bounded create/poll requests, persisted correlation, polling/webhook convergence, duplicate prevention, fail-closed ambiguous/stalled handling, and privacy-safe provider errors. This run changed the provider-independent control-plane boundary, not the CALL-E adapter itself.
- **Control-plane concurrency/durability:** logical callback/decision call identities are reserved before provider awaits; accepted provider identities survive local started-audit failures; ambiguous recovery is single-flight per durable call attempt within the supported process; recovery and ordinary polling re-check durable state after provider I/O; terminal webhook precedence is covered against ambiguous recovery, stale direct polls, and overdue lifecycle sweeps.
- **Shared surfaces:** HTTP, TypeScript SDK, stdio MCP, lifecycle worker, operator/deployment paths continue to share one persistent control-plane state machine rather than adapter-specific behavior.
- **Claude Code:** the built stdio MCP process is exercised as a real external child in repository/deployment tests and the host-acceptance runbook remains aligned. An actual Claude Code host session still has not been observed and must not be claimed.
- **Live status:** no authorized real CALL-E phone call has been performed, so live provider connectivity, owner-phone authorization, and public webhook success remain unverified.

## Current blockers / external prerequisites

No repository-development blocker prevents further useful work.

A true Claude Code host acceptance requires an actual Claude Code environment/CLI to register and exercise the built stdio MCP server.

Live CALL-E verification still requires user-controlled prerequisites: a valid/authorized CALL-E credential, an authorized owner phone destination, and stable public HTTPS webhook ingress configured with the application-owned webhook capability token.

## Highest-value next actions

1. Audit the **polling terminal-outcome atomicity boundary**. Webhook reconciliation already wraps terminal call state, owner decision/instruction creation, provider-event recording, and audit in one store transaction, but direct/lifecycle polling currently invokes `applyTerminalOutcome` outside an outer transaction. Failure-inject audit/instruction/decision writes during a terminal poll and determine whether a call can become durably terminal before its owner decision or callback steering is persisted; if reproducible, transactionally couple those local post-poll mutations without placing provider network I/O inside the transaction.
2. Audit `applyActiveObservation` state + audit failure behavior. Because this transition has no new phone side effect, atomic rollback may be appropriate if failure injection shows misleading durable progress state.
3. Add explicit architecture documentation distinguishing fake-provider `rehydrate` reconstruction from production CALL-E's remotely durable provider state.
4. Continue operator/model-facing privacy audits for accidental task-context, owner-phone, bearer-token, webhook-token, callback-prompt, or instruction disclosure.
5. Run the documented acceptance in a genuine Claude Code host when that external prerequisite is available and record only observed host/version behavior.
6. When the user-controlled CALL-E prerequisites are available, perform one tightly bounded live provider acceptance and record only observed behavior.
