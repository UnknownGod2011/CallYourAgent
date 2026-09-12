# CallYourAgent progress

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. Agents can request important owner decisions without freezing unrelated scopes; owners can request context-aware callbacks; human input is persisted as structured state and consumed only at explicit safe checkpoints. The repository includes deterministic fake and production CALL-E providers, SQLite persistence, replayable/idempotent call attempts, polling/webhook convergence, branch-scoped blocking, durable decisions and instruction queues, quiet hours/call budgets, bounded recovery, privacy-aware audit history, scoped HTTP auth, typed SDK, stdio MCP, lifecycle worker, operator console, deterministic demos, and a single-instance Compose reference deployment.

## Exact repo state inspected this run

Started from `main` at commit `4e1028822187427ed6e32038eb9eeb512bb24d5a`. Before changes, inspected the full repository tree and current source/test inventory, recent commits, `AGENTS.md`, this file, `README.md`, all architecture/integration/deployment/security/policy/acceptance documents under `docs/` plus `deploy/README.md`, and relevant issue/PR search results. No open issue or pull request required a different priority. The audit confirmed that `ControlPlaneStore.updateRunIfCurrent(...)` and the heartbeat CAS seam are covered, while `ControlPlane.heartbeat(...)` still performs a direct run replacement.

## Changes made this run

Added `src/instruction-consume.ts` with a safe-checkpoint consumption seam that:

- consumes an instruction only while its durable status is still `queued`;
- returns `consumed: false` plus the durable winner for stale/replayed consumers;
- writes an explicit `consumedAt` timestamp;
- returns an isolated snapshot so callers cannot mutate canonical store state through the result;
- is intentionally composable inside the store transaction boundary for future audit publication.

Added `tests/instruction-consume.test.ts` covering one-time consumption, snapshot isolation, and replay behavior.

This increment does not yet route `ControlPlane.checkpoint(..., consume=true)` through the helper; that remains the next integration step so instruction status changes and audit publication can be made conditional on a committed consumer.

## Verification performed

- Full repository tree and architecture/integration docs inspected before changes.
- Recent commits and issue/PR search inspected; no relevant open issue or PR.
- Added `src/instruction-consume.ts` in commit `1caa431a26cb143322dd4f029d080fa5cb036028`.
- Added `tests/instruction-consume.test.ts` in commit `352f9421d80ad98c2c68aa7a7e4e59e08798383c`.
- Updated this progress record after the code changes.
- The connector does not expose a local clone/runtime, so fresh test/typecheck/build execution was not available during this run and is not claimed.
- Previous authoritative baseline remains: CI passed on Node `24.20.0` with `212/212` tests, container verification succeeded, and the full Compose fake-provider/MCP/restart acceptance succeeded.

No live CALL-E phone call was attempted or claimed.

## Architecture decisions made this run

1. Treat instruction consumption as a conditional durable mutation, not an in-memory acknowledgement.
2. Make safe-checkpoint consumers receive the durable winner when a replay races a prior consumer.
3. Preserve audit publication as a caller concern until the helper is integrated into `ControlPlane.checkpoint`.
4. Preserve branch-scoped blocking, callback semantics, and no-mid-generation-interruption behavior unchanged.

## CALL-E integration status

- Fake provider: deterministic, credential-free, idempotent, restart-rehydratable, and the complete acceptance provider.
- Production adapter: implemented with server-side `CALLE_API_KEY`, idempotency, bounded create/polling, persisted correlation, webhook/poll convergence, duplicate prevention, restart recovery, fail-closed ambiguity, and strict authenticated base-URL validation.
- No live CALL-E connectivity or owner-phone authorization has been verified.

## Current blockers / external prerequisites

No repository-development blocker prevents further useful work.

A genuine Claude Code host acceptance still requires a real Claude Code environment/CLI. Live CALL-E acceptance still requires a valid authorized credential, owner phone destination, and stable externally reachable HTTPS webhook ingress. The automation connector lacks a local clone/runtime and safe multi-file patch workflow, so runtime verification must continue through GitHub Actions after code commits.

## Highest-value next actions

1. Wire `ControlPlane.heartbeat` through `commitHeartbeat(...)` and use `heartbeatAuditPayload(...)` so stale writers return the authoritative winner and emit no progress event.
2. Route `ControlPlane.checkpoint(..., consume=true)` through `consumeInstructionIfQueued(...)` and make `owner_instruction_consumed` audit conditional on the winning consumer.
3. Extend heartbeat integration coverage with stale-writer rejection, audit suppression, newer-terminal-state preservation, and rollback cases.
4. Add an exact instruction acknowledgement conditional primitive at the persistence boundary for multi-worker SQLite parity.
5. Audit escalation reservation/deferral/expiry, active-call progress, and ambiguous recovery for stale whole-entity writes.
6. Continue runtime string configuration and HTTP semantic-boundary hardening.
7. Preserve the fake-provider acceptance path while keeping UI work secondary.
8. Run the documented acceptance in a genuine Claude Code host when available.
9. Perform one tightly bounded live CALL-E acceptance only after user-controlled prerequisites are available.
