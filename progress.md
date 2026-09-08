# CallYourAgent progress

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. Agents can raise important owner decisions without freezing unrelated scopes; owners can independently request callbacks for progress/questions/steering; human input is persisted and consumed only at explicit safe checkpoints rather than pretending to interrupt in-flight model generation.

The repository includes SQLite persistence, deterministic fake and production CALL-E providers, replayable/idempotent call attempts, polling/webhook convergence, scoped authenticated HTTP APIs, a typed TypeScript client, stdio MCP, branch-scoped blocking, call policy/quiet hours/budgets, privacy-aware audit history, bounded lifecycle recovery, fail-closed ambiguous/stalled handling, API abuse controls, graceful shutdown, bounded CALL-E HTTP requests, readiness/liveness surfaces, deterministic end-to-end and operator demos, a production Docker image, and a single-instance persistent-volume Compose deployment.

This run strengthened the deterministic operator demo with a real HTTP acceptance test that drives a fresh owner-requested callback through the actual owner credential and HTTP API, observes its privacy-safe overview state while queued, completes/reconciles it through the trusted fake-provider path, proves callback steering is durable before acknowledgement, and proves the same steering is consumed only at a later safe checkpoint.

## Exact repo state inspected this run

Before making changes, inspected the complete recursive `main` tree at HEAD `87578856bcd9ec43b022571cad9288fcb4bb2ee3`, covering root files, all GitHub workflows, deployment assets, documentation, every `src` file, and every test file. The recursive tree was not truncated.

Read `AGENTS.md`, this file, `README.md`, `docs/ARCHITECTURE.md`, `docs/INTEGRATIONS.md`, `docs/API_SECURITY.md`, `docs/CALL_POLICY.md`, `docs/DEPLOYMENT.md`, `docs/OPERATOR_CONSOLE.md`, and `deploy/README.md` in full before editing. Inspected recent commits through the privacy-safe callback-status work. Checked repository issues and pull requests; there were no open issues and no open PRs.

Inspected the relevant implementation/test surfaces before changing anything: `src/operator-demo.ts`, `src/run-overview.ts`, `src/call-provider.ts`, `src/control-plane.ts`, `src/client.ts`, and `tests/operator-owner-credential.test.ts`.

Confirmed that the deterministic `FakeCallProvider` truthfully returns `queued` when a call is accepted. The generic call-attempt/read-model types still support `in_progress` for providers that report it, but fabricating an in-progress transition inside the fake operator acceptance would be misleading. The deterministic acceptance therefore verifies the real fake-provider lifecycle `queued -> completed`, followed by durable steering queueing and explicit safe-checkpoint acknowledgement.

## Changes made this run

### HTTP callback-lifecycle acceptance

Added `tests/operator-callback-lifecycle-http.test.ts`.

The test starts the same exported `startOperatorDemoServer` used by the judge-facing local operator demo and uses the separately scoped owner credential over the actual HTTP boundary. It first advances the seeded branch-safe decision flow, then creates a fresh callback through normal `POST /v1/callbacks`.

It proves that:

- the browser/owner HTTP callback is the exact durable call later reconciled by the trusted demo process;
- the deterministic fake-provider callback starts in the real `queued` state;
- `GET /v1/runs/:runId/overview` projects that exact callback id/status without exposing the callback prompt or steering text;
- after trusted fake-provider completion/reconciliation, the same callback is `completed` and exactly one owner instruction is durably queued;
- the privacy-safe overview still exposes only the queued-instruction count, not the instruction text;
- explicit safe-checkpoint acknowledgement removes that queued steering while leaving the historical callback status `completed`;
- the durable audit sequence is causal: `owner_callback_requested` -> `call_attempt_completed` -> `owner_instruction_queued` -> `owner_instruction_consumed`.

No demo-only HTTP mutation endpoint or browser reconciliation authority was introduced. No production state machine changed.

Code/test commit made this run:

- `c1a6a62bd93da37a97ba6dfec4d8214e821bfe6f` — `test: cover operator callback lifecycle over HTTP`

