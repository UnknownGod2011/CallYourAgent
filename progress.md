# CallYourAgent progress

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. Agents can request important owner decisions without freezing unrelated scopes; owners can request context-aware callbacks; human input is persisted as structured state and consumed only at explicit safe checkpoints. The repository includes deterministic fake and production CALL-E providers, SQLite persistence, replayable/idempotent call attempts, polling/webhook convergence, branch-scoped blocking, durable decisions and instruction queues, quiet hours/call budgets, bounded recovery, privacy-aware audit history, scoped HTTP auth, typed SDK, stdio MCP, lifecycle worker, operator console, deterministic demos, and a single-instance Compose reference deployment.

## Exact repo state inspected this run

Started from `main` after the previous conditional-run-mutation handoff. Before changes, inspected the repository root and `src/` inventory, recent commits, all available PR history, open issue/PR state, `AGENTS.md`, this file, `README.md`, and the architecture/integration/deployment/security/policy/acceptance documentation under `docs/` plus the deployment README. The recent PR history showed the prior shared-store work through PR #51; no newer open issue or pull request was available to drive a different requirement.

The audit confirmed that `ControlPlaneStore.updateRunIfCurrent(...)` exists and is implemented in the in-memory and SQLite adapters, but `ControlPlane.heartbeat(...)` still writes the run map directly. The next runtime increment remains to route heartbeat through the conditional primitive and add the race regressions described by the freshness documents.

## Changes made this run

Added `docs/RUN_MUTATION_CONTRACT.md`.

The document makes the run heartbeat/status contract executable in prose before runtime wiring:

- compare `updatedAt` against the authoritative row inside the store write boundary;
- return the durable winner on stale rejection;
- preserve unrelated fields and never replace a run from a stale snapshot;
- roll back both run and audit-sequence side effects on failure;
- suppress misleading progress audit events from stale losers;
- define the independent-worker, rollback, and close/reopen regressions required for in-memory, SQLite, and future shared-store adapters.

This is intentionally an additive documentation increment. Runtime behavior was not changed in this run because the connector does not provide a safe partial-edit path for the large `src/control-plane.ts` file and the local clone/runtime path is unavailable.

## Verification performed

- Repository root/tree inventory inspected through the GitHub connector.
- `AGENTS.md`, `progress.md`, `README.md`, architecture/integration/deployment/security/policy/acceptance docs, and deployment README inspected before the change.
- Recent commits and PR history inspected; no relevant open issue or PR was present.
- Documentation commit created on `main`: `e4c5745b7f838422b223917b0cacee1e88d42cc0`.
- No runtime code changed; no fresh CI/typecheck/build/test result is claimed for this documentation-only commit.
- Previous authoritative baseline remains: CI `34582157458` passed on Node `24.20.0` with `212/212` tests, container verification succeeded, and the full Compose fake-provider/MCP/restart acceptance succeeded.

No live CALL-E phone call was attempted or claimed.

## Architecture decisions made this run

1. Run heartbeat/status mutation semantics are now documented as a first-class store contract, not an implicit convention.
2. A stale heartbeat must lose without overwriting a newer summary, current scope, timestamp, or audit history.
3. The control plane should return the authoritative run for both applied and stale-rejected writes.
4. The supported SQLite deployment remains single-instance; the documented contract is preparation for a future shared store, not a horizontal-scale claim.
5. Provider/network I/O remains outside persistence transactions.
6. Existing branch-scoped blocking and safe-checkpoint instruction semantics remain unchanged.

## CALL-E integration status

- Fake provider: deterministic, credential-free, idempotent, restart-rehydratable, and the complete acceptance provider.
- Production adapter: implemented with server-side `CALLE_API_KEY`, idempotency, bounded create/polling, persisted correlation, webhook/poll convergence, duplicate prevention, restart recovery, fail-closed ambiguity, and strict authenticated base-URL validation.
- No live CALL-E connectivity or owner-phone authorization has been verified.

## Current blockers / external prerequisites

No repository-development blocker prevents further useful work.

A genuine Claude Code host acceptance still requires a real Claude Code environment/CLI. Live CALL-E acceptance still requires a valid authorized credential, owner phone destination, and stable externally reachable HTTPS webhook ingress. The automation connector currently lacks a safe partial-update mechanism for the large control-plane source file and does not expose a usable direct clone/runtime path, so runtime verification must continue through GitHub Actions after the next code commit.

## Highest-value next actions

1. Route `ControlPlane.heartbeat` through `updateRunIfCurrent` and return the authoritative winner on stale races.
2. Add independent-worker and rollback tests for conditional run mutation.
3. Add an exact instruction acknowledgement conditional primitive and route safe-checkpoint consumption through it.
4. Audit escalation reservation/deferral/expiry, active-call progress, and ambiguous recovery for stale whole-entity writes.
5. Continue runtime string configuration and HTTP semantic-boundary hardening.
6. Preserve the fake-provider acceptance path while keeping UI work secondary.
7. Run the documented acceptance in a genuine Claude Code host when available.
8. Perform one tightly bounded live CALL-E acceptance only after user-controlled prerequisites are available.
