# CallYourAgent progress

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. Agents can request important owner decisions without freezing unrelated scopes; owners can request context-aware callbacks; human input is persisted as structured state and consumed only at explicit safe checkpoints. The repository includes deterministic fake and production CALL-E providers, SQLite persistence, replayable/idempotent call attempts, polling/webhook convergence, branch-scoped blocking, durable decisions and instruction queues, quiet hours/call budgets, bounded recovery, privacy-aware audit history, scoped HTTP auth, typed SDK, stdio MCP, lifecycle worker, operator console, deterministic demos, and a single-instance Compose reference deployment.

## Exact repo state inspected this run

Started from `main` after the previous conditional-run-mutation handoff. Before changes, inspected the full repository tree and `src/`/`tests/` inventory, recent commits, open issues/PRs, `AGENTS.md`, this file, `README.md`, and the architecture/integration/deployment/security/policy/acceptance documents under `docs/` plus `deploy/README.md`. No open issue or pull request required a different priority. The audit confirmed that `ControlPlaneStore.updateRunIfCurrent(...)` is implemented by both store adapters while `ControlPlane.heartbeat(...)` still writes directly to `store.runs`.

## Changes made this run

Added `tests/run-mutation-contract.test.ts` with focused regressions for the existing store-level compare-and-set primitive:

- first matching `updatedAt` applies the new run snapshot;
- a stale writer is rejected and receives the authoritative durable winner;
- rollback restores the prior run state;
- SQLite preserves the committed winner across close/reopen.

This is intentionally a store-contract increment. `ControlPlane.heartbeat(...)` remains unwired to the primitive and is still the highest-value runtime follow-up.

## Verification performed

- Full repository tree and architecture/integration docs inspected before the change.
- Recent commits and open issues/PRs inspected; none were relevant.
- Added test commit: `54e54240edf2f8d47ad03663c027729cf7614e98`.
- No local runtime is available in the connector, so no fresh test/typecheck/build result is claimed for this commit. GitHub Actions validation should run from `main` after the handoff update.
- Previous authoritative baseline remains: CI passed on Node `24.20.0` with `212/212` tests, container verification succeeded, and the full Compose fake-provider/MCP/restart acceptance succeeded.

No live CALL-E phone call was attempted or claimed.

## Architecture decisions made this run

1. Conditional run mutation is tested independently of the control-plane orchestration so future callers can reuse one freshness-safe primitive.
2. Stale writers must converge on the authoritative run and must not publish their stale snapshot.
3. Store rollback must include conditional run updates.
4. SQLite remains a single-instance deployment; these tests define invariants for future shared stores rather than claiming horizontal scale.
5. Existing branch-scoped blocking and safe-checkpoint instruction semantics remain unchanged.

## CALL-E integration status

- Fake provider: deterministic, credential-free, idempotent, restart-rehydratable, and the complete acceptance provider.
- Production adapter: implemented with server-side `CALLE_API_KEY`, idempotency, bounded create/polling, persisted correlation, webhook/poll convergence, duplicate prevention, restart recovery, fail-closed ambiguity, and strict authenticated base-URL validation.
- No live CALL-E connectivity or owner-phone authorization has been verified.

## Current blockers / external prerequisites

No repository-development blocker prevents further useful work.

A genuine Claude Code host acceptance still requires a real Claude Code environment/CLI. Live CALL-E acceptance still requires a valid authorized credential, owner phone destination, and stable externally reachable HTTPS webhook ingress. The automation connector lacks a safe partial-update mechanism for the large control-plane source file and does not expose a usable direct clone/runtime path, so runtime verification must continue through GitHub Actions after the next code commit.

## Highest-value next actions

1. Wire `ControlPlane.heartbeat` through `updateRunIfCurrent` and return the authoritative winner on stale races.
2. Add an integration regression proving the heartbeat path preserves unrelated fields and suppresses stale progress audit events.
3. Add an exact instruction acknowledgement conditional primitive and route safe-checkpoint consumption through it.
4. Audit escalation reservation/deferral/expiry, active-call progress, and ambiguous recovery for stale whole-entity writes.
5. Continue runtime string configuration and HTTP semantic-boundary hardening.
6. Preserve the fake-provider acceptance path while keeping UI work secondary.
7. Run the documented acceptance in a genuine Claude Code host when available.
8. Perform one tightly bounded live CALL-E acceptance only after user-controlled prerequisites are available.
