# CallYourAgent progress

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. Agents can raise important owner decisions without freezing unrelated scopes; owners can independently request callbacks for progress/questions/steering; human input is persisted and consumed only at explicit safe checkpoints rather than pretending to interrupt in-flight model generation.

The repository includes SQLite persistence, deterministic fake and production CALL-E providers, replayable/idempotent call attempts, polling/webhook convergence, scoped authenticated HTTP APIs, a typed TypeScript client, stdio MCP, branch-scoped blocking, call policy/quiet hours/budgets, privacy-aware audit history, bounded lifecycle recovery, fail-closed ambiguous/stalled handling, API abuse controls, graceful shutdown, hard CALL-E HTTP deadlines, reproducible dependencies, readiness/liveness surfaces, deterministic end-to-end and operator demos, production Docker image, and single-instance persistent-volume Compose deployment.

This run tightened the one-command operator demo's security boundary. The browser-facing demo credential is now a real scoped credential with only `agent:read` + `audit:read`, while the trusted demo process retains the authority required for decision reconciliation, safe checkpoint observation, exact instruction acknowledgement, and branch resume. The browser no longer receives a legacy full-access token.

## Exact repo state inspected this run

Before making changes, inspected the complete recursive `main` tree at HEAD `31bcd30b9c04fcfe963b469b98a4a4cc0f5da21e`, including source, tests, workflows, deployment assets, and documentation paths.

Read `AGENTS.md`, this file, `README.md`, `docs/ARCHITECTURE.md`, `docs/INTEGRATIONS.md`, `docs/API_SECURITY.md`, `docs/CALL_POLICY.md`, `docs/DEPLOYMENT.md`, and `docs/OPERATOR_CONSOLE.md` before editing. Inspected recent commits through the deterministic operator-demo completion work. Checked repository issues and pull requests; there were no open issues or PRs.

Inspected the implementation/test surfaces relevant to this increment: `src/operator-demo.ts`, `src/http-server.ts`, and `tests/operator-demo.test.ts`. Confirmed the HTTP server already had the required credential-scope model, so no new authorization system or demo-only route was necessary.

Repository mutation used the connected GitHub API and verification used GitHub Actions. No unsupported local test result is claimed.

## Changes made this run

### Least-privilege browser credential

Updated `startOperatorDemoServer(...)` so `apiToken` is now registered through `apiCredentials` as credential id `operator-demo-browser` with scopes:

- `agent:read`
- `audit:read`

The public property and `CYA_OPERATOR_DEMO_TOKEN` environment-variable name are intentionally retained for compatibility, but changing the token string does not widen its privileges.

The demo CLI now prints `tokenScopes` and explicitly states that the browser token is read/audit-only.

### Trusted-process authority remains internal

The existing `advance()` flow still executes directly inside the trusted demo process over the real `ControlPlane` and deterministic fake provider. It does not route decision reconciliation, checkpointing, acknowledgement, or heartbeat through the browser credential.

This preserves the architectural separation:

- browser/operator observation: privacy-safe read + audit only;
- trusted agent/demo process: checkpoint, exact acknowledgement, reconciliation, and heartbeat;
- owner callback permission: separate `owner:callback` credential when a real/manual owner surface needs it.

No new business-state path, privileged browser endpoint, or alternate state machine was introduced.

### Negative HTTP acceptance coverage

Updated `tests/operator-demo.test.ts` so the real HTTP-boundary demo verifies that the browser credential:

1. can read `/v1/runs/:runId/overview`;
2. can read `/v1/runs/:runId/audit`;
3. receives `403` for `/checkpoint` because it lacks `agent:write`;
4. receives `403` for exact instruction acknowledgement;
5. receives `403` for escalation reconciliation because it lacks `calls:reconcile`;
6. receives `403` for `POST /v1/callbacks` because it lacks `owner:callback`;
7. still observes the final resumed state after the trusted in-process `advance()` operation.

The test no longer uses the browser credential to read steering text through a checkpoint. Steering remains verifiable in the in-process fixture tests where the trusted agent boundary is being tested.

### Documentation