## Architecture decisions made this run

1. The acceptance test must cross the same HTTP boundary and credential scopes used by `/operator`, rather than calling only in-process fixture helpers.
2. Provider lifecycle presentation must remain truthful. The fake provider reports `queued`; the test does not invent an `in_progress` phase merely to exercise a UI enum. `in_progress` remains supported for real/provider adapters that actually emit it.
3. The privacy-safe run overview remains the operator read model. The acceptance test explicitly guards against callback prompt/steering leakage instead of fetching the broader persisted `CallAttempt` task.
4. Steering durability and consumption remain separate transitions. Completion/reconciliation queues structured owner steering first; only a later explicit checkpoint/acknowledgement consumes the exact instruction id.
5. Callback completion does not rewrite run/branch semantics or pretend to interrupt in-flight generation.
6. No live CALL-E success or undocumented Claude/Codex/ChatGPT interruption capability is claimed.

## Verification performed

The code/test-bearing commit `c1a6a62bd93da37a97ba6dfec4d8214e821bfe6f` triggered all three repository verification workflows and all completed successfully:

- CI run `34178690489` — `completed` / `success`; checkout, Node 24 setup, locked dependency installation, repository typecheck/build/test command, and the full Node test suite passed, including the new HTTP callback-lifecycle acceptance.
- Container run `34178690521` — `completed` / `success`; production image build and fake-provider runtime smoke test passed.
- Compose deployment run `34178690501` — `completed` / `success`; Compose validation, fake-provider deployment boot/health, durable API-state creation, named-volume restart, and post-restart API/audit persistence verification passed.

`package.json` has no separate lint script and no migration/schema command. The repository's available verification path remains the CI typecheck/build/test flow plus Container and Compose deployment workflows.

No live CALL-E phone call was attempted or claimed.

## CALL-E integration status

- Fake provider: implemented and tested across owner decisions, callbacks, branch-scoped blocking, durable steering, exact acknowledgement, idempotency, lifecycle recovery, auditability, deterministic demos, HTTP/MCP integration, credential separation, branch-safe visualization, privacy-safe callback-status presentation, and now HTTP-boundary callback lifecycle acceptance.
- Production CALL-E adapter: implemented with server-only `CALLE_API_KEY`, idempotent create requests, structured outcomes, polling/webhook convergence, bounded requests, duplicate-call prevention, exact-key ambiguous replay, and fail-closed stalled handling.
- HTTP + TypeScript SDK + MCP: implemented over shared control-plane semantics. Operator remains a thin read/callback surface over the same backend.
- Live CALL-E success: unverified; no real authorized phone call was made.

## Current blockers / external prerequisites

No repository-development blocker currently prevents further useful work.

Live CALL-E verification still requires user-controlled prerequisites: a valid/authorized CALL-E credential, an authorized owner destination, and stable public HTTPS webhook ingress with the configured webhook capability token.

Real Claude Code host acceptance still requires running the documented stdio MCP registration/workflow in an actual Claude Code environment. Repository-side MCP behavior is tested, but host acceptance must not be invented.

## Highest-value next actions

1. Add a SQLite-backed HTTP acceptance for the owner/read credential split plus privacy-safe callback overview across restart, preserving the supported single-instance topology.
2. Update README and `docs/OPERATOR_CONSOLE.md` to explicitly call out the privacy-safe latest-callback status card and the now-tested `queued -> completed -> steering queued -> steering acknowledged` fake-provider story.
3. Add focused coverage for a provider that truthfully returns `in_progress`, ensuring the same privacy-safe overview/operator read model projects that state without changing fake-provider semantics.
4. Review whether owner-facing callback creation should return a narrower response DTO instead of the current full `CallAttempt`, since the operator only needs callback identity/status and the persisted task can contain run briefing text.
5. When an actual Claude Code host is available, run the documented stdio MCP host acceptance flow with the deterministic fake provider.
6. When user-only CALL-E prerequisites are available, perform a bounded live provider acceptance test and record only the observed result.
