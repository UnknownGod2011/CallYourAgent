# CallYourAgent progress

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. Agents can request important owner decisions without freezing unrelated scopes; owners can request context-aware callbacks; human input is persisted as structured state and consumed only at explicit safe checkpoints. The repository includes deterministic fake and production CALL-E providers, SQLite persistence, replayable/idempotent call attempts, polling/webhook convergence, branch-scoped blocking, durable decisions and instruction queues, quiet hours/call budgets, bounded recovery, privacy-aware audit history, scoped HTTP auth, typed SDK, stdio MCP, lifecycle worker, operator console, deterministic demos, and a single-instance Compose reference deployment.

## Exact repo state inspected this run

Started from `main` after the PR #51 handoff and the stale-write matrix documentation. Before changes, inspected the recursive repository tree, current source inventory, recent commits, open issues, open pull requests, `AGENTS.md`, this file, `README.md`, and the architecture/integration/deployment/security/policy/acceptance documents under `docs/` plus `deploy/README.md`. No open issues or pull requests were present before this run.

The audit confirmed that the next correctness phase is shared-store freshness: explicit conditional/CAS behavior for stale-read mutations, starting with run status/heartbeat and exact instruction acknowledgement, followed by escalation/call reservation and active-call recovery paths.

## Changes made this run

Added a conditional run mutation contract to the persistence boundary:

- `ControlPlaneStore.updateRunIfCurrent(runId, expectedUpdatedAt, next)` now expresses first-writer-wins semantics for run mutations.
- The in-memory adapter implements rollback-safe compare-and-set behavior and returns the authoritative winner when a stale writer loses.
- The SQLite adapter reloads the authoritative run mirror inside the existing `BEGIN IMMEDIATE` transaction before applying the compare-and-set, preventing a stale independent connection from overwriting newer status/heartbeat state.

The control-plane heartbeat call has not yet been switched to this new primitive in this handoff because the connector rejected the attempted full-file update after the source file changed during the run. The store contract and both adapters are committed and remain additive; the highest-value follow-up is to route `ControlPlane.heartbeat` through the primitive and add stale-writer race regressions before widening the pattern to instruction acknowledgement.

## Verification performed

- GitHub repository metadata and recursive tree were inspected.
- `AGENTS.md`, `progress.md`, `README.md`, and all architecture/integration/deployment/security/policy/acceptance documents were read before the change.
- Recent commits and open issues/PRs were inspected; no open issues or PRs were present.
- Store contract change committed as `bf283143c486ea18d3ebf67c4363099d975a8679`.
- SQLite adapter implementation committed as `19a5cd02328b8e3299b5eccd434e744f073352da`.
- Runtime test/typecheck/build execution was not available from the connector after these commits; do not interpret this handoff as fresh green CI.
- Previous authoritative baseline remains: CI run `34582157458` passed on Node `24.20.0` with `212/212` tests, container verification succeeded, and the full Compose fake-provider/MCP/restart acceptance succeeded.

No live CALL-E phone call was attempted or claimed.

## Architecture decisions made this run

1. Run heartbeat/status writes need an explicit conditional mutation primitive instead of open-ended whole-object map replacement.
2. The authoritative row must be re-read inside the persistence transaction before applying a stale-sensitive update.
3. Losing writers should receive the durable winner so callers converge without guessing.
4. The primitive is additive until the control-plane heartbeat path and race tests are wired; no shared-store capability is claimed yet.
5. Provider I/O remains outside persistence transactions.
6. The supported deployment remains one Node process with one SQLite volume until the full shared-store contract is satisfied.

## CALL-E integration status

- Fake provider: deterministic, credential-free, idempotent, restart-rehydratable, and the complete acceptance provider.
- Production adapter: implemented with server-side `CALLE_API_KEY`, idempotency, bounded create/polling, persisted correlation, webhook/poll convergence, duplicate prevention, restart recovery, fail-closed ambiguity, and strict authenticated base-URL validation.
- No live CALL-E connectivity or owner-phone authorization has been verified.

## Current blockers / external prerequisites

No repository-development blocker prevents further useful work.

A genuine Claude Code host acceptance still requires a real Claude Code environment/CLI. Live CALL-E acceptance still requires a valid authorized credential, owner phone destination, and stable externally reachable HTTPS webhook ingress.

## Highest-value next actions

1. Route `ControlPlane.heartbeat` through `updateRunIfCurrent` and return the authoritative winner on stale races.
2. Add independent-worker and rollback tests for conditional run mutation.
3. Add an exact instruction acknowledgement conditional primitive and route safe-checkpoint consumption through it.
4. Audit escalation reservation/deferral/expiry, active-call progress, and ambiguous recovery for stale whole-entity writes.
5. Continue runtime string configuration and HTTP semantic-boundary hardening.
6. Preserve the fake-provider acceptance path while keeping UI work secondary.
7. Run the documented acceptance in a genuine Claude Code host when available.
8. Perform one tightly bounded live CALL-E acceptance only after user-controlled prerequisites are available.
