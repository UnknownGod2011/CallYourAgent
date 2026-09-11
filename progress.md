# CallYourAgent progress

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. Agents can request important owner decisions without freezing unrelated scopes; owners can request context-aware callbacks; human input is persisted as structured state and consumed only at explicit safe checkpoints. The repository includes deterministic fake and production CALL-E providers, SQLite persistence, replayable/idempotent call attempts, polling/webhook convergence, branch-scoped blocking, durable decisions and instruction queues, quiet hours/call budgets, bounded recovery, privacy-aware audit history, scoped HTTP auth, typed SDK, stdio MCP, lifecycle worker, operator console, deterministic demos, and a single-instance Compose reference deployment.

## Exact repo state inspected this run

Started from `main` at commit `6e4f13855e5def51c2c943feaed27a3b02b23cad`. Before changes, inspected the full repository tree and current source/test inventory, recent commits, open issues/PRs, `AGENTS.md`, this file, `README.md`, and every architecture/integration/deployment/security/policy/acceptance document under `docs/` plus `deploy/README.md`. No open issue or pull request required a different priority. The audit confirmed that `ControlPlaneStore.updateRunIfCurrent(...)` is implemented and covered by focused store regressions, while `ControlPlane.heartbeat(...)` still performs a direct run replacement.

## Changes made this run

Added `docs/HEARTBEAT_CAS_ACCEPTANCE.md` as the executable acceptance target for the next runtime change. It defines the required public behavior for routing `ControlPlane.heartbeat(...)` through the store CAS primitive, including stale-writer rejection, preservation of newer paused/terminal state and unrelated fields, audit suppression for rejected writes, snapshot isolation, rollback safety, and convergence across independent SQLite connections. It also records the minimum regression cases and preserves the safe-checkpoint/no-mid-generation-interruption boundary.

## Verification performed

- Full repository tree and all architecture/integration docs inspected before the change.
- Recent commits and open issues/PRs inspected; no relevant open issue or PR.
- Added `docs/HEARTBEAT_CAS_ACCEPTANCE.md` in commit `60fb598969e7b28409a028e7721e3df36e7c8f11`.
- No local runtime is available in the connector, so no fresh test/typecheck/build result is claimed for this documentation increment.
- Previous authoritative baseline remains: CI passed on Node `24.20.0` with `212/212` tests, container verification succeeded, and the full Compose fake-provider/MCP/restart acceptance succeeded.

No live CALL-E phone call was attempted or claimed.

## Architecture decisions made this run

1. Keep the public heartbeat CAS target explicit before touching the large control-plane source file.
2. Treat the existing store primitive as the only freshness authority; do not reimplement compare-and-set in the domain layer.
3. Require audit publication to follow the winning mutation only; stale losers must be silent.
4. Preserve branch-scoped blocking and safe-checkpoint instruction semantics unchanged.

## CALL-E integration status

- Fake provider: deterministic, credential-free, idempotent, restart-rehydratable, and the complete acceptance provider.
- Production adapter: implemented with server-side `CALLE_API_KEY`, idempotency, bounded create/polling, persisted correlation, webhook/poll convergence, duplicate prevention, restart recovery, fail-closed ambiguity, and strict authenticated base-URL validation.
- No live CALL-E connectivity or owner-phone authorization has been verified.

## Current blockers / external prerequisites

No repository-development blocker prevents further useful work.

A genuine Claude Code host acceptance still requires a real Claude Code environment/CLI. Live CALL-E acceptance still requires a valid authorized credential, owner phone destination, and stable externally reachable HTTPS webhook ingress. The automation connector lacks a safe partial-update mechanism for the large control-plane source file and does not expose a usable direct clone/runtime path, so runtime verification must continue through GitHub Actions after the next code commit.

## Highest-value next actions

1. Wire `ControlPlane.heartbeat` through `updateRunIfCurrent` and return the authoritative winner on stale races.
2. Extend `tests/heartbeat-contract.test.ts` with stale-writer, audit-suppression, and newer-terminal-state cases once the integration lands.
3. Add an exact instruction acknowledgement conditional primitive and route safe-checkpoint consumption through it.
4. Audit escalation reservation/deferral/expiry, active-call progress, and ambiguous recovery for stale whole-entity writes.
5. Continue runtime string configuration and HTTP semantic-boundary hardening.
6. Preserve the fake-provider acceptance path while keeping UI work secondary.
7. Run the documented acceptance in a genuine Claude Code host when available.
8. Perform one tightly bounded live CALL-E acceptance only after user-controlled prerequisites are available.
