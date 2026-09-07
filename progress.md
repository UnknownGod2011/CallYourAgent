# CallYourAgent progress

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. Agents can raise important owner decisions without freezing unrelated scopes; owners can independently request callbacks for progress/questions/steering; human input is persisted and consumed only at explicit safe checkpoints rather than pretending to interrupt in-flight model generation.

The repository includes SQLite persistence, deterministic fake and production CALL-E providers, replayable/idempotent call attempts, polling/webhook convergence, scoped authenticated HTTP APIs, a typed TypeScript client, stdio MCP, branch-scoped blocking, call policy/quiet hours/budgets, privacy-aware audit history, bounded lifecycle recovery, fail-closed ambiguous/stalled handling, API abuse controls, graceful shutdown, hard CALL-E HTTP deadlines, reproducible dependencies, readiness/liveness surfaces, a deterministic end-to-end demo, operator console, production Docker image, and single-instance persistent-volume Compose deployment.

This run added the privacy-safe shared read model needed to make branch-level blocking and queued steering visible to operators without exposing owner instruction text or mutating instruction state.

## Exact repo state inspected this run

Before making changes, inspected the complete recursive `main` tree at HEAD `316ac8ef774acdf168b924510925158078aa91fa`, including source, tests, CI workflows, package metadata, Docker/deployment assets, and documentation paths.

Read `AGENTS.md`, this file, `README.md`, `docs/ARCHITECTURE.md`, and `docs/INTEGRATIONS.md` in full before editing. Inspected recent commits through the MCP exact-instruction acknowledgement acceptance work. Checked repository issues and pull requests; there were none.

Inspected the implementation/test surfaces relevant to the selected increment: `src/domain.ts`, `src/control-plane.ts`, `src/http-server.ts`, `src/client.ts`, `src/operator-ui.ts`, `src/index.ts`, `tests/http-server.test.ts`, and `tests/operator-ui.test.ts`. The existing checkpoint already computes unresolved blocking scopes and queued instructions without consuming them when `consume=false`, but the only existing returned shape includes full instruction objects and is therefore too sensitive for a read-only operator overview.

A direct repository clone was attempted only for local convenience, but outbound DNS to github.com is unavailable in this execution environment. Repository reads/writes therefore used the connected GitHub API and authoritative verification used GitHub Actions; no local test result was fabricated.

## Changes made this run

### Privacy-safe run overview projection

Added `src/run-overview.ts` with a typed `RunOverview` contract and `getRunOverview(controlPlane, runId)` projection.

The projection returns only:

- the current `AgentRun` snapshot;
- deduplicated unresolved blocking scope ids;
- `queuedInstructionCount`.

It deliberately does **not** return owner instruction text or instruction objects. It calls the existing checkpoint path with `consume=false`, so viewing the overview cannot acknowledge or consume steering.

Exported the projection through `src/index.ts` so HTTP/SDK/operator adapters can share one sanitized read model instead of reimplementing privacy filtering independently.

### Regression coverage

Added `tests/run-overview.test.ts`. The test creates one blocking and one non-blocking escalation, queues two owner instructions, and verifies that:

1. only the unresolved blocking scope appears in the overview;
2. queued steering is represented by count only;
3. serialized overview output does not contain either instruction's text;
4. reading the overview leaves both instructions queued afterward.

Code-bearing commit: `109cde6adad3f9c0d59dc583492b073c08e12186` (`feat: add privacy-safe run overview projection`).

## Architecture decisions made this run

1. Operator visibility must use an explicit sanitized projection rather than exposing checkpoint payloads and relying on the browser to hide sensitive fields.
2. Read-only status inspection must never consume/acknowledge owner steering. Safe-checkpoint incorporation remains an explicit agent action.
3. Branch-level blocking remains the primary concurrency signal. Non-blocking escalations are intentionally absent from `unresolvedBlockingScopes`.
4. Queued steering count is useful operational state; instruction text remains behind the agent/checkpoint contract.
5. The sanitized projection is shared core code, not operator-only state, so future HTTP/SDK/MCP surfaces can expose identical semantics without another state machine.
6. This change does not claim mid-token interruption or any new external-platform capability.

## Verification performed

For code commit `109cde6adad3f9c0d59dc583492b073c08e12186`, all three GitHub Actions checks completed successfully:

- CI `check` job, workflow run `34119872560`: success. This is the repository's locked `npm ci` + TypeScript typecheck/build/test pipeline and includes the new `run-overview` regression test.
- Container `build-container`, workflow run `34119872591`: success.
- Compose `compose-smoke`, workflow run `34119872592`: success.

No live CALL-E call was attempted or claimed.

## CALL-E integration status

- Fake provider: implemented and tested for owner decisions, callbacks, branch-scoped blocking, durable queued steering, safe checkpoint consumption, exact instruction acknowledgement, idempotency, policy/lifecycle recovery, auditability, SQLite restart, deterministic demo, operator visualization, container boot, persistent Compose deployment, MCP work-loop acceptance, and now privacy-safe run-overview projection semantics.
- Production CALL-E adapter: implemented with server-only `CALLE_API_KEY`, structured result handling, provider idempotency, polling, terminal webhook reconciliation, duplicate-call prevention, bounded HTTP requests, exact-key ambiguous replay, and fail-closed stalled handling.
- HTTP + typed TypeScript SDK + MCP surfaces: implemented and sharing the same control-plane semantics. The new run-overview projection is shared core code but is not yet wired to a dedicated HTTP route in this run.
- Live CALL-E success: unverified; no real authorized phone call was made.

## Current blockers / external prerequisites

No repository-development blocker currently prevents further useful work.

Live CALL-E verification still requires user-controlled prerequisites: a valid/authorized CALL-E credential, authorized owner destination, and stable public HTTPS webhook ingress with the configured webhook capability token. These are required before claiming a real phone call succeeds.

Real Claude Code host acceptance still requires running the documented stdio MCP registration and workflow in an actual Claude Code environment. Repository-side MCP behavior is CI-tested, but host acceptance must not be invented.

## Highest-value next actions

1. Wire `RunOverview` to an authenticated read-only `GET /v1/runs/:runId/overview` route under `agent:read`, plus the typed TypeScript client, with an HTTP regression proving instruction text cannot leak through that response.
2. Update `/operator` to use that endpoint and visually distinguish the current independent scope, unresolved blocked scopes, and queued-steering count during the hackathon demo.
3. Add operator-console regression coverage for the new overview indicators without embedding credentials or sensitive steering text in the page.
4. When a real Claude Code host is available, run the documented stdio MCP registration and fake-provider acceptance flow.
5. When the user-only CALL-E prerequisites are available, perform a carefully bounded live provider acceptance test and record the actual result without weakening duplicate-call/idempotency safeguards.
