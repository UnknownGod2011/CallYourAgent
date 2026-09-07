# CallYourAgent progress

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. Agents can raise important owner decisions without freezing unrelated scopes; owners can independently request callbacks for progress/questions/steering; human input is persisted and consumed only at explicit safe checkpoints rather than pretending to interrupt in-flight model generation.

The repository includes SQLite persistence, deterministic fake and production CALL-E providers, replayable/idempotent call attempts, polling/webhook convergence, scoped authenticated HTTP APIs, a typed TypeScript client, stdio MCP, branch-scoped blocking, call policy/quiet hours/budgets, privacy-aware audit history, bounded lifecycle recovery, fail-closed ambiguous/stalled handling, API abuse controls, graceful shutdown, hard CALL-E HTTP deadlines, reproducible dependencies, readiness/liveness surfaces, deterministic end-to-end and operator demos, production Docker image, and single-instance persistent-volume Compose deployment.

This run completed the judge-facing deterministic operator story. The existing one-command fake-provider demo can now be advanced from its seeded state without adding a demo-only HTTP mutation or alternate state machine: after the presenter loads the operator page, pressing Enter in the demo terminal resolves the already-created owner-decision call through the fake provider, reconciles the real escalation, releases only the blocked scope, pulls queued steering at a safe checkpoint, acknowledges exactly those durable instruction ids, and reports the resumed scope.

## Exact repo state inspected this run

Before making changes, inspected the complete recursive `main` tree at HEAD `b7a787f02f974173f594f93a03bb914cf8deaa0c`, including all source files, tests, workflows, deployment assets, and documentation paths.

Read `AGENTS.md`, this file, `README.md`, `docs/ARCHITECTURE.md`, `docs/INTEGRATIONS.md`, `docs/CALL_POLICY.md`, `docs/API_SECURITY.md`, `docs/DEPLOYMENT.md`, `docs/OPERATOR_CONSOLE.md`, and `deploy/README.md` in full before editing. Inspected recent commits through the operator causal-stage work. Checked repository issues and pull requests; there were no open issues or PRs.

Inspected the implementation/test surfaces relevant to this increment: `src/operator-demo.ts`, `src/control-plane.ts`, `src/call-provider.ts`, `src/domain.ts`, `tests/operator-demo.test.ts`, and `package.json`. Confirmed the existing control-plane contracts already provide the required decision reconciliation, branch-specific unblock semantics, safe non-consuming checkpoint, exact instruction acknowledgement, heartbeat/status update, and durable audit events.

Repository mutation used the connected GitHub API and verification used GitHub Actions. Direct local cloning was unavailable because the automation container could not resolve `github.com`, so no unexecuted local test result is claimed.

## Changes made this run

### Deterministic second-stage operator demo composition

Updated `src/operator-demo.ts` with `advanceOperatorDemoFixture(...)` and an `advance()` method on the reusable `OperatorDemoServer`.

The advance composition:

1. finds the already-persisted call attempt belonging to the seeded blocking escalation;
2. completes that exact call in `FakeCallProvider` with deterministic owner approval evidence;
3. calls normal `reconcileEscalation(...)`, allowing the existing terminal-outcome path to persist the structured owner decision and resolve the escalation;
4. pulls queued owner steering with `checkpoint(runId, false)` so the agent observes it at an explicit safe work boundary;
5. acknowledges exactly the instruction ids returned by that checkpoint with `acknowledgeInstructions(...)`;
6. reports `production-deploy` as the resumed current scope through the normal heartbeat/status contract;
7. asserts the resulting privacy-safe overview has no unresolved blocking scopes and no pending steering.

The CLI still uses `npm run demo:operator`. It now prints an explicit next action: open `/operator`, load the printed run/token, and press Enter in the same terminal. That one action advances the existing demo state and prints the resulting resumed scope/acknowledgement summary. Refreshing `/operator` then shows the durable Decision and Steering acknowledged stages.

No new HTTP mutation route, privileged demo endpoint, fake business-state shortcut, or provider-specific agent contract was introduced.

### Retry safety inside the demo process

`startOperatorDemoServer(...)` memoizes its advance promise. Repeated calls to `demo.advance()` share the same deterministic transition instead of replaying the completion/checkpoint flow or generating duplicate audit mutations.

This is demo-process safety layered on top of the real control-plane/provider idempotency semantics; it does not replace domain idempotency.

### Regression coverage

Extended `tests/operator-demo.test.ts` to prove:

1. the original seeded state remains unchanged before advance: `documentation` active, `production-deploy` blocked, one steering instruction queued;
2. the advance path records the deterministic owner answer through normal escalation reconciliation;
3. the blocked-scope list becomes empty only after the decision resolves;
4. the exact instruction ids observed at the safe checkpoint are the ids acknowledged;
5. no queued instructions remain after acknowledgement;
6. the run reports `production-deploy` as the resumed scope;
7. durable audit history contains `owner_decision_recorded` and `owner_instruction_consumed`, with consumption occurring after queueing;
8. the real HTTP-boundary demo server shows the final privacy-safe overview after advance;
9. repeated `demo.advance()` calls return the same result instead of replaying the transition.

