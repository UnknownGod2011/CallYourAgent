# CallYourAgent progress

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. Agents can raise important owner decisions without freezing unrelated scopes; owners can independently request callbacks for progress/questions/steering; human input is persisted and consumed only at explicit safe checkpoints rather than pretending to interrupt in-flight model generation.

The repository includes SQLite persistence, deterministic fake and production CALL-E providers, replayable/idempotent call attempts, polling/webhook convergence, scoped authenticated HTTP APIs, a typed TypeScript client, stdio MCP, branch-scoped blocking, call policy/quiet hours/budgets, privacy-aware audit history, bounded lifecycle recovery, fail-closed ambiguous/stalled handling, API abuse controls, graceful shutdown, hard CALL-E HTTP deadlines, reproducible dependencies, readiness/liveness surfaces, a deterministic end-to-end demo, operator console, production Docker image, and single-instance persistent-volume Compose deployment.

This run added a one-command deterministic operator-demo fixture so a hackathon judge can reproduce the core visual state without manual API choreography: unrelated work remains active in `documentation`, `production-deploy` remains genuinely blocked on owner judgment, and one callback steering instruction is durably queued while the browser sees only the pending count.

## Exact repo state inspected this run

Before making changes, inspected the complete recursive `main` tree at HEAD `d9b56713c4fec1164c8785a79a9ee76b97dffd19`, including source, tests, workflows, deployment assets, and documentation paths. Inspected the tests directory listing to confirm existing domain, HTTP, MCP, operator, persistence, lifecycle, security, and deployment coverage.

Read `AGENTS.md`, this file, `README.md`, `docs/ARCHITECTURE.md`, `docs/INTEGRATIONS.md`, `docs/CALL_POLICY.md`, `docs/API_SECURITY.md`, `docs/DEPLOYMENT.md`, `docs/OPERATOR_CONSOLE.md`, and `deploy/README.md` before editing. Inspected recent commits through the branch-safe operator overview work and checked repository issues and pull requests; there were no open issues or PRs.

Inspected the implementation/test surfaces relevant to this increment: `package.json`, `src/client.ts`, `src/demo.ts`, `src/call-provider.ts`, `src/http-server.ts`, `tests/http-server.test.ts`, and the current test-suite layout.

A direct local clone was attempted for convenience but outbound DNS to `github.com` is unavailable in this runtime. Repository mutation used the connected GitHub API and verification used GitHub Actions; no local-only result was fabricated.

## Changes made this run

### One-command operator demo fixture

Added `src/operator-demo.ts` with `seedOperatorDemoFixture(...)` and the `npm run demo:operator` launcher.

The fixture uses the real `ControlPlane`, `FakeCallProvider`, existing call-attempt/idempotency logic, real callback reconciliation, real instruction queue, real run-overview projection, and the existing authenticated HTTP/operator surface. It does not introduce a demo-only business state machine.

A fresh launch seeds this state:

- active/current scope: `documentation`;
- unresolved blocking scope: `production-deploy`;
- queued owner-steering count: `1`.

The blocking escalation remains unresolved, so the blocked-scope indicator is real. The run then reports independent documentation work, proving branch-level continuation. A fake owner callback is completed and reconciled into a durable instruction that remains queued for the next safe checkpoint.

The fixture deliberately retries the same escalation and callback requests with the same idempotency keys and asserts that both deduplicate. This makes duplicate-call safety part of the visible demo setup rather than bypassing it.

The CLI starts a localhost-only in-memory fake-provider HTTP server on `127.0.0.1:8788` by default and prints the operator URL, run id, local demo bearer token, and expected indicators. `CYA_OPERATOR_DEMO_PORT` and `CYA_OPERATOR_DEMO_TOKEN` can override the local defaults. The launcher explicitly states that fake mode is not evidence of live CALL-E success.

### Regression coverage

Added `tests/operator-demo.test.ts`. It creates two fresh fixtures and verifies that both reproduce the same semantic operator state while preserving privacy and checkpoint semantics:

