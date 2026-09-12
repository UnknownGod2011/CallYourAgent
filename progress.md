# CallYourAgent progress

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. Agents can request important owner decisions without freezing unrelated scopes; owners can request context-aware callbacks; human input is persisted as structured state and consumed only at explicit safe checkpoints. The repository includes deterministic fake and production CALL-E providers, SQLite persistence, replayable/idempotent call attempts, polling/webhook convergence, branch-scoped blocking, durable decisions and instruction queues, quiet hours/call budgets, bounded recovery, privacy-aware audit history, scoped HTTP auth, typed SDK, stdio MCP, lifecycle worker, operator console, deterministic demos, and a single-instance Compose reference deployment.

## Exact repo state inspected this run

Started from `main` at commit `4492199f1743a96f34de0bd54fc5ea529628e7c8` before this run's changes. Inspected the complete repository tree and current source/test inventory, recent commits, `AGENTS.md`, this file, `README.md`, all architecture/integration/deployment/security/policy/acceptance documents under `docs/` plus `deploy/README.md`, and relevant issue/PR search results. No open issue or pull request required a different priority. The audit confirmed the main `ControlPlane.heartbeat(...)` and `ControlPlane.checkpoint(..., consume=true)` methods still use direct in-method mutations, while dedicated runtime seams exist for safe migration.

## Changes made this run

Added `src/checkpoint-audit.ts` with a pure helper that builds the `owner_instruction_consumed` audit payload only from instructions that actually won the conditional transition to `consumed`.

Added `tests/checkpoint-audit.test.ts` covering empty consumption and deterministic instruction-id/count payload generation.

Exported the helper from `src/index.ts`.

Commits created this run:

- `49c8f9ef24b27e6b34b38cbaf6a1501c22209115` — Add checkpoint instruction audit payload helper
- `3978d49b4803e1e2a3fc48755a39c0a4676d047e` — Test checkpoint instruction audit payload helper
- `c3cf6d343d79d62ca1189bd78576658a602c4929` — Export checkpoint audit helper

## Verification performed

- Full repository tree and architecture/integration docs inspected before changes.
- Recent commits and issue/PR search inspected; no relevant open issue or PR.
- New code and tests were committed through the GitHub connector.
- The connector does not expose a local clone/runtime, so fresh test/typecheck/build execution was not available during this run and is not claimed.
- Previous authoritative baseline remains: CI passed on Node `24.20.0` with `212/212` tests, container verification succeeded, and the full Compose fake-provider/MCP/restart acceptance succeeded.

No live CALL-E phone call was attempted or claimed.

## Architecture decisions made this run

1. Keep checkpoint state transition and audit-payload derivation separate so only the winning conditional consumer can produce `owner_instruction_consumed` details.
2. Preserve immutable snapshots and durable replay/race semantics.
3. Keep audit publication outside the pure helper so the eventual control-plane transaction can decide the exact event envelope.
4. Preserve branch-scoped blocking, callback semantics, and no-mid-generation-interruption behavior unchanged.

## CALL-E integration status

- Fake provider: deterministic, credential-free, idempotent, restart-rehydratable, and the complete acceptance provider.
- Production adapter: implemented with server-side `CALLE_API_KEY`, idempotency, bounded create/polling, persisted correlation, webhook/poll convergence, duplicate prevention, restart recovery, fail-closed ambiguity, and strict authenticated base-URL validation.
- No live CALL-E connectivity or owner-phone authorization has been verified.

## Current blockers / external prerequisites

No repository-development blocker prevents further useful work.

A genuine Claude Code host acceptance still requires a real Claude Code environment/CLI. Live CALL-E acceptance still requires a valid authorized credential, owner phone destination, and stable externally reachable HTTPS webhook ingress. The automation connector lacks a local clone/runtime and safe multi-file patch workflow, so runtime verification must continue through GitHub Actions after code commits.

## Highest-value next actions

