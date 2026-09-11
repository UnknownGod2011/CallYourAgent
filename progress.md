# CallYourAgent progress

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. Agents can request important owner decisions without freezing unrelated scopes; owners can request context-aware callbacks; human input is persisted as structured state and consumed only at explicit safe checkpoints. The repository includes deterministic fake and production CALL-E providers, SQLite persistence, replayable/idempotent call attempts, polling/webhook convergence, branch-scoped blocking, durable decisions and instruction queues, quiet hours/call budgets, bounded recovery, privacy-aware audit history, scoped HTTP auth, typed SDK, stdio MCP, lifecycle worker, operator console, deterministic demos, and a single-instance Compose reference deployment.

## Exact repo state inspected this run

Started from `main` after PR #51. Before changes, inspected the recursive repository tree, source/test inventory, recent commits, open issues, open pull requests, `AGENTS.md`, this file, `README.md`, and all architecture/integration/deployment/security/policy/acceptance documents under `docs/` plus `deploy/README.md`. The repository tree remains architecture-first with shared core services, HTTP, MCP, SDK, lifecycle, fake/production providers, SQLite persistence, and a large regression suite. No open issues or pull requests were present before this run.

The audit confirmed the next correctness phase: make stale-write risks concrete and reviewable before adding conditional/CAS methods. The highest-risk areas remain heartbeat/report-status, instruction acknowledgement, provider-call reservation, expiry/deferral, active-call progress, and ambiguous recovery.

## Changes made this run

Added `docs/STALE_WRITE_TEST_MATRIX.md`.

The document turns the freshness contract into an explicit implementation/test matrix covering:

- heartbeat/status writes;
- instruction acknowledgement;
- escalation/provider-call reservation;
- deferral/expiry races;
- active-call poll/webhook races;
- ambiguous recovery and duplicate-call prevention.

It also states the required invariant that stale workers must not overwrite authoritative entities with older whole-object snapshots, and sets the implementation order for conditional store primitives, control-plane routing, independent SQLite tests, in-memory parity, and keeping provider I/O outside persistence transactions.

This is a planning/contract artifact intentionally scoped to the current single-process SQLite topology; it does not claim shared-store or live CALL-E readiness.

## Verification performed

- GitHub repository tree fetched recursively and confirmed complete/non-truncated.
- `AGENTS.md`, `progress.md`, `README.md`, and all architecture/integration/deployment/security/policy/acceptance documents were read before the change.
- Recent commits were inspected through PR #51 and its progress handoff.
- No open issues or pull requests were present before the change.
- The new artifact is documentation-only; no runtime files or tests were changed in this run.
- Existing authoritative runtime baseline remains: CI run `34582157458` passed on Node `24.20.0` with `212/212` tests, container verification succeeded, and Compose fake-provider/MCP/restart acceptance succeeded.

No live CALL-E phone call was attempted or claimed.

## Architecture decisions made this run

1. Stale-write risks should be tracked as explicit contract/test rows before implementation changes.
2. Conditional/CAS primitives must be added in priority order, starting with heartbeat/report-status and exact instruction acknowledgement.
3. Provider I/O remains outside persistence transactions.
4. Independent SQLite-worker regressions are required before any future shared-store readiness claim.
5. In-memory and SQLite adapters must preserve the same freshness semantics.
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
