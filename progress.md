# CallYourAgent progress

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. Agents can raise important owner decisions without freezing unrelated scopes; owners can independently request callbacks for progress/questions/steering; human input is persisted and consumed only at explicit safe checkpoints rather than pretending to interrupt in-flight model generation.

The repository includes SQLite persistence, deterministic fake and production CALL-E providers, replayable/idempotent call attempts, polling/webhook convergence, scoped authenticated HTTP APIs, a typed TypeScript client, stdio MCP, branch-scoped blocking, call policy/quiet hours/budgets, privacy-aware audit history, bounded lifecycle recovery, fail-closed ambiguous/stalled handling, API abuse controls, graceful shutdown, hard CALL-E HTTP deadlines, reproducible dependencies, readiness/liveness surfaces, a deterministic end-to-end demo, operator console, production Docker image, and single-instance persistent-volume Compose deployment.

This run strengthened the durable owner-instruction contract with explicit exact-ID acknowledgement.

## Exact repo state inspected this run

Before changing anything, inspected the complete recursive `main` tree at HEAD `d2d4f534b7a2cec9fcc6febb561e9bbd0cde09c4`; the tree covered source, tests, CI workflows, package metadata, Docker/deployment assets, and every documentation path.

Read `AGENTS.md`, this file, `README.md`, `docs/ARCHITECTURE.md`, `docs/INTEGRATIONS.md`, `docs/CALL_POLICY.md`, `docs/API_SECURITY.md`, `docs/DEPLOYMENT.md`, `docs/OPERATOR_CONSOLE.md`, and `deploy/README.md` in full. Inspected recent commits through the readiness work. Checked open issues and pull requests; there were none.

Inspected the implementation surfaces relevant to the selected increment: `src/domain.ts`, `src/control-plane.ts`, `src/http-server.ts`, `src/client.ts`, `src/mcp-server.ts`, `tests/control-plane.test.ts`, and `tests/http-server.test.ts`.

## Changes made this run

### Two-phase instruction delivery and acknowledgement

Added `ControlPlane.acknowledgeInstructions(runId, instructionIds)`.

The preferred worker flow is now:

1. call `checkpoint(runId)` without consuming;
2. incorporate the returned owner instructions at that safe work boundary;
3. acknowledge exactly those durable instruction ids;
4. leave instructions that arrived after the checkpoint queued for the next boundary.

Acknowledgement validates every supplied instruction before mutating state, rejects cross-run ids, deduplicates duplicate ids, and is idempotent for retries. An already-consumed instruction is returned without creating another consumption audit event. The consumption audit explicitly records that acknowledgement followed safe-checkpoint incorporation.

The existing `checkpoint(runId, true)` path remains as a backwards-compatible one-step mode and internally delegates to exact acknowledgement of the checkpoint snapshot. New integrations should prefer the two-phase protocol because it distinguishes “instruction was delivered” from “agent says it incorporated this exact instruction.”

### Shared HTTP, SDK, and MCP surface

Added authenticated `POST /v1/runs/:runId/instructions/ack` under the existing `agent:write` scope with body `{ instructionIds: string[] }`.

Added `CallYourAgentClient.acknowledgeInstructions(...)` to the typed TypeScript client.

Added MCP tool `acknowledge_owner_instructions`. The MCP `checkpoint` tool now recommends the safe two-phase pattern and labels `consume=true` as compatibility behavior rather than the preferred contract.

Updated `docs/INTEGRATIONS.md` for Claude/Claude Code, Codex, and generic agents to use pull -> incorporate -> exact acknowledgement semantics.

### Regression coverage

Added domain tests proving:

- a later-arriving instruction remains queued when only the prior checkpoint ids are acknowledged;
- acknowledgement retries/duplicate ids are idempotent and do not duplicate audit events;
- a cross-run acknowledgement batch fails before any instruction is consumed.

Added HTTP regression coverage proving the new route consumes only the requested ids, leaves later steering queued, and rejects malformed instruction id arrays.

## Architecture decisions made this run

