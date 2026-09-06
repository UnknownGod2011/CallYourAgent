# progress.md

## Current status

Architecture-first TypeScript control-plane implementation is in place, with deterministic fake-provider behavior, a production CALL-E provider adapter, and durable recovery semantics for ambiguous call creation. The repository now preserves the exact logical phone request before provider invocation so uncertain network/process outcomes can be safely retried under the same idempotency key rather than orphaning an escalation or callback.

## Inspected this run

- Full recursive repository tree before changes.
- `AGENTS.md` in full.
- `progress.md` in full.
- `README.md` in full.
- `docs/ARCHITECTURE.md` in full.
- `docs/INTEGRATIONS.md` in full.
- Core source files, especially `domain.ts`, `store.ts`, `call-provider.ts`, `calle-provider.ts`, and `control-plane.ts`.
- Existing control-plane tests and TypeScript configuration.
- Recent commit history on `main`.
- Open GitHub issues endpoint: none present.

## Previously implemented

- Typed agent/run/escalation/decision/instruction/call-attempt domain model.
- `ControlPlaneStore` abstraction and deterministic `InMemoryControlPlaneStore`.
- `CallProvider` port and deterministic `FakeCallProvider` with provider-side idempotency behavior.
- `ControlPlane` operations for registration, run start/status, blocking and non-blocking escalations, owner callbacks, durable owner instructions, checkpoint consumption, branch/scope blocking, decision reconciliation, and duplicate request prevention.
- End-to-end fake-provider tests covering non-blocking continuation, branch-specific blocking, decision resolution, callback steering, checkpoint consumption, and idempotency.
- Production `CalleCallProvider` mapping to CALL-E's asynchronous create/get APIs with server-side auth, stable `Idempotency-Key`, recipient phone, correlation metadata, optional webhook URL, and purpose-specific structured result schemas.
- Deterministic provider-level tests for CALL-E request/response mapping.
- Architecture and integration-boundary documentation.

## Implemented this run

- Extended `CallAttempt` with a persisted replayable request payload containing the exact phone task and metadata used for provider creation.
- Added `lastError` to ambiguous call attempts so transport uncertainty is observable without discarding the original recoverable request.
- Changed call-start orchestration so provider exceptions no longer orphan the domain operation. The call attempt is retained as `ambiguous` and returned to the caller, allowing the escalation/callback to remain durably linked to it.
- Added public `ControlPlane.recoverCallAttempt(callAttemptId)` behavior. It replays the exact original logical call using the exact same purpose, task, metadata, and stable idempotency key. Success records the provider call id and clears the prior error; another transport failure leaves the attempt safely ambiguous.
- `reconcileEscalation()` and `reconcileCallback()` now automatically try recovery when they encounter an ambiguous create attempt before attempting terminal outcome reconciliation.
- Blocking semantics remain correct during provider uncertainty: an affected blocking scope stays blocked, while unrelated/non-blocking work remains free to continue.
- Added a regression test simulating a network/socket failure on the first create call and verifying the persisted escalation stays linked to an ambiguous attempt, then recovery reuses exactly `decision:recoverable-decision` rather than generating a new idempotency key.
- Updated `docs/ARCHITECTURE.md` to explicitly document persisted request replay and why an unknown create-call result must not be treated as a known failure.

## Architecture decisions

1. Ambiguous provider creation is a first-class durable state, not an exception path that may lose correlation.
2. The exact logical provider request required for replay must be stored before the external side effect begins.
3. Recovery reuses the same provider idempotency key. It must never create a new key merely because the local process failed to receive the original response.
4. Escalations/callbacks remain linked to ambiguous attempts so a future SQL-backed process can recover after restart.
5. The control plane remains the source of truth; CALL-E remains a replaceable phone transport.
6. Live CALL-E success is still not claimed without authorized credentials and an observed real call.

## Verification performed

- Reviewed the updated domain/control-plane state transitions directly in the GitHub repository after writes.
- Added a deterministic unit test for ambiguous-create recovery and exact idempotency-key reuse.
- Re-attempted a clean `git clone` followed by dependency installation and `npm run check` in the execution container. Checkout again failed before dependency installation because DNS could not resolve `github.com` (`Could not resolve host: github.com`). Therefore TypeScript compilation/tests are still **not claimed as executed successfully** in this environment.
- GitHub API reads/writes succeeded throughout this run.

## CALL-E integration status

- Fake provider: implemented.
- Production CALL-E HTTP provider: implemented.
- Server-only API key handling: implemented by provider configuration and `.env.example` convention.
- Stable provider idempotency key propagation: implemented.
- Polling terminal reconciliation: implemented.
- Purpose-specific structured decision/callback results: implemented.
- Ambiguous create-call persistence and same-key recovery: implemented at the control-plane/domain layer.
- Webhook receiver + event-id deduplication: not yet implemented.
- Durable SQL persistence: not yet implemented.
- Live CALL-E call: not attempted because no credential/authorized phone is available to this run.

## Current blockers

No product-design blocker and no blocker to continued repository development.

Environment-only verification limitation: this execution container still cannot resolve `github.com`, preventing clean checkout/dependency installation and therefore preventing an actual local `tsc`/Node test run here.

## Highest-value next actions

1. Add webhook ingestion semantics with event-id deduplication and terminal-call reconciliation that shares one transition path with polling, preventing duplicate decisions/instructions.
2. Add a durable SQL-backed store with transactional unique constraints for escalation/callback idempotency, provider call ids, webhook event ids, and instruction consumption; ensure persisted `CallAttempt.request` is included so ambiguous replay survives process restart.
3. Add a minimal HTTP service over the control-plane methods and configuration bootstrap selecting fake vs CALL-E provider from environment.
4. Add MCP tools as a thin adapter over the same core/HTTP semantics.
5. Build a small TypeScript SDK for generic agents and then the first real Claude/Claude Code MCP/checkpoint integration.
6. Add quiet hours, call budgets, retry bounds, expiration sweep behavior, and audit events before broadening UI scope.
7. As soon as an environment with package/network access is available, run `npm run check` and fix any TypeScript/runtime issues before expanding aggressively.
