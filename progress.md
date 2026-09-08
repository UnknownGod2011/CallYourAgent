# CallYourAgent progress

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. Agents can raise important owner decisions without freezing unrelated scopes; owners can independently request callbacks for progress/questions/steering; human input is persisted and consumed only at explicit safe checkpoints rather than pretending to interrupt in-flight model generation.

The repository includes SQLite persistence, deterministic fake and production CALL-E providers, replayable/idempotent call attempts, polling/webhook convergence, scoped authenticated HTTP APIs, a typed TypeScript client, stdio MCP, branch-scoped blocking, call policy/quiet hours/budgets, privacy-aware audit history, bounded lifecycle recovery, fail-closed ambiguous/stalled handling, API abuse controls, graceful shutdown, bounded CALL-E HTTP requests, readiness/liveness surfaces, deterministic end-to-end and operator demos, a production Docker image, and a single-instance persistent-volume Compose deployment.

This run hardened the owner/browser callback boundary. Callback creation and ordinary callback reads now expose only a minimal operational `OwnerCallbackView`; the exact phone task, provider correlation, idempotency material, and recovery state remain durable inside the trusted control plane for safe reconciliation/recovery.

## Exact repo state inspected this run

Before making changes, inspected the recursive `main` repository tree at HEAD `4312af5bec9e5099e1be9eb6d91a2c61de68d948`, covering root files, GitHub workflows, deployment assets, documentation, source, and tests. Inspected recent commits and checked issues/pull requests; there were no open issues and no relevant open PRs.

Read `AGENTS.md`, this file, `README.md`, `docs/ARCHITECTURE.md`, `docs/INTEGRATIONS.md`, `docs/API_SECURITY.md`, `docs/CALL_POLICY.md`, `docs/DEPLOYMENT.md`, `docs/OPERATOR_CONSOLE.md`, and `deploy/README.md` before editing.

Inspected the callback/security implementation and tests in `src/http-server.ts`, `src/client.ts`, `src/domain.ts`, `src/control-plane.ts`, `src/mcp-server.ts`, `src/index.ts`, `src/operator-demo.ts`, `tests/http-server.test.ts`, `tests/client.test.ts`, `tests/run-overview-http.test.ts`, `tests/sqlite-owner-callback-http-restart.test.ts`, and `tests/operator-owner-credential.test.ts`, plus the complete tests directory listing.

The previous run had already established SQLite restart durability for owner callbacks and identified the next privacy gap: `POST /v1/callbacks` and `GET /v1/callbacks/:id` returned the full persisted `CallAttempt`, including a replayable `request.task` that can contain current agent status/scope and the owner's prompt.

## Changes made this run

### Privacy-safe owner callback DTO

Added `src/callback-view.ts` with exported `OwnerCallbackView` and `toOwnerCallbackView`.

The ordinary owner/read representation contains only:

- callback `id`;
- `runId`;
- operational `status`;
- `createdAt`;
- `updatedAt`.

It deliberately omits provider name/provider call id, provider request task and metadata, idempotency key, last error, and automatic-recovery/stalled fields.

### HTTP and typed-client boundary

Changed `POST /v1/callbacks` and `GET /v1/callbacks/:id` to project the internally persisted `CallAttempt` through `OwnerCallbackView` before serialization.

The TypeScript SDK now returns `OwnerCallbackView` from `requestOwnerCallback` and `getCallback`. `reconcileCallback` remains a separate `calls:reconcile`-protected operation and continues to work with the richer internal call-attempt state required by trusted reconciliation.

Exported the callback-view contract from `src/index.ts`.

### Regression coverage

Added `tests/callback-privacy-http.test.ts` to prove through the real HTTP/client boundary that:

- callback creation/read return exactly the five safe fields;
- a callback task containing sensitive run summary/scope and owner prompt remains persisted internally for recovery;
- that task/prompt, provider call id, request metadata, and idempotency key do not appear in owner-facing serialized responses;
- retrying the same callback idempotency key still returns the same callback and creates only one durable owner-callback attempt.

Updated existing client, run-overview, SQLite restart, and operator-owner tests so provider completion assertions use trusted internal fixture/store state rather than depending on a browser-visible `providerCallId`.

The operator acceptance now explicitly asserts the fresh browser callback response contains only the privacy-safe fields and does not contain the current scope, owner prompt, `request`, or `providerCallId`, while the trusted demo process still completes/reconciles that exact durable callback and queues/consumes steering normally.

### Documentation

Updated `docs/API_SECURITY.md` with the stable owner callback response privacy contract and rationale. Updated `docs/OPERATOR_CONSOLE.md` so the judge/demo flow correctly states that the browser receives only the narrow callback view while replay/recovery material remains server-side.