1. Instruction delivery and instruction incorporation are separate facts. A checkpoint may expose durable steering, but consumption should normally be recorded only after the worker confirms exactly what it incorporated.
2. Exact durable ids are the acknowledgement boundary. This avoids a race where new owner steering arriving after a checkpoint could be accidentally swept into an acknowledgement intended for older work.
3. Acknowledgement is run-scoped and validates the whole batch before mutation, preventing partial cross-run consumption.
4. Retries are idempotent and do not produce duplicate `owner_instruction_consumed` audit events.
5. The compatibility `consume=true` path is preserved to avoid breaking existing integrations, while the typed SDK/MCP documentation directs new integrations to the safer two-phase protocol.
6. This does not introduce any mid-generation interruption model. Agents still pull and incorporate owner steering only at explicit safe checkpoints.
7. HTTP, MCP, and platform adapters continue to share the same core control-plane semantics; no platform-specific state machine was added.

## Verification performed

Commits created this run:

- `7acef31846573e1ed7064fabfcc66868d587cc20` — `feat: add exact instruction acknowledgement`
- `51da0771583b1d6f70d51974d7ac52c3dfa41b5c` — `feat: expose instruction acknowledgement to agents`
- `a9c93f6bc0599287c34bc98d9e9367a74d47f5c8` — `test: cover exact instruction acknowledgement API`

GitHub Actions for `7acef31846573e1ed7064fabfcc66868d587cc20` all completed successfully: CI run `34109287641`, Container run `34109287562`, and Compose deployment run `34109287575`.

GitHub Actions for `51da0771583b1d6f70d51974d7ac52c3dfa41b5c` also completed successfully, including CI run `34109523735` and Container run `34109523814`; the full workflow set was triggered by the push.

For final code/test state `a9c93f6bc0599287c34bc98d9e9367a74d47f5c8`, CI run `34109738997` completed successfully, covering the locked dependency install and repository check pipeline (TypeScript typecheck, build, and compiled tests including the new HTTP acknowledgement test). Container run `34109738983` and Compose deployment run `34109739018` were running when this progress entry was written; prior code-bearing states in the same run had already passed both deployment workflows.

A direct local clone was not available in this execution environment because outbound DNS to GitHub failed, so repository mutation and authoritative verification were performed through the connected GitHub API and GitHub Actions rather than fabricating local test results.

No live CALL-E call was attempted or claimed.

## CALL-E integration status

- Fake provider: implemented and tested for owner decisions, callbacks, branch-scoped blocking, durable queued steering, safe checkpoint consumption, exact instruction acknowledgement, idempotency, policy/lifecycle recovery, auditability, SQLite restart, deterministic demo, operator visualization, container boot, and persistent Compose deployment.
- Production CALL-E adapter: implemented with server-only `CALLE_API_KEY`, structured result handling, provider idempotency, polling, terminal webhook reconciliation, duplicate-call prevention, bounded HTTP requests, exact-key ambiguous replay, and fail-closed stalled handling.
- HTTP + typed TypeScript SDK + MCP surfaces: implemented, now including exact instruction acknowledgement.
- Live CALL-E success: unverified; no real authorized call has been made in this run.

## Current blockers / external prerequisites

No repository-development blocker currently prevents further useful work.

Live CALL-E verification still requires user-controlled prerequisites: a valid/authorized CALL-E credential, authorized owner destination, and stable public HTTPS webhook ingress with the configured webhook capability token. These are required before claiming a real phone call succeeds.

Real Claude Code host acceptance still requires running the documented MCP registration and workflow in an actual Claude Code environment. The repository-side stdio MCP contract remains implemented and CI-tested, but host acceptance should not be invented.

## Highest-value next actions

1. Extend the operator/demo surface to show unresolved blocking scopes and queued instruction counts clearly, while keeping instruction text behind authenticated APIs.
2. Add a focused SDK/MCP acceptance test for the new acknowledgement tool path so host adapters explicitly exercise pull -> incorporate -> ack semantics end to end.
3. When a real Claude Code host is available, run the documented stdio MCP registration and perform an acceptance flow using a deterministic fake provider.
4. When the user-only CALL-E prerequisites are available, perform a carefully bounded live provider acceptance test and record the actual result without weakening duplicate-call/idempotency safeguards.
