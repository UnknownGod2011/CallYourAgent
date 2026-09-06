# progress.md

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for two-way voice coordination between autonomous AI agents and their owners. The product currently has SQLite persistence, deterministic fake and production CALL-E providers, persisted replayable call attempts, same-idempotency ambiguous-call recovery, polling/webhook convergence, authenticated HTTP APIs, a typed TypeScript client, stdio MCP, CI-proven Claude-style branch/checkpoint behavior, decision-call policy, durable privacy-aware audit history, and a background lifecycle manager with bounded ambiguous-call recovery.

The core semantics remain unchanged: an agent may call its owner for genuinely important human judgment without freezing unrelated scopes; the owner may independently request a callback to hear current status and steer the run; human answers/instructions become durable structured state consumed only at safe checkpoints.

## Exact repo state inspected this run

Before making changes, inspected the complete recursive `main` tree at `8e00960f7d8eba474edf906a33460c92f1ba89be`, repository metadata/permissions, recent commits, and issues (none). Read `AGENTS.md`, this file, `README.md`, `docs/ARCHITECTURE.md`, `docs/INTEGRATIONS.md`, and `docs/CALL_POLICY.md` in full. Inspected `src/control-plane.ts`, `src/lifecycle.ts`, and `tests/lifecycle.test.ts` specifically because the previous run identified manual reconciliation bypass of exhausted automatic recovery as the highest-value safety gap. No open issue or PR required coordination.

## Existing foundation preserved

- Agent registration, run state, heartbeats/status, branch-scoped blocking, owner decisions, owner callbacks, durable instruction queues, and safe checkpoint consumption.
- In-memory and durable `node:sqlite` stores with WAL, explicit transactions, uniqueness constraints, rollback/reload behavior, and persisted audit ordering.
- Fake CALL-E provider and production CALL-E Calls API adapter with server-only credentials, structured results, provider idempotency, polling, and terminal webhook support.
- Persist-before-side-effect call attempts with exact task/metadata/idempotency data needed for safe replay after ambiguous provider outcomes.
- Shared polling/webhook terminal transition and provider event deduplication.
- Authenticated HTTP control plane, typed TypeScript client, MCP stdio adapter, and Claude-style end-to-end MCP work-loop tests.
- Decision priority gates, quiet hours, critical bypass, per-run/per-owner call budgets, escalation expiry, and durable policy-deferral reasons.
- Privacy-aware audit timeline with durable monotonic event ordering.
- Periodic lifecycle sweeps with exponential backoff and bounded automatic recovery attempts.

## Changes made this run

### Core fail-closed recovery exhaustion guard

Moved the exhaustion invariant into the core recovery primitive itself. `ControlPlane.recoverCallAttempt` now immediately returns an ambiguous attempt unchanged when `automaticRecoveryExhaustedAt` is present.

This closes the previous loophole where the background `LifecycleManager` correctly stopped retrying, but an ordinary explicit `reconcileEscalation`, `reconcileCallback`, or direct `recoverCallAttempt` call could cause another provider create request. Since reconciliation is reachable through integration surfaces, that behavior was too easy to trigger accidentally.

The new invariant is intentionally fail-closed: once automatic recovery has exhausted, ordinary reconciliation cannot create any new provider-side call request. The attempt remains `ambiguous`, preserving the truth that the original request may already have reached CALL-E. If a future deployment needs an operator override, it should be introduced as an explicit separately authorized and audited operation instead of overloading normal reconciliation.

### Regression coverage

Added a lifecycle/control-plane regression test that:

1. creates a blocking owner-decision call through a provider that always throws after observing the idempotency key;
2. configures a one-attempt automatic recovery budget;
3. runs the lifecycle manager until the attempt is marked exhausted;
4. records the exact provider request count;
5. calls `reconcileEscalation` explicitly;
6. calls `recoverCallAttempt` explicitly;
7. verifies neither path creates another provider request;
8. verifies the attempt remains `ambiguous` and the affected scope remains blocked.

### Documentation

Updated `docs/CALL_POLICY.md` to document that recovery exhaustion is now enforced by the core control plane rather than only by the lifecycle manager. The previous language describing normal explicit reconciliation as a manual override was removed. Any future override is now specified as a separate operator-only design concern.

## Architecture decisions made this run

1. Retry exhaustion is a domain safety invariant, not merely a background-worker behavior.
2. Ordinary agent/API reconciliation must not be capable of bypassing a provider-side-effect safety ceiling.
3. Exhausted ambiguous attempts remain ambiguous; they must not be relabeled failed without provider evidence.
4. A manual recovery override, if ever needed, should be an explicit privileged operation with separate authorization and audit semantics.
5. No change was made to branch-scoped blocking or checkpoint consumption semantics.

## Verification performed

- Direct local clone/test execution remains unavailable in the automation container because DNS resolution for `github.com` still fails.
- GitHub Actions CI run `34062730152` for code-bearing commit `36ae018d1ec795400fa7b88c7dc54dbe5d27829a` completed successfully.
- That CI run executed the repository's normal Node 24 workflow, including dependency installation and `npm run check`, which covers TypeScript checking/build and the complete Node test suite.
- The new regression test passed as part of that successful CI run.
- No live CALL-E call was attempted. This run had no authorized CALL-E credential, owner destination phone, or public HTTPS deployment, and therefore makes no claim of live provider success.

## CALL-E integration status

- Fake provider: implemented and CI-tested end-to-end.
- Production CALL-E adapter: implemented with server-only API key, structured results, polling, webhook URL construction, and provider idempotency.
- Same-key ambiguous recovery: implemented.
- Automatic recovery bounds/backoff: implemented and CI-tested.
- Core enforcement of recovery exhaustion: implemented and CI-tested this run.
- Webhook dedupe + durable transaction: implemented.
- HTTP + TypeScript SDK + MCP integration path: implemented.
- Live CALL-E call: not attempted; external credentials/authorized phone/public HTTPS deployment are still absent.

## Current blockers

There is no blocker to continued repository development.

Live CALL-E verification still requires a valid CALL-E credential, an authorized owner phone number, and a public HTTPS deployment. Host-level Claude Code acceptance still requires an actual Claude Code installation/session. The execution container still cannot clone GitHub because of DNS resolution, but direct GitHub repository access and GitHub Actions CI remain available and were used successfully.

## Highest-value next actions

1. Add stale in-progress call timeout policy distinct from ambiguous-create recovery so calls stuck forever in provider `queued`/`calling` state become explicit reviewable state without unsafe re-creation.
2. Add credential scopes and API-level rate limits, especially for owner callbacks and reconciliation endpoints, before exposing the service beyond a trusted single-owner environment.
3. Add graceful shutdown that stops lifecycle sweeps and cleanly closes HTTP/SQLite resources.
4. Add production deployment guidance for persistent disk and stable public HTTPS webhook ingress.
5. Generate a lockfile and switch CI to `npm ci` once dependency choices stabilize.
6. Exercise the documented Claude Code MCP registration path in a real host and record exact acceptance results.
7. After reliability/security hardening, build a small status/demo UI over existing run/audit APIs rather than creating another business-state layer.
