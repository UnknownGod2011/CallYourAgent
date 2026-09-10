# CallYourAgent progress

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. Agents can escalate important decisions without freezing unrelated scopes; owners can independently request callbacks for progress/questions/steering; human input is persisted as structured state and consumed only at explicit safe checkpoints rather than pretending to interrupt in-flight model generation.

The repository includes deterministic fake and production CALL-E providers, SQLite persistence, replayable/idempotent call attempts, polling/webhook convergence, branch-scoped blocking, owner decision persistence, durable per-run instruction queues, exact instruction acknowledgement, quiet hours/call budgets, bounded lifecycle recovery, fail-closed ambiguous/stalled handling, privacy-aware audit history, scoped HTTP authentication, a typed TypeScript client, a real stdio MCP adapter, deterministic end-to-end/demo flows, an operator console, a Claude Code host-acceptance runbook, and a single-instance persistent-volume Compose reference deployment.

This run hardened the initial owner-decision request boundary. Escalation creation, its idempotency mapping, and the causal `escalation_created` audit event now form one local atomic durability unit before policy evaluation or provider dispatch. A failed request can no longer leave a phantom blocking escalation or orphaned idempotency mapping behind. Provider/CALL-E network I/O remains outside database transactions.

## Exact repo state inspected this run

The run started from `main` HEAD `8489b81b6283d3112b8dbe9bb9fa2253e1fdf923`, immediately after PR #15 made escalation expiry, policy deferral, and policy release/call reservation atomic with their causal audit history.

Before making changes, inspected the complete recursive repository tree and current architecture, recent commits, issues, and pull requests. There were no open issues or PRs at the start of the run. Recent commits and merged PRs were reviewed through PR #15, covering call reservation/idempotency, ambiguous-recovery single-flight, webhook/poll races, accepted-call stale handling, lifecycle atomicity, restart guarantees, provider-identity preservation, atomic terminal polling, atomic active-provider progress, production CALL-E restart semantics, and escalation-policy atomicity.

Read in full before changing code:

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
- `docs/PROVIDER_RESTART_SEMANTICS.md`
- `deploy/README.md`

Also inspected the relevant implementation/reliability surfaces, especially `src/control-plane.ts`, `src/store.ts`, `src/sqlite-store.ts`, `package.json`, the tests directory, and the existing SQLite failure-injection patterns in `tests/sqlite-escalation-policy-atomicity.test.ts`.

The audit reproduced a real local consistency hazard in `requestOwnerDecision`: the new `Escalation`, `escalationByIdempotencyKey` mapping, and `escalation_created` event were three separate SQLite writes. If the mapping or audit write failed after escalation persistence, the request could throw while durable state still contained a partially created blocking escalation or incomplete idempotency history. That partial escalation could then appear in `unresolvedBlockingScopes` even though the caller observed request failure.

## Changes made this run

PR #16, `Make initial owner decision creation atomic`, changed only `src/control-plane.ts` plus one focused new regression file.

### Initial owner-decision creation atomicity

`requestOwnerDecision` now enters `store.transaction(...)` for the local creation boundary. Inside that transaction it:

1. rechecks the stable escalation idempotency key;
2. returns the existing durable escalation immediately when the key is already reserved;
3. otherwise persists the new pending escalation;
4. persists the `escalationByIdempotencyKey` mapping;
5. records the privacy-safe `escalation_created` audit event.

Only after that transaction commits does normal call-policy evaluation run. If policy allows a call, the existing call-reservation transaction and later provider dispatch continue unchanged. No CALL-E/provider request is made while the initial creation transaction is open.

### SQLite failure-injection regressions

Added `tests/sqlite-decision-creation-atomicity.test.ts` with two deterministic regressions:

1. an injected `escalation_created` audit failure proves the escalation row and idempotency mapping both roll back; no call attempt exists, no creation event exists, and the failed blocking request leaves no unresolved blocking scope. Retrying the same logical request then creates exactly one escalation/call chain, and another idempotent retry returns the same escalation without duplicate calls or audit events;
2. an injected `escalationByIdempotencyKey` persistence failure proves the already-written escalation row rolls back too. Retry then succeeds with one mapping, one escalation, one call attempt, one creation event, and the expected branch-specific blocked scope.

The production change is intentionally small: it moves only the existing local creation operations into the store's established synchronous transaction boundary and moves the idempotency lookup inside that same boundary. No provider contract, public HTTP/MCP contract, or domain schema was changed.

## Verification performed

