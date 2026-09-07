# CallYourAgent progress

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. Agents can raise important owner decisions without freezing unrelated scopes; owners can independently request callbacks for progress/questions/steering; human input is persisted and consumed only at explicit safe checkpoints rather than pretending to interrupt in-flight model generation.

The repository includes SQLite persistence, deterministic fake and production CALL-E providers, replayable/idempotent call attempts, polling/webhook convergence, scoped authenticated HTTP APIs, a typed TypeScript client, stdio MCP, branch-scoped blocking, call policy/quiet hours/budgets, privacy-aware audit history, bounded lifecycle recovery, fail-closed ambiguous/stalled handling, API abuse controls, graceful shutdown, hard CALL-E HTTP deadlines, reproducible dependencies, readiness/liveness surfaces, a deterministic end-to-end demo, operator console, production Docker image, and single-instance persistent-volume Compose deployment.

This run strengthened the one-command operator demo from an in-process fixture test to a true HTTP-boundary acceptance path. The same deterministic fake-provider state can now be started programmatically on an ephemeral localhost port, and regression coverage proves the actual `/operator` page plus authenticated `/v1/runs/:runId/overview` contract show independent active work, the blocked branch, and pending steering count without exposing steering text. A subsequent non-consuming agent checkpoint still receives the durable steering instruction.

## Exact repo state inspected this run

Before making changes, inspected the complete recursive `main` tree at HEAD `33257edc92c7553623947bd376514041b8293901`, including source, tests, workflows, deployment assets, and all documentation paths.

Read `AGENTS.md`, this file, `README.md`, `docs/ARCHITECTURE.md`, `docs/INTEGRATIONS.md`, `docs/CALL_POLICY.md`, `docs/API_SECURITY.md`, `docs/DEPLOYMENT.md`, `docs/OPERATOR_CONSOLE.md`, and `deploy/README.md` in full before editing. Inspected recent commits through the deterministic operator-demo fixture work and checked repository issues and pull requests; there were no open issues or PRs.

Inspected the implementation/test surfaces relevant to this increment: `src/operator-demo.ts`, `tests/operator-demo.test.ts`, `src/http-server.ts`, and `package.json`, including the authenticated overview/checkpoint routes and available verification scripts.

Repository mutation used the connected GitHub API and verification used GitHub Actions. No live-provider result or unexecuted local test was fabricated.

## Changes made this run

### Reusable operator-demo HTTP launcher

Refactored `src/operator-demo.ts` so the deterministic fixture can be started through an exported `startOperatorDemoServer(...)` helper without creating a second server or demo-only state path.

The helper:

- uses the same `ControlPlane`, `FakeCallProvider`, `seedOperatorDemoFixture(...)`, `createControlPlaneHttpServer(...)`, and readiness contract as the CLI;
- accepts an optional host, port, and local demo token;
- supports port `0` so tests can use an OS-assigned ephemeral localhost port;
- returns the seeded fixture, real base/operator URLs, token, server handle, and an awaitable close operation;
- leaves the existing `npm run demo:operator` CLI behavior intact, including localhost-only defaults and the explicit warning that fake mode is not live CALL-E evidence.

### HTTP-boundary acceptance coverage

Extended `tests/operator-demo.test.ts` with an acceptance test that starts the real seeded HTTP server on an ephemeral localhost port and verifies:

1. `GET /operator` succeeds through the network boundary and contains the expected Active scope, Blocked scopes, and Pending steering UI indicators;
2. the static operator page contains neither the local bearer token nor the owner steering text;
3. unauthenticated `GET /v1/runs/:runId/overview` returns `401`;
4. authenticated overview returns `documentation` as the active scope, exactly `production-deploy` as the unresolved blocked scope, and a queued steering count of `1`;
5. serialized browser-facing overview still contains neither owner steering text nor a `queuedInstructions` field;
6. a later authenticated non-consuming checkpoint still returns the real queued instruction, proving the privacy-safe operator read did not acknowledge or consume agent steering;
7. the test closes the real HTTP server in `finally` so acceptance coverage does not leak a listening process.

Code/test commit:

- `b92523940ff2699715910b6701a9c94e29512956` — prove the deterministic operator demo through the real authenticated HTTP boundary.

## Architecture decisions made this run

1. HTTP acceptance reuses the same exported demo-server construction used by the CLI; no test-only HTTP implementation or privileged fixture endpoint was introduced.
2. Port `0` is supported only as normal Node listening behavior for deterministic tests; the user-facing launcher still defaults to `127.0.0.1:8788` unless configured otherwise.
3. The operator browser contract remains deliberately count-only for owner steering. Instruction text is still available only to the authenticated agent checkpoint contract.
4. Reading `/operator` or `/overview` remains observational and cannot consume or acknowledge queued instructions.
5. The acceptance test explicitly crosses the authentication boundary instead of inspecting only `getRunOverview(...)` in memory.
6. No Claude/Codex/ChatGPT mid-generation interruption capability is claimed, and no live CALL-E behavior is inferred from fake-provider HTTP success.

## Verification performed

The code-bearing commit `b92523940ff2699715910b6701a9c94e29512956` triggered all repository workflows and all completed successfully:

- CI run `34141537461` — successful; locked dependency install, TypeScript typecheck, build, and the full Node test suite, including the new HTTP-boundary operator-demo acceptance test.
- Container run `34141537542` — successful.
- Compose deployment run `34141537449` — successful.

The repository still has no separate lint script or migration command in `package.json`; the available standard verification remains `typecheck`, build/test via `check`, plus Container and Compose workflow checks.

No live CALL-E call was attempted or claimed.

## CALL-E integration status

- Fake provider: implemented and tested across owner decisions, callbacks, branch-scoped blocking, durable steering, exact acknowledgement, idempotency, policy/lifecycle recovery, auditability, SQLite restart, deterministic product demo, MCP work-loop acceptance, privacy-safe run overview, operator visualization, one-command fixture, and now the actual judge-facing HTTP boundary for that fixture.
- Production CALL-E adapter: implemented with server-only `CALLE_API_KEY`, provider idempotency, structured result handling, polling/webhook convergence, bounded HTTP requests, duplicate-call prevention, exact-key ambiguous replay, and fail-closed stalled handling.
- HTTP + TypeScript SDK + MCP: implemented over shared control-plane semantics. The operator fixture and its acceptance test now exercise the same HTTP server used by real integrations rather than bypassing transport/authentication.
- Live CALL-E success: unverified; no real authorized phone call was made.

## Current blockers / external prerequisites

No repository-development blocker currently prevents further useful work.

Live CALL-E verification still requires user-controlled prerequisites: a valid/authorized CALL-E credential, authorized owner destination, and stable public HTTPS webhook ingress with the configured webhook capability token.

Real Claude Code host acceptance still requires running the documented stdio MCP registration/workflow in an actual Claude Code environment. Repository-side MCP behavior is CI-tested, but host acceptance must not be invented.

## Highest-value next actions

1. Improve the operator audit presentation so a hackathon judge can visually distinguish escalation requested/call pending, callback completed/steering queued, and later exact steering acknowledgement without exposing sensitive text.
2. Add a focused owner-decision resolution demo control or deterministic second-stage script only if it composes the existing authenticated APIs/control-plane transitions; do not add a demo-only state mutation path.
3. Consider issuing separate least-privilege read and callback credentials in the demo launcher instead of one legacy full-access local token, while keeping the one-command experience simple.
4. When an actual Claude Code host is available, run the documented stdio MCP host acceptance flow with the deterministic fake provider.
5. When the user-only CALL-E prerequisites are available, perform a bounded live provider acceptance test and record only the observed result.