1. current scope is `documentation`;
2. unresolved blocking scope is exactly `production-deploy`;
3. queued steering count is exactly one;
4. escalation and callback retries deduplicate;
5. serialized `RunOverview` does not contain owner instruction text or a `queuedInstructions` field;
6. the actual owner instruction remains present through the agent's non-consuming checkpoint;
7. fresh launches reproduce the same semantic state independent of generated ids.

### Documentation and command surface

Added `demo:operator` to `package.json` and documented the one-command browser flow in `README.md` and `docs/OPERATOR_CONSOLE.md`.

Code/documentation commit:

- `d3372ad0b1dc98ef7620f48ad2a22efd3cd35bc7` — add one-command deterministic operator demo fixture, regression test, script, and documentation.

## Architecture decisions made this run

1. The demo fixture composes existing `ControlPlane` services and the deterministic `FakeCallProvider`; it does not get a privileged state-injection endpoint or alternate state machine.
2. The judge-facing console still consumes only the authenticated privacy-safe `RunOverview` plus audit timeline. Owner steering text remains agent-side checkpoint state.
3. The seeded blocking decision intentionally remains unresolved while another scope becomes current, making the branch-safe concurrency model visible rather than merely asserted in prose.
4. Callback steering is reconciled into the same durable instruction queue used by normal integrations and is intentionally left unconsumed.
5. Idempotent retries are exercised during fixture creation so the demo setup cannot silently depend on duplicate side effects.
6. The convenience launcher is localhost-only and in-memory by default; production deployment semantics remain the existing single-instance SQLite topology.
7. No new Claude/Codex/ChatGPT capability and no mid-token interruption behavior is claimed.

## Verification performed

The feature commit `d3372ad0b1dc98ef7620f48ad2a22efd3cd35bc7` triggered all repository workflows and all completed successfully:

- CI run `34136595364` — successful; locked dependency install, TypeScript typecheck, build, and the full Node test suite including `tests/operator-demo.test.ts`.
- Container run `34136595411` — successful.
- Compose deployment run `34136595568` — successful.

The repository still has no separate lint script or migration command in `package.json`; the available standard verification is `typecheck`, build/test via `check`, plus Container and Compose workflow checks.

No live CALL-E call was attempted or claimed.

## CALL-E integration status

- Fake provider: implemented and tested across owner decisions, callbacks, branch-scoped blocking, durable steering, exact acknowledgement, idempotency, policy/lifecycle recovery, auditability, SQLite restart, deterministic product demo, MCP work-loop acceptance, privacy-safe run overview, operator visualization, and now a one-command reproducible operator fixture.
- Production CALL-E adapter: implemented with server-only `CALLE_API_KEY`, provider idempotency, structured result handling, polling/webhook convergence, bounded HTTP requests, duplicate-call prevention, exact-key ambiguous replay, and fail-closed stalled handling.
- HTTP + TypeScript SDK + MCP: implemented over shared control-plane semantics. The operator fixture starts the same HTTP/operator boundary instead of inventing a second demo transport.
- Live CALL-E success: unverified; no real authorized phone call was made.

## Current blockers / external prerequisites

No repository-development blocker currently prevents further useful work.

Live CALL-E verification still requires user-controlled prerequisites: a valid/authorized CALL-E credential, authorized owner destination, and stable public HTTPS webhook ingress with the configured webhook capability token.

Real Claude Code host acceptance still requires running the documented stdio MCP registration/workflow in an actual Claude Code environment. Repository-side MCP behavior is CI-tested, but host acceptance must not be invented.

## Highest-value next actions

1. Add a focused HTTP acceptance test for the `demo:operator` launcher boundary itself: start the seeded server on an ephemeral localhost port, fetch `/operator`, authenticate to `/overview`, and prove the browser-facing state matches the fixture while steering text remains absent.
2. Consider printing a minimal copy/paste demo sequence or automatically opening only when explicitly requested; keep the default launcher non-invasive and localhost-only.
3. Improve operator audit presentation only where it helps judges distinguish escalation creation, callback completion, queued steering, and later acknowledgement without exposing sensitive text.
4. When an actual Claude Code host is available, run the documented stdio MCP host acceptance flow with the deterministic fake provider.
5. When the user-only CALL-E prerequisites are available, perform a bounded live provider acceptance test and record only the observed result.
