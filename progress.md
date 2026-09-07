# CallYourAgent progress

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. Agents can raise important owner decisions without freezing unrelated scopes; owners can independently request callbacks for progress/questions/steering; human input is persisted and consumed only at explicit safe checkpoints rather than pretending to interrupt in-flight model generation.

The repository includes SQLite persistence, deterministic fake and production CALL-E providers, replayable/idempotent call attempts, polling/webhook convergence, scoped authenticated HTTP APIs, a typed TypeScript client, stdio MCP, branch-scoped blocking, call policy/quiet hours/budgets, privacy-aware audit history, bounded lifecycle recovery, fail-closed ambiguous/stalled handling, API abuse controls, graceful shutdown, hard CALL-E HTTP deadlines, reproducible dependencies, readiness/liveness surfaces, a deterministic end-to-end demo, operator console, production Docker image, and single-instance persistent-volume Compose deployment.

This run strengthened external-host confidence by making the Claude-style MCP acceptance flow exercise the preferred two-phase owner-instruction protocol rather than the legacy one-step consume path.

## Exact repo state inspected this run

Before making changes, inspected the complete recursive `main` tree at HEAD `23a08666d15cc30c991c810273bb441c8d9730fc`, including source, tests, CI workflows, package metadata, Docker/deployment assets, and documentation paths.

Read `AGENTS.md`, this file, `README.md`, `docs/ARCHITECTURE.md`, and `docs/INTEGRATIONS.md` in full before editing. Inspected recent commits through the exact instruction-acknowledgement work. Checked open issues and pull requests; there were none.

Inspected the implementation and test surfaces relevant to this increment: `src/control-plane.ts`, `src/http-server.ts`, `src/client.ts`, `src/mcp-server.ts`, `src/operator-ui.ts`, `src/domain.ts`, and `tests/mcp-work-loop.test.ts`. The existing MCP work-loop test still used the backwards-compatible `checkpoint(..., consume=true)` path even though the documented preferred integration contract is pull -> incorporate -> acknowledge exact ids.

## Changes made this run

### MCP acceptance now proves exact acknowledgement semantics

Updated the Claude-style MCP work-loop test so it now:

1. creates and resolves a blocking branch-scoped escalation while proving unrelated work continues;
2. requests an owner callback and receives two durable steering instructions;
3. pulls those instructions with `checkpoint(..., consume=false)`;
4. simulates a third owner instruction arriving after that safe checkpoint but before acknowledgement;
5. calls the real MCP `acknowledge_owner_instructions` tool with exactly the two ids incorporated by the worker;
6. verifies the later instruction remains queued for the next checkpoint;
7. retries the same acknowledgement and verifies it remains idempotent;
8. acknowledges the later instruction separately and verifies the queue is empty.

This exercises the MCP adapter -> typed HTTP client -> authenticated HTTP route -> shared `ControlPlane.acknowledgeInstructions` path end to end using the deterministic fake provider and real MCP in-memory transport.

### CI-discovered test-shape fix

The first revision incorrectly assumed the MCP acknowledgement tool returned an object containing `instructions`. CI correctly exposed that the MCP tool serializes the typed client result directly as an array. The test was fixed to parse MCP result payloads as `unknown` and cast according to each tool's actual result shape. No production contract was changed to accommodate the test.

## Architecture decisions made this run

1. External-host acceptance should exercise the preferred two-phase steering contract, not only unit/domain tests.
2. The race that matters is instruction arrival between checkpoint delivery and acknowledgement; acceptance coverage now models that directly.
3. Later-arriving steering must remain durable and queued until a later safe checkpoint.
4. MCP remains a thin transport over the same HTTP/SDK/control-plane semantics; this run added no MCP-only state machine.
5. The system still does not claim mid-token interruption. Owner steering is incorporated only at explicit worker checkpoints.
6. Production behavior was not weakened to make the acceptance test pass; the failed first CI run was treated as evidence about the actual MCP result shape and the test was corrected.

## Verification performed

Commits created this run:

- `77e8469c281da19e1f71e9b426f4682b71b49086` — `test: exercise exact MCP instruction acknowledgement`
- `94e43a6d2107b76c397ad88c802d9ff5f70d8948` — `fix: parse MCP acknowledgement array result`

The first commit's CI run `34114621292` failed one MCP work-loop assertion because the test expected `{ instructions: [...] }` while the real MCP tool returns the instruction array directly. The failure was inspected from the GitHub Actions job logs and fixed without changing production semantics.

For corrected code/test state `94e43a6d2107b76c397ad88c802d9ff5f70d8948`:

- CI run `34114762751` completed successfully, including locked `npm ci`, TypeScript typecheck, build, and the full compiled Node test suite with the revised MCP acceptance flow.
- Compose deployment run `34114762750` completed successfully.
- The push also triggered the existing production Container workflow; no source/container behavior was changed in this test-focused increment.

A direct local clone was not used in this execution environment; authoritative repository mutation and verification were performed through the connected GitHub API and GitHub Actions. No test result was fabricated.

No live CALL-E call was attempted or claimed.

## CALL-E integration status

- Fake provider: implemented and tested for owner decisions, callbacks, branch-scoped blocking, durable queued steering, safe checkpoint consumption, exact instruction acknowledgement, idempotency, policy/lifecycle recovery, auditability, SQLite restart, deterministic demo, operator visualization, container boot, persistent Compose deployment, and now a Claude-style MCP work-loop race around exact acknowledgement.
- Production CALL-E adapter: implemented with server-only `CALLE_API_KEY`, structured result handling, provider idempotency, polling, terminal webhook reconciliation, duplicate-call prevention, bounded HTTP requests, exact-key ambiguous replay, and fail-closed stalled handling.
- HTTP + typed TypeScript SDK + MCP surfaces: implemented and sharing the same control-plane semantics.
- Live CALL-E success: unverified; no real authorized call was made in this run.

## Current blockers / external prerequisites

No repository-development blocker currently prevents further useful work.

Live CALL-E verification still requires user-controlled prerequisites: a valid/authorized CALL-E credential, authorized owner destination, and stable public HTTPS webhook ingress with the configured webhook capability token. These are required before claiming a real phone call succeeds.

Real Claude Code host acceptance still requires running the documented stdio MCP registration and workflow in an actual Claude Code environment. Repository-side MCP protocol behavior now has stronger end-to-end acceptance coverage, but host acceptance must not be invented.

## Highest-value next actions

1. Add a read-only run-overview contract that exposes unresolved blocking scopes and queued-instruction count without returning instruction text, then use it in the operator console so hackathon judges can immediately see branch-level blocking and pending steering.
2. Update the operator/demo surface to visually distinguish blocked scopes, independent active scope, and queued steering using that read-only contract.
3. When a real Claude Code host is available, run the documented stdio MCP registration and acceptance flow with the deterministic fake provider.
4. When the user-only CALL-E prerequisites are available, perform a carefully bounded live provider acceptance test and record the actual result without weakening duplicate-call/idempotency safeguards.
