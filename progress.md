# CallYourAgent progress

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. Agents can request important owner decisions without freezing unrelated scopes; owners can request context-aware callbacks; human input is persisted as structured state and consumed only at explicit safe checkpoints. The repository includes deterministic fake and production CALL-E providers, SQLite persistence, replayable/idempotent call attempts, polling/webhook convergence, branch-scoped blocking, durable decisions and instruction queues, quiet hours/call budgets, bounded recovery, privacy-aware audit history, scoped HTTP auth, typed SDK, stdio MCP, lifecycle worker, operator console, deterministic demos, and a single-instance Compose reference deployment.

## Exact repo state inspected this run

Started from `main` HEAD `14c5086e0964373f42ba5970c10305194bafd226` after PR #50. Before changes, inspected the recursive repository tree, source/test inventory, recent commits, open issues, open pull requests, `AGENTS.md`, this file, `README.md`, and all architecture/integration/deployment/security/policy/acceptance documents under `docs/` plus `deploy/README.md`. No open issues or pull requests were present before this run.

The audit confirmed the next practical hardening target: the in-memory persistence adapter should not expose mutable caller-owned audit objects, because a caller mutation after insertion could rewrite the local audit mirror without going through the store boundary. This would diverge from the SQLite adapter's copy-on-write behavior and weaken audit immutability assumptions.

## Changes made this run

Merged PR #51, `Prevent in-memory audit event aliasing`, as `3424a058bebc846278438d5ddd8dae78e0610696`.

Changes:

- `InMemoryAuditEventMap.set` now structured-clones the incoming `AuditEvent` before assigning canonical sequence and storing it.
- The caller's provisional `sequence` is no longer mutated by insertion.
- Mutating the original object after insertion no longer changes the stored audit event.
- Added regression coverage proving sequence preservation, object isolation, and stored-value stability.

This is a small persistence-boundary hardening change. It does not change the authoritative SQLite/shared-store deployment claims.

## Verification performed

PR #51 was merged after GitHub accepted the change. The branch did not expose workflow runs through the connector before merge, so no new CI run id was available in this automation context. The repository's last authoritative runtime baseline remains:

- CI run `34582157458` — success on Node `24.20.0`, typecheck/build/full test suite, `212/212` tests passed.
- Container run `34582157502` — success.
- Compose run `34582157515` — success through scoped credentials, deployed stdio MCP, restart recovery for decisions/callbacks, exactly-once steering, persistence restart, and safe-checkpoint consumption.

The new test is deterministic and included in the repository test suite; a fresh post-merge CI run should be treated as the authoritative verification once surfaced by GitHub Actions.

No live CALL-E phone call was attempted or claimed.

## Architecture decisions made this run

1. Audit events are a persistence boundary, not shared mutable application objects.
2. In-memory and SQLite adapters should both isolate caller-owned payloads before storage.
3. Canonical audit sequence assignment remains store-owned and rollback-safe.
4. Existing atomic claim contracts remain authoritative and unaffected.
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
5. Add fresh CI/container/Compose verification for PR #51 when workflow results are available.
6. Preserve the fake-provider acceptance path while keeping UI work secondary.
7. Run the documented acceptance in a genuine Claude Code host when available.
8. Perform one tightly bounded live CALL-E acceptance only after user-controlled prerequisites are available.