1. Wire `ControlPlane.heartbeat` through `applyHeartbeatAtRuntime(...)` and publish `run_status_reported` only when the CAS write wins.
2. Wire `ControlPlane.checkpoint(..., consume=true)` through `applyCheckpointAtRuntime(...)`, with conditional `owner_instruction_consumed` auditing using `checkpointInstructionAuditPayload(...)`.
3. Extend integration coverage with stale heartbeat rejection, newer terminal-state preservation, rollback, and multi-worker SQLite parity.
4. Add an exact persistence-level conditional acknowledgement primitive if the SQLite implementation needs stronger parity than the in-memory seam.
5. Audit escalation reservation/deferral/expiry, active-call progress, and ambiguous recovery for stale whole-entity writes.
6. Continue runtime string configuration and HTTP semantic-boundary hardening.
7. Preserve the fake-provider acceptance path while keeping UI work secondary.
8. Run the documented acceptance in a genuine Claude Code host when available.
9. Perform one tightly bounded live CALL-E acceptance only after user-controlled prerequisites are available.

## Latest Codex takeover record — 2026-09-12

### Repository state inspected

Started from clean `main` at commit `64e5615f48b3fa75bcdf0997d9dd9df7fdd89c04`. Inspected the complete repository tree; source, tests, manifests, runtime/deployment configuration, environment example, recent commits, branches, GitHub issues and pull requests; `AGENTS.md`, this file, `README.md`, and all architecture, integration, deployment, security, policy, persistence, and acceptance documents under `docs/` plus `deploy/README.md`. There are no open repository issues or PRs. Current CALL-E documentation was checked against the production adapter: authenticated `POST /v1/calls`, idempotency, status polling, webhooks, and server-side credentials align with the adapter's existing integration.

### Changes made

- Wired `ControlPlane.heartbeat(...)` to the CAS runtime seam. A heartbeat returns the durable winner and writes `run_status_reported` only when its conditional update succeeds. Timestamps advance monotonically even when two operations fall in the same millisecond.
- Wired consuming `ControlPlane.checkpoint(...)` calls to the safe-checkpoint runtime seam and its transaction. Only instructions that win the queued-to-consumed transition receive an `owner_instruction_consumed` audit event; a losing or replayed consumer emits none.
- Declared the existing `paused` run-state contract in the domain type, and converted two accidentally Vitest-based tests to the repository's Node built-in test runner so the advertised test command compiles without an undeclared dependency.
- Fixed SQLite audit-sequence initialization across reopen, enforced provider-call uniqueness at the SQL layer, and checkpointed WAL before shutdown so short-lived Windows workers can clean up their state directories.
- Added a control-plane heartbeat regression that simulates a competing CAS winner and proves the stale reporter receives the authoritative paused snapshot without a false progress audit.

### Tests and checks

- `npm ci` completed without vulnerabilities. The default shell Node 22 is below the project minimum and was not used for final verification.
- Bundled Node `24.19.0`: `tsc -p tsconfig.json --noEmit` — PASS.
- Bundled Node `24.19.0`: build — PASS.
- Bundled Node `24.19.0`: full test suite — PASS, `230/230` tests.
- Bundled Node `24.19.0`: deterministic fake-provider demo — PASS.
- `git diff --check` — PASS.

### CALL-E status and blockers

The fake provider is deterministic, credential-free, idempotent, restart-rehydratable, and the full local acceptance path. The production adapter is implemented with server-side `CALLE_API_KEY`, idempotency, bounded create/polling, persisted correlation, webhook/poll convergence, duplicate prevention, restart recovery, and fail-closed ambiguity. No live CALL-E connectivity or phone call has been attempted or verified.

Live acceptance requires a valid authorized credential, an owner phone number explicitly authorized for the test, and stable externally reachable HTTPS webhook ingress. A genuine Claude Code host acceptance also requires a Claude Code environment/CLI.

### Next actions

1. Add independent SQLite-worker tests for public heartbeat and consuming-checkpoint behavior, including a newer terminal/paused winner.
2. Add a persistence-level conditional instruction-acknowledgement primitive if multi-worker checkpoint testing exposes a gap.
3. Perform the documented Claude Code host acceptance when that host is available.
4. Perform one tightly bounded live CALL-E acceptance only after the user-controlled prerequisites are available.
