# CallYourAgent progress

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. Agents can request important owner decisions without freezing unrelated scopes; owners can request context-aware callbacks; human input is persisted as structured state and consumed only at explicit safe checkpoints. The repository includes deterministic fake and production CALL-E providers, SQLite persistence, replayable/idempotent call attempts, polling/webhook convergence, branch-scoped blocking, durable decisions and instruction queues, quiet hours/call budgets, bounded recovery, privacy-aware audit history, scoped HTTP auth, typed SDK, stdio MCP, lifecycle worker, operator console, deterministic demos, and a single-instance Compose reference deployment.

## Exact repo state inspected this run

Started from `main` at commit `24115888e4137ae5547825e0dca96326f8119506`. Before changes, inspected the full repository tree and current source/test inventory, recent commits, open issues/PRs, `AGENTS.md`, this file, `README.md`, and every architecture/integration/deployment/security/policy/acceptance document under `docs/` plus `deploy/README.md`. No open issue or pull request required a different priority. The audit confirmed that `ControlPlaneStore.updateRunIfCurrent(...)` is implemented and covered by focused store regressions, while `ControlPlane.heartbeat(...)` still performs a direct run replacement.

## Changes made this run

Added `src/heartbeat-commit.ts` with a small CAS commit seam that:

- reads the authoritative run snapshot;
- builds an immutable heartbeat candidate through `buildHeartbeatCandidate(...)`;
- commits through `ControlPlaneStore.updateRunIfCurrent(...)`;
- returns `audit: true` only for the CAS winner, preventing stale writers from publishing progress they did not commit;
- exposes a deterministic `heartbeatAuditPayload(...)` helper for the eventual control-plane audit call.

Added `tests/heartbeat-commit.test.ts` covering first-writer-wins behavior, stale-writer rejection, durable-winner return, store-state preservation, and audit payload derivation.

This is an intentionally narrow integration seam. `ControlPlane.heartbeat(...)` is not yet wired to it because the connector does not expose a safe partial update path for the large control-plane file; the existing CAS primitive remains authoritative.

## Verification performed

- Full repository tree and all architecture/integration docs inspected before the change.
- Recent commits and open issues/PRs inspected; no relevant open issue or PR.
- Added `src/heartbeat-commit.ts` in commit `511526163698d667dd131bcd7f8d6b120671ea70`.
- Added `tests/heartbeat-commit.test.ts` in commit `20afa02e1dae5e3188f0e3b45203bc108c4a9ebb`.
- Updated this progress record after the code changes.
- The connector does not expose a local clone/runtime, so fresh test/typecheck/build execution was not available during this run and is not claimed.
- Previous authoritative baseline remains: CI passed on Node `24.20.0` with `212/212` tests, container verification succeeded, and the full Compose fake-provider/MCP/restart acceptance succeeded.

No live CALL-E phone call was attempted or claimed.

## Architecture decisions made this run

1. Keep heartbeat candidate construction pure and immutable.
2. Centralize CAS commit semantics in a small helper so the eventual `ControlPlane.heartbeat(...)` migration has one tested integration point.
3. Treat audit publication as contingent on `RunMutationResult.applied`; stale writers must be observationally silent.
4. Preserve branch-scoped blocking and safe-checkpoint instruction semantics unchanged.

## CALL-E integration status

- Fake provider: deterministic, credential-free, idempotent, restart-rehydratable, and the complete acceptance provider.
- Production adapter: implemented with server-side `CALLE_API_KEY`, idempotency, bounded create/polling, persisted correlation, webhook/poll convergence, duplicate prevention, restart recovery, fail-closed ambiguity, and strict authenticated base-URL validation.
- No live CALL-E connectivity or owner-phone authorization has been verified.

## Current blockers / external prerequisites

No repository-development blocker prevents further useful work.

A genuine Claude Code host acceptance still requires a real Claude Code environment/CLI. Live CALL-E acceptance still requires a valid authorized credential, owner phone destination, and stable externally reachable HTTPS webhook ingress. The automation connector lacks a safe partial-update mechanism for the large control-plane source file and does not expose a usable direct clone/runtime path, so runtime verification must continue through GitHub Actions after the next code commit.

## Highest-value next actions

1. Wire `ControlPlane.heartbeat` through `commitHeartbeat(...)` and use `heartbeatAuditPayload(...)` so stale writers return the authoritative winner and emit no progress event.
2. Extend heartbeat integration coverage with stale-writer rejection, audit suppression, newer-terminal-state preservation, and rollback cases.
3. Add an exact instruction acknowledgement conditional primitive and route safe-checkpoint consumption through it.
4. Audit escalation reservation/deferral/expiry, active-call progress, and ambiguous recovery for stale whole-entity writes.
5. Continue runtime string configuration and HTTP semantic-boundary hardening.
6. Preserve the fake-provider acceptance path while keeping UI work secondary.
7. Run the documented acceptance in a genuine Claude Code host when available.
8. Perform one tightly bounded live CALL-E acceptance only after user-controlled prerequisites are available.