Direct repository execution in the automation container remains unavailable because that network namespace cannot resolve `github.com`, so verification used the repository's GitHub Actions execution surfaces.

The substantive PR #16 head `ba81b70f5e5a395c18c51bc090f13f09223adb01` passed every repository verification surface before merge:

- CI run `34419769431` — **success**. Node `24.20.0`; locked dependencies installed; TypeScript no-emit typecheck succeeded; build succeeded; Node test suite finished with **133 tests, 133 passed, 0 failed, 0 skipped/cancelled/todo**. Both new SQLite decision-creation rollback/retry regressions passed explicitly.
- Container run `34419769439` — **success**.
- Compose deployment run `34419769331` — **success**, preserving the full reference deployment acceptance around generated least-privilege credentials, durable SQLite, compiled stdio MCP, decision/callback restart recovery, branch-specific release, exactly-once steering, persistence restart, and safe-checkpoint consumption.

`package.json` still has no separate lint script and no standalone migration/schema-check command. The normal `npm run check` path covers typechecking/build/tests; SQLite tests execute the durable schema/transaction path; Container and Compose cover production image/runtime/deployment behavior.

PR #16 was squash-merged as `91c299034dbe710be42c0af923609f7b2d518111`.

No live CALL-E phone call was attempted or claimed.

## Architecture decisions made this run

1. A successful owner-decision request should exist durably only when its escalation row, stable idempotency mapping, and causal creation audit have committed together.
2. The idempotency lookup belongs inside the same local creation transaction so retry/convergence is evaluated against the same durability boundary that reserves the request.
3. A local persistence failure must not create a phantom branch block. Until the initial creation transaction commits, the request has not become part of the durable agent-control state machine.
4. Policy evaluation and all provider/CALL-E network work remain outside this transaction. The transaction protects local orchestration truth only; it does not hold SQLite locks over external I/O.
5. Existing branch/scope semantics remain unchanged after a successful request: a blocking escalation affects only its own scope, while unrelated agent work can continue.
6. No new distributed/multi-instance claim is introduced; the supported durable topology remains one control-plane process with SQLite.

## CALL-E integration status

- **Fake provider:** deterministic, credential-free, idempotent, restart-rehydratable from durable accepted-call state, and still the primary full-flow development/acceptance provider.
- **Production CALL-E adapter:** implemented against the asynchronous Calls API with server-only `CALLE_API_KEY`, stable `Idempotency-Key`, structured result schemas, bounded create/poll requests, persisted correlation, polling/webhook convergence, duplicate prevention, restart-by-provider-id semantics, and fail-closed ambiguous/stalled handling. This run did not change the provider contract.
- **Shared surfaces:** HTTP, TypeScript SDK, stdio MCP, lifecycle worker, operator console, and deployment flows continue to share the same persistent control-plane state machine.
- **Claude Code:** compiled stdio MCP behavior remains covered by repository/deployment tests and the host-acceptance runbook remains valid. A genuine Claude Code host session has not yet been observed and is not claimed.
- **Live status:** no authorized real CALL-E phone call has been performed, so live provider connectivity, owner-phone authorization, and public webhook success remain unverified.

## Current blockers / external prerequisites

No repository-development blocker prevents further useful work.

A true Claude Code host acceptance requires an actual Claude Code environment/CLI to register and exercise the compiled stdio MCP server.

Live CALL-E verification still requires user-controlled prerequisites: a valid/authorized CALL-E credential, an authorized owner phone destination, and stable public HTTPS webhook ingress configured with the application-owned webhook capability token.

## Highest-value next actions

1. Audit owner-callback request/start causal bookkeeping under local SQLite failures. `requestOwnerCallback` already reserves the callback attempt and idempotency mapping atomically before provider creation, and accepted provider identity is protected from audit failures, but `owner_callback_requested` is recorded afterward. Determine whether failure/restart at that boundary can leave materially misleading causal history and harden only if a real inconsistency is reproducible without risking provider-create replay.
2. Audit the remaining simple state-plus-audit write boundaries such as agent registration, run start/status heartbeat, and direct API instruction enqueue. Prioritize only boundaries where failure injection demonstrates a durable state-machine or operator-history inconsistency rather than mechanically wrapping every write.
3. Continue provider/result privacy audits for accidental task context, callback prompt, decision answer, instruction text, owner phone, API credential, or webhook-token disclosure.
4. Run the documented acceptance in a genuine Claude Code host when that external prerequisite is available and record only observed host/version behavior.
5. When the user-controlled CALL-E prerequisites are available, perform one tightly bounded live provider acceptance and record only observed behavior.
