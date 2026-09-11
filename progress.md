# CallYourAgent progress

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. Agents can request important owner decisions without freezing unrelated scopes; owners can request context-aware callbacks; human input is persisted as structured state and consumed only at explicit safe checkpoints. The repository includes deterministic fake and production CALL-E providers, SQLite persistence, replayable/idempotent call attempts, polling/webhook convergence, branch-scoped blocking, durable decisions and instruction queues, quiet hours/call budgets, bounded recovery, privacy-aware audit history, scoped HTTP auth, typed SDK, stdio MCP, lifecycle worker, operator console, deterministic demos, and a single-instance Compose reference deployment.

## Exact repo state inspected this run

Started from `main` HEAD `14c5086e0964373f42ba5970c10305194bafd226` after PR #49. Before changes, inspected the recursive repository tree, source/test inventory, recent commits, open issues, open pull requests, `AGENTS.md`, this file, `README.md`, and all architecture/integration/deployment/security/policy/acceptance documents under `docs/` plus `deploy/README.md`. No open issues or pull requests were present before this run.

The audit confirmed the previous handoff's priority: future shared-store adapters need an explicit stale-read/CAS contract beyond terminal-outcome and audit-sequence hardening. The current supported topology remains one Node process with one SQLite volume; no multi-instance readiness is claimed.

## Changes made this run

Merged PR #50, `Document shared-store freshness contract`, as `a1b96e1d6e1f4096e4287bd39b5f7c21bc687933`.

Added `docs/STORE_FRESHNESS.md`, documenting:

- authoritative re-read or conditional/CAS requirements before whole-entity writes;
- field-preservation rules for heartbeat, instruction acknowledgement, reservation, expiry, progress, and recovery mutations;
- reuse of existing first-writer-wins claims for idempotency, terminal outcomes, owner decisions, callback instruction sets, webhook ids, and audit ordering;
- privacy-safe loser/conflict observability;
- required two-worker contract tests for future shared stores;
- rollback requirements for entity fields and claim/sequence side effects.

This is an architecture contract, not a claim that SQLite is horizontally scalable.

## Verification performed

This run's change was documentation-only, so no runtime test suite was changed or required. The prior authoritative runtime baseline remains:

- CI run `34582157458` — success on Node `24.20.0`, typecheck/build/full test suite, `212/212` tests passed.
- Container run `34582157502` — success.
- Compose run `34582157515` — success through scoped credentials, deployed stdio MCP, restart recovery for decisions/callbacks, exactly-once steering, persistence restart, and safe-checkpoint consumption.

No live CALL-E phone call was attempted or claimed.

## Architecture decisions made this run

1. A future shared store must never overwrite a whole entity from a stale local mirror.
2. Conditional writes must preserve unrelated fields and converge losers to the durable winner.
3. Existing atomic claim contracts remain authoritative and must not be bypassed by freshness logic.
4. Conflicts must remain privacy-safe.
5. The documented single-instance SQLite topology remains the supported deployment until a shared transactional store and shared rate limiter satisfy the full contract.

## CALL-E integration status

- Fake provider: deterministic, credential-free, idempotent, restart-rehydratable, and the complete acceptance provider.
- Production adapter: implemented with server-side `CALLE_API_KEY`, idempotency, bounded create/polling, persisted correlation, webhook/poll convergence, duplicate prevention, restart recovery, fail-closed ambiguity, and strict authenticated base-URL validation.
- No live CALL-E connectivity or owner-phone authorization has been verified.

## Current blockers / external prerequisites

No repository-development blocker prevents further useful work.

A genuine Claude Code host acceptance still requires a real Claude Code environment/CLI. Live CALL-E acceptance still requires a valid authorized credential, owner phone destination, and stable externally reachable HTTPS webhook ingress.

## Highest-value next actions

1. Turn the highest-risk stale entity transitions into explicit conditional/CAS store primitives, starting with exact instruction acknowledgement and heartbeat/report-status.
2. Add independent-worker race tests proving stale losers cannot revert newer state and converge to the durable winner.
3. Audit escalation reservation/deferral/expiry, active-call progress, and ambiguous recovery for stale whole-entity writes.
4. Continue runtime string configuration and HTTP semantic-boundary hardening.
5. Preserve the fake-provider acceptance path while keeping UI work secondary.
6. Run the documented acceptance in a genuine Claude Code host when available.
7. Perform one tightly bounded live CALL-E acceptance only after user-controlled prerequisites are available.