### Documentation

Updated `docs/OPERATOR_CONSOLE.md` with the complete two-stage judge workflow and the explicit architecture boundary: pressing Enter composes existing fake-provider/control-plane operations and there is intentionally no demo-only mutation endpoint. The browser continues receiving only privacy-safe overview/audit data, never owner answers or steering text.

Commits from this increment:

- `ae01566501e7a1f419333fac401ece92b0bb32ef` — deterministic operator demo advance action.
- `93193def90339fc32e85c04b19f2222c7570f7a2` — regression and HTTP-boundary coverage for the second-stage progression.
- `4a2e99c14667a5d9f73b45341ac3e5e2787e99be` — operator demo documentation.

## Architecture decisions made this run

1. The second-stage demo is composition over existing domain operations, not a new state machine or demo-only API surface.
2. Decision completion is supplied only by `FakeCallProvider`; the control plane still performs the real terminal reconciliation and durable owner-decision transition.
3. Steering is pulled non-consumingly and acknowledged only after the simulated agent reaches a safe checkpoint. The demo does not imply mid-generation interruption.
4. Exact acknowledgement ids come from the checkpoint snapshot, preserving the race-safe two-phase instruction protocol.
5. Branch resume is demonstrated by the disappearance of `production-deploy` from unresolved blocking scopes and a subsequent normal run heartbeat setting that scope active; unrelated work before resolution remains represented by `documentation`.
6. The operator browser remains observational/privacy-safe. The advance action lives in the local demo process rather than granting the browser agent-level checkpoint/acknowledgement privileges.
7. Repeated advance invocations in one demo process share one promise so the presentation action itself is retry-safe.
8. No Claude/Codex/ChatGPT mid-token interruption capability is claimed, and deterministic fake-provider completion is not treated as live CALL-E evidence.

## Verification performed

The code/test-bearing commit `93193def90339fc32e85c04b19f2222c7570f7a2` triggered all repository workflows and all completed successfully:

- CI run `34149897775` — successful; locked dependency install, TypeScript typecheck, build, and the full Node test suite, including the new second-stage operator demo tests.
- Container run `34149897741` — successful.
- Compose deployment run `34149897757` — successful.

The repository still has no separate lint script or migration command in `package.json`; the available standard verification remains `typecheck`, build/test via `check`, plus Container and Compose workflow checks.

No live CALL-E call was attempted or claimed.

## CALL-E integration status

- Fake provider: implemented and tested across owner decisions, callbacks, branch-scoped blocking, durable steering, exact acknowledgement, idempotency, policy/lifecycle recovery, auditability, SQLite restart, deterministic product demo, MCP work-loop acceptance, privacy-safe run overview, operator visualization, one-command fixture, real HTTP-boundary fixture acceptance, causal-stage timeline presentation, and now a complete deterministic seeded-state -> decision resolved -> branch resumed -> steering acknowledged operator flow.
- Production CALL-E adapter: implemented with server-only `CALLE_API_KEY`, provider idempotency, structured result handling, polling/webhook convergence, bounded HTTP requests, duplicate-call prevention, exact-key ambiguous replay, and fail-closed stalled handling.
- HTTP + TypeScript SDK + MCP: implemented over shared control-plane semantics. The operator remains a thin read/callback surface over the same HTTP API rather than a second state engine.
- Live CALL-E success: unverified; no real authorized phone call was made.

## Current blockers / external prerequisites

No repository-development blocker currently prevents further useful work.

Live CALL-E verification still requires user-controlled prerequisites: a valid/authorized CALL-E credential, authorized owner destination, and stable public HTTPS webhook ingress with the configured webhook capability token.

Real Claude Code host acceptance still requires running the documented stdio MCP registration/workflow in an actual Claude Code environment. Repository-side MCP behavior is CI-tested, but host acceptance must not be invented.

## Highest-value next actions

1. Split the one-command operator demo into least-privilege browser credentials (read/audit and optional owner-callback) while keeping agent checkpoint/acknowledgement authority inside the demo process; avoid printing a legacy full-access bearer token when the browser does not need it.
2. Add acceptance coverage proving the operator read token cannot checkpoint, acknowledge instructions, reconcile calls, or request callbacks unless the separately scoped owner credential is supplied.
3. Consider adding a small static explanation card to `/operator` that explicitly visualizes “unrelated branch kept running” vs “blocked branch resumed” from existing overview/audit state, without adding new business state.
4. When an actual Claude Code host is available, run the documented stdio MCP host acceptance flow with the deterministic fake provider.
5. When the user-only CALL-E prerequisites are available, perform a bounded live provider acceptance test and record only the observed result.