Updated `README.md` and `docs/OPERATOR_CONSOLE.md` to make the new scope boundary explicit and to clarify that the one-command fixture intentionally does not grant callback, reconciliation, checkpoint, or acknowledgement authority to the browser.

Commits from this increment:

- `c051ce2e8f2680414ff51dd0e21a8557f5f5b801` — least-privilege operator demo credential.
- `d27000c235b4531626c2226fdde56fdb6f0ae2a2` — HTTP acceptance coverage for denied mutation/reconciliation/callback surfaces.
- `b282da173edba4f9dbdfc356d42255c3cabdec0a` — README security clarification.
- `e272ce1343e0cfbb5269d83d33bea650439ec49d` — operator-console security documentation.

## Architecture decisions made this run

1. The browser should receive only the scopes needed to render the operator demo: `agent:read` + `audit:read`.
2. Demo progression authority belongs in the trusted process, not in the browser, because the second stage already composes normal control-plane operations directly.
3. A browser read token must not be able to observe queued instruction text through checkpoint APIs; pending steering remains represented only by the privacy-safe count in `RunOverview`.
4. `owner:callback` remains a distinct capability. A manual owner surface may receive a separately scoped credential, but the deterministic one-command judge fixture does not need it.
5. Compatibility names (`apiToken`, `CYA_OPERATOR_DEMO_TOKEN`) can remain while semantics become safer; token identity and authorization scope are separate concerns.
6. No Claude/Codex/ChatGPT mid-token interruption capability is claimed, and deterministic fake-provider completion is not treated as live CALL-E evidence.

## Verification performed

The code/test-bearing commit `d27000c235b4531626c2226fdde56fdb6f0ae2a2` triggered all repository workflows and all completed successfully:

- CI run `34154063987` — successful; locked dependency install, TypeScript typecheck, build, and the full Node test suite including the new least-privilege HTTP acceptance assertions.
- Container run `34154064007` — successful.
- Compose deployment run `34154064000` — successful.

The repository still has no separate lint script or migration command in `package.json`; the available standard verification remains typecheck/build/test via CI plus Container and Compose workflow checks.

No live CALL-E call was attempted or claimed.

## CALL-E integration status

- Fake provider: implemented and tested across owner decisions, callbacks, branch-scoped blocking, durable steering, exact acknowledgement, idempotency, policy/lifecycle recovery, auditability, SQLite restart, deterministic product demo, MCP work-loop acceptance, privacy-safe run overview, operator visualization, one-command fixture, real HTTP-boundary fixture acceptance, complete seeded-state progression, and now least-privilege browser access.
- Production CALL-E adapter: implemented with server-only `CALLE_API_KEY`, provider idempotency, structured result handling, polling/webhook convergence, bounded HTTP requests, duplicate-call prevention, exact-key ambiguous replay, and fail-closed stalled handling.
- HTTP + TypeScript SDK + MCP: implemented over shared control-plane semantics. The operator remains a thin observational/owner surface over the same HTTP API rather than a second state engine.
- Live CALL-E success: unverified; no real authorized phone call was made.

## Current blockers / external prerequisites

No repository-development blocker currently prevents further useful work.

Live CALL-E verification still requires user-controlled prerequisites: a valid/authorized CALL-E credential, authorized owner destination, and stable public HTTPS webhook ingress with the configured webhook capability token.

Real Claude Code host acceptance still requires running the documented stdio MCP registration/workflow in an actual Claude Code environment. Repository-side MCP behavior is CI-tested, but host acceptance must not be invented.

## Highest-value next actions

1. Add a separate optional owner-demo credential path with only `owner:callback` + the minimum read scopes, so the operator UI can demonstrate owner-requested callbacks without ever reusing an agent/reconciliation credential.
2. Add a small role indicator in `/operator` that can explain when the supplied credential is read-only versus callback-capable without exposing token material; this may require a privacy-safe authenticated capabilities endpoint rather than client-side guessing.
3. Add a visual explanation card for “unrelated branch kept running” vs “blocked branch resumed” using existing overview/audit state only.
4. When an actual Claude Code host is available, run the documented stdio MCP host acceptance flow with the deterministic fake provider.
5. When the user-only CALL-E prerequisites are available, perform a bounded live provider acceptance test and record only the observed result.
