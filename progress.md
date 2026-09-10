# CallYourAgent progress

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. Agents can escalate important decisions without freezing unrelated scopes; owners can independently request callbacks for progress/questions/steering; human input is persisted as structured state and consumed only at explicit safe checkpoints rather than pretending to interrupt in-flight model generation.

The repository includes deterministic fake and production CALL-E providers, SQLite persistence, replayable/idempotent call attempts, polling/webhook convergence, branch-scoped blocking, owner decision persistence, durable per-run instruction queues, exact instruction acknowledgement, quiet hours/call budgets, bounded lifecycle recovery, fail-closed ambiguous/stalled handling, privacy-aware audit history, scoped HTTP authentication, a typed TypeScript client, a real stdio MCP adapter, deterministic end-to-end/demo flows, an operator console, a Claude Code host-acceptance runbook, and a single-instance persistent-volume Compose reference deployment.

This run hardened the owner-requested callback creation boundary. The callback call-attempt reservation, callback idempotency mapping, `call_attempt_created`, and causal `owner_callback_requested` audit now commit as one local durability unit before any provider side effect. A local audit/persistence failure therefore cannot result in an accepted phone call whose durable history permanently lacks the owner request. Provider/CALL-E network I/O remains outside database transactions.

## Exact repo state inspected this run

The run started from `main` HEAD `325a420fd5d133e5e21fbcbe6f8318c87ab847f8`, immediately after PR #16 and its progress handoff made initial owner-decision creation atomic.

Before making any change, inspected the complete recursive repository tree and current architecture, recent commits, relevant issues, and pull requests. There were no open issues at the start. Recent merged work through PR #16 was reviewed, including call reservation/idempotency, ambiguous-recovery single-flight, webhook/poll races, stale accepted-call handling, lifecycle atomicity, restart guarantees, provider-identity preservation, atomic terminal polling, atomic active-provider progress, production CALL-E restart semantics, escalation-policy atomicity, and atomic initial owner-decision creation.

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

Also inspected the relevant implementation and reliability surfaces, especially `src/control-plane.ts`, `src/call-provider.ts`, the callback/audit restart tests, the stdio MCP callback restart test, and the Compose stdio deployment acceptance script.

The audit reproduced a real causal-history gap in `requestOwnerCallback`: callback reservation and idempotency mapping were transactional, but `owner_callback_requested` was written only after `dispatchCallAttempt`. If the provider had already returned a concrete call id and the later local callback-request audit write failed, the accepted provider identity was correctly retained by earlier reliability work, but an idempotent retry returned the existing callback immediately. That meant the owner request event could remain missing forever even though a real call had been accepted.

## Changes made this run

PR #17, `Make owner callback request reservation atomic`, changed the callback creation boundary and added focused regression/acceptance coverage.

### Owner callback causal reservation atomicity

`requestOwnerCallback` now commits these local facts in one `store.transaction(...)` before provider dispatch:

1. stable callback idempotency lookup/reservation;
2. the durable `CallAttempt` row;
3. the callback idempotency mapping;
4. `call_attempt_created`;
5. `owner_callback_requested`.

Only after that transaction succeeds does `dispatchCallAttempt` invoke the fake or CALL-E provider. This gives the audit timeline the intentional causal ordering:

`call_attempt_created -> owner_callback_requested -> call_attempt_started -> terminal outcome -> owner_instruction_queued`.

If the local reservation/audit transaction fails, it rolls back completely and no provider call is attempted. Existing idempotent retries still return the same already-created callback and do not start another provider call.

### SQLite failure-injection regression

Added `tests/sqlite-callback-request-atomicity.test.ts`.

The test injects one failure while persisting `owner_callback_requested` and proves:

- `requestOwnerCallback` rejects;
- provider `start()` count remains exactly zero;
- no call attempt remains;
- no callback idempotency mapping remains;
- neither `call_attempt_created` nor `owner_callback_requested` survives the rollback;
- retrying the same logical callback succeeds with one provider start and one durable callback;
- another idempotent retry returns the same callback and does not produce another provider start or callback-request event.

### Causal-order acceptance updates

Updated the existing callback audit timeline, restart recovery, long-lived stdio MCP restart, Compose deployment acceptance, and Claude Code host-acceptance expectations to the stronger request-before-provider ordering. No public HTTP, MCP, SDK, CALL-E provider, or schema contract changed.

The first CI pass correctly caught two existing restart tests that still asserted the old `call_attempt_started -> owner_callback_requested` order. After those were corrected, CI passed. The second Compose pass independently caught the same stale ordering in `tests/mcp-stdio-deployment-acceptance.ts`; after that acceptance assertion was corrected, the full Compose workflow passed. These failures were test/acceptance expectation drift caused by the intentional causal-order change, not provider/runtime failures.

## Verification performed

Direct repository execution in the automation container remains unavailable because that environment cannot resolve `github.com`, so verification used the repository's GitHub Actions surfaces.

Final substantive PR #17 head `2835097be2f4043ee80effb9abe0638758fdbcac` passed every repository verification surface before merge:

