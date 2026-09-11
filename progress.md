# CallYourAgent progress

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. Agents can request important owner decisions without freezing unrelated scopes; owners can request context-aware callbacks; human input is persisted as structured state and consumed only at explicit safe checkpoints. The repository includes deterministic fake and production CALL-E providers, SQLite persistence, replayable/idempotent call attempts, polling/webhook convergence, branch-scoped blocking, durable decisions and instruction queues, quiet hours/call budgets, bounded recovery, privacy-aware audit history, scoped HTTP auth, typed SDK, stdio MCP, lifecycle worker, operator console, deterministic demos, and a single-instance Compose reference deployment.

## Exact repo state inspected this run

Started from `main` after the PR #51 handoff and the stale-write matrix documentation. Before changes, inspected the recursive repository tree, source/test inventory, recent commits, open issues, open pull requests, `AGENTS.md`, this file, `README.md`, and the architecture/integration/deployment/security/policy/acceptance documents under `docs/` plus `deploy/README.md`. The repository remains architecture-first with shared core services, HTTP, MCP, SDK, lifecycle, fake/production providers, SQLite persistence, operator console, and a broad regression suite. No open issues or pull requests were present before this run.

The audit confirmed that the next correctness phase is shared-store freshness: explicit conditional/CAS behavior for stale-read mutations, starting with run status/heartbeat and exact instruction acknowledgement, followed by escalation/call reservation and active-call recovery paths.

## Changes made this run

Added `docs/SHARED_STORE_READINESS.md`.

The document defines the exit criteria for ever claiming multi-worker/shared-store support: authoritative persistence-boundary mutation semantics, explicit applied/already-current/stale-rejected outcomes, independent-worker stale-read and rollback regressions across all mutable domains, and the current operational boundary that SQLite remains single-process and fake CALL-E remains the acceptance provider.

This is a contract artifact that narrows future implementation work; it does not claim shared-store or live CALL-E readiness.

## Verification performed

- GitHub repository metadata and recursive tree were inspected.
- `AGENTS.md`, `progress.md`, `README.md`, and all architecture/integration/deployment/security/policy/acceptance documents were read before the change.
- Recent commits were inspected through the latest progress handoff.
- No open issues or pull requests were present before the change.
- Added documentation was committed successfully as `a53789baa1e4c1cbba2fe6ef60c2241285e4aa29`.
- Runtime source and tests were not modified in this run; no fresh CI/container/Compose execution was available from the connector after the documentation commit.
- Existing authoritative runtime baseline remains: CI run `34582157458` passed on Node `24.20.0` with `212/212` tests, container verification succeeded, and Compose fake-provider/MCP/restart acceptance succeeded.

No live CALL-E phone call was attempted or claimed.

## Architecture decisions made this run

1. Shared-store readiness must be an evidence-based contract, not an implication from SQLite behavior.
2. Every mutable domain path needs either conditional/CAS updates, authoritative re-read plus write, or a durable domain claim.
3. Mutation APIs should expose whether a stale writer applied, converged, or was rejected instead of relying on caller guesses.
4. Independent-worker interleavings and rollback paths are mandatory before multi-worker support is documented.
5. Provider I/O remains outside persistence transactions.
6. The supported deployment remains one Node process with one SQLite volume until a shared transactional store and shared rate limiter satisfy the full contract.

## CALL-E integration status

- Fake provider: deterministic, credential-free, idempotent, restart-rehydratable, and the complete acceptance provider.
- Production adapter: implemented with server-side `CALLE_API_KEY`, idempotency, bounded create/polling, persisted correlation, webhook/poll convergence, duplicate prevention, restart recovery, fail-closed ambiguity, and strict authenticated base-URL validation.
- No live CALL-E connectivity or owner-phone authorization has been verified.

## Current blockers / external prerequisites

No repository-development blocker prevents further useful work.

A genuine Claude Code host acceptance still requires a real Claude Code environment/CLI. Live CALL-E acceptance still requires a valid authorized credential, owner phone destination, and stable externally reachable HTTPS webhook ingress.

## Highest-value next actions

1. Add explicit conditional store primitives for run status/heartbeat and exact instruction acknowledgement.
2. Route control-plane mutations through those primitives and add independent-worker race tests.
3. Audit escalation reservation/deferral/expiry, active-call progress, and ambiguous recovery for stale whole-entity writes.
4. Continue runtime string configuration and HTTP semantic-boundary hardening.
5. Preserve the fake-provider acceptance path while keeping UI work secondary.
6. Run the documented acceptance in a genuine Claude Code host when available.
7. Perform one tightly bounded live CALL-E acceptance only after user-controlled prerequisites are available.