Relevant commits in this run were the callback-view/API/client/test hardening sequence through `79fe87720a3a3b77e485eb4aaa8db582cce834a4`, followed by documentation commits `9ac5e5e9ba5430d193f306be7c874b83a7649639` and `89d946ac4736529e8e8e03b9e246fd8454154474`.

## Architecture decisions made this run

1. `CallAttempt` remains the durable internal recovery object. Its exact phone task/idempotency/provider state is necessary for ambiguous-create replay, polling/webhook convergence, and duplicate-call prevention, but that does not make it an appropriate browser DTO.
2. Owner/read surfaces need operational callback identity and lifecycle status, not provider correlation or replay material. The minimal `OwnerCallbackView` is therefore a stable HTTP/SDK contract separate from persistence shape.
3. Reconciliation authority remains separately scoped with `calls:reconcile`; narrowing owner/read responses does not remove trusted backend access to the state needed for recovery.
4. Tests that need provider ids should obtain them from trusted control-plane/store fixtures, not force those identifiers back into public owner-facing responses merely for test convenience.
5. Callback idempotency semantics are unchanged. Privacy projection happens only after the control plane has performed the normal durable request/deduplication operation.
6. Human steering semantics remain unchanged: callback results become durable queued instructions and are consumed only at explicit safe checkpoints. No in-flight model/token interruption behavior was introduced.

## Verification performed

The first CI pass after changing the SDK types correctly exposed stale tests that still expected the now-private callback `purpose`/`providerCallId`; those tests were updated to use the new public contract or trusted fixture state. A later CI pass found one remaining operator acceptance that inspected `callback.request.task` through the browser response; it was fixed to assert the new privacy boundary while relying on the existing control-plane callback-context tests and trusted demo reconciliation for internal behavior.

Final code/docs state `89d946ac4736529e8e8e03b9e246fd8454154474` passed all repository verification paths:

- CI run `34186047819` — `completed` / `success`; locked dependency installation, TypeScript typecheck, build, and full Node test suite passed. The suite includes the new callback privacy tests plus the updated operator, SQLite restart, SDK, MCP, lifecycle, policy, and HTTP acceptances.
- Container run `34186047782` — `completed` / `success`; production image build and fake-provider runtime smoke passed.
- Compose deployment run `34186047747` — `completed` / `success`; Compose validation, fake-provider boot/health, durable API-state creation, named-volume restart, and post-restart persistence checks all passed.

`package.json` has no separate lint script and no standalone migration/schema command. The repository's available verification path remains CI typecheck/build/test plus Container and Compose deployment workflows.

No live CALL-E phone call was attempted or claimed.

## CALL-E integration status

- Fake provider: implemented and tested across owner decisions, callbacks, branch-scoped blocking, durable steering, exact acknowledgement, idempotency, lifecycle recovery, auditability, deterministic demos, HTTP/MCP integration, credential separation, branch-safe visualization, privacy-safe callback status, SQLite restart persistence, and now privacy-safe callback creation/read responses.
- Production CALL-E adapter: implemented with server-only `CALLE_API_KEY`, idempotent create requests, structured outcomes, polling/webhook convergence, bounded requests, duplicate-call prevention, exact-key ambiguous replay, and fail-closed stalled handling.
- HTTP + TypeScript SDK + MCP: implemented over shared control-plane semantics. Owner/operator callback reads now use the narrow DTO; trusted reconciliation remains separate.
- Live CALL-E success: unverified; no real authorized phone call was made.

## Current blockers / external prerequisites

No repository-development blocker currently prevents further useful work.

Live CALL-E verification still requires user-controlled prerequisites: a valid/authorized CALL-E credential, an authorized owner destination, and stable public HTTPS webhook ingress with the configured webhook capability token.

Real Claude Code host acceptance still requires running the documented stdio MCP registration/workflow in an actual Claude Code environment. Repository-side MCP behavior is tested, but host acceptance must not be invented.

## Highest-value next actions

1. Add focused fake/test-provider coverage for a provider that truthfully reports `in_progress`, proving owner callback DTO, run overview, audit, and operator status all project that state without exposing provider/replay material.
2. Review the owner-decision read boundary (`GET /v1/escalations/:id`) for equivalent least-privilege concerns: it currently intentionally returns the structured owner decision to agent readers, so document/verify which contexts may see answer text rather than narrowing it blindly.
3. Consider a trusted internal/admin callback diagnostic surface only if real operations require it; do not broaden the ordinary owner/read DTO to solve operator troubleshooting.
4. Continue improving the one-command judge flow and README only where it communicates already-tested semantics rather than adding demo-only state.
5. When an actual Claude Code host is available, run the documented stdio MCP host acceptance flow with the deterministic fake provider.
6. When user-only CALL-E prerequisites are available, perform a bounded live provider acceptance test and record only the observed result.