- CI run `34424521152` — **success**. Node `24.20.0`; locked dependencies installed; TypeScript no-emit typecheck succeeded; build succeeded; Node test suite finished with **134 tests, 134 passed, 0 failed, 0 skipped/cancelled/todo**. The new SQLite callback-request rollback/retry regression passed explicitly.
- Container run `34424521137` — **success**.
- Compose deployment run `34424521133` — **success**, preserving generated least-privilege credentials, validated Compose configuration, healthy fake-provider runtime, real compiled stdio MCP, durable SQLite, restart during the branch-blocking owner decision, branch-specific release, owner-requested callback, restart during the active callback, exactly-once callback reconciliation/steering, another persistence restart, and safe-checkpoint instruction acknowledgement.

Intermediate verification history was also preserved rather than ignored:

- CI run `34424219491` failed only because two older restart tests encoded the previous callback audit ordering; the new atomicity regression itself passed.
- Container run `34424219285` succeeded.
- Compose run `34424219407` failed before later scenario steps because the same old audit-order assertion was still present downstream.
- After the first assertion fixes, CI `34424365381` and Container `34424364984` succeeded, while Compose `34424364741` exposed the remaining stale ordering assertion in the deployment acceptance script.
- After that final acceptance update, all three final workflows succeeded as listed above.

`package.json` still has no separate lint script and no standalone migration/schema-check command. `npm run check` covers typechecking/build/tests; SQLite tests exercise the durable schema/transaction path; Container and Compose exercise production image/runtime/deployment behavior.

PR #17 was squash-merged as `7c22c3588e9f9e33d813683e09d5787ca393ab13`.

No live CALL-E phone call was attempted or claimed.

## Architecture decisions made this run

1. An owner-requested callback must not begin its external phone side effect until the local callback reservation, stable idempotency mapping, and causal owner-request audit have committed together.
2. `owner_callback_requested` semantically records the owner's durable request, not provider acceptance, so it belongs before `call_attempt_started` in the audit timeline.
3. A local failure before provider dispatch should fail closed: zero durable callback reservation and zero provider calls. This is safer than trying to reconstruct a missing causal event after an external side effect has already begun.
4. Provider/CALL-E network I/O remains outside SQLite transactions. The transaction protects only local orchestration truth and never holds a database transaction over external I/O.
5. Existing provider-identity safety remains unchanged: once provider acceptance returns a concrete identity, later local start-audit failures do not convert that known acceptance into ambiguous provider state.
6. Existing branch/scope and safe-checkpoint semantics are unchanged; callbacks do not block unrelated agent work and callback steering remains queued until an explicit checkpoint/acknowledgement.
7. No distributed/multi-instance claim is introduced; the supported durable reference topology remains one control-plane process with SQLite.

## CALL-E integration status

- **Fake provider:** deterministic, credential-free, idempotent, restart-rehydratable from durable accepted-call state, and still the primary full-flow development/acceptance provider. The complete callback creation/restart/steering path passed again in CI and Compose.
- **Production CALL-E adapter:** implemented against the asynchronous Calls API with server-only `CALLE_API_KEY`, stable `Idempotency-Key`, structured result schemas, bounded create/poll requests, persisted correlation, polling/webhook convergence, duplicate prevention, restart-by-provider-id semantics, and fail-closed ambiguous/stalled handling. This run did not alter its external contract.
- **Shared surfaces:** HTTP, TypeScript SDK, stdio MCP, lifecycle worker, operator console, and deployment flows continue to share the same persistent control-plane state machine.
- **Claude Code:** compiled stdio MCP behavior remains covered by automated and deployment tests. `docs/CLAUDE_CODE_ACCEPTANCE.md` now explicitly expects the durable owner callback request event before provider-start acceptance. A genuine Claude Code host session has still not been observed and is not claimed.
- **Live status:** no authorized real CALL-E phone call has been performed, so live provider connectivity, owner-phone authorization, and public webhook success remain unverified.

## Current blockers / external prerequisites

No repository-development blocker prevents further useful work.

A true Claude Code host acceptance requires an actual Claude Code environment/CLI to register and exercise the compiled stdio MCP server.

Live CALL-E verification still requires user-controlled prerequisites: a valid/authorized CALL-E credential, an authorized owner phone destination, and stable public HTTPS webhook ingress configured with the application-owned webhook capability token.

## Highest-value next actions

1. Audit remaining simple state-plus-audit boundaries, especially `registerAgent`, `startRun`, `heartbeat`, and direct `enqueueInstruction`, using SQLite failure injection. Prioritize only cases where a failed audit can leave materially misleading durable state or affect idempotency/safe-checkpoint behavior rather than wrapping writes mechanically.
2. Audit callback reservation concurrency at the exact local-commit/provider-start boundary to ensure concurrent idempotent owner requests cannot cause duplicate `dispatchCallAttempt` calls under any supported re-entrant path; add production logic only if a reproducible race exists.
3. Continue provider/result privacy audits for accidental task context, callback prompt, decision answer, instruction text, owner phone, API credential, or webhook-token disclosure.
4. Run the documented acceptance in a genuine Claude Code host when that external prerequisite is available and record only observed host/version behavior.
5. When the user-controlled CALL-E prerequisites are available, perform one tightly bounded live provider acceptance and record only observed behavior.
