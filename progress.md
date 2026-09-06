# progress.md

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for two-way voice coordination between autonomous AI agents and their owners. The product currently has SQLite persistence, deterministic fake and production CALL-E providers, persisted replayable call attempts, same-idempotency ambiguous-call recovery, polling/webhook convergence, authenticated HTTP APIs, a typed TypeScript client, stdio MCP, CI-proven Claude-style branch/checkpoint behavior, decision-call policy, durable privacy-aware audit history, background lifecycle reconciliation, bounded ambiguous-call recovery, and fail-closed stale accepted-call handling.

The core semantics remain unchanged: an agent may call its owner for genuinely important human judgment without freezing unrelated scopes; the owner may independently request a callback to hear current status and steer the run; human answers/instructions become durable structured state consumed only at safe checkpoints.

## Exact repo state inspected this run

Before making changes, inspected the complete recursive `main` tree at `892692e8a89c2704135bf47d066f6a396fd90bdb`, repository metadata/permissions, recent commits, the CI workflow, and relevant issues/PRs (none). Read `AGENTS.md`, this file, `README.md`, `docs/ARCHITECTURE.md`, `docs/INTEGRATIONS.md`, and `docs/CALL_POLICY.md` in full. Inspected `src/domain.ts`, `src/control-plane.ts`, `src/call-provider.ts`, `src/call-policy.ts`, `src/lifecycle.ts`, `src/server.ts`, `tests/lifecycle.test.ts`, and package scripts because the previous run identified stale accepted provider calls as the highest-value reliability gap.

The automation container still cannot clone `github.com` because DNS resolution fails, so direct repository changes were made through authenticated GitHub Git-data operations and verification was performed with GitHub Actions.

## Existing foundation preserved

- Agent registration, run state, heartbeats/status, branch-scoped blocking, owner decisions, owner callbacks, durable instruction queues, and safe checkpoint consumption.
- In-memory and durable `node:sqlite` stores with WAL, explicit transactions, uniqueness constraints, rollback/reload behavior, and persisted audit ordering.
- Fake CALL-E provider and production CALL-E Calls API adapter with server-only credentials, structured results, provider idempotency, polling, and terminal webhook support.
- Persist-before-side-effect call attempts with exact task/metadata/idempotency data needed for safe replay after ambiguous provider outcomes.
- Shared polling/webhook terminal transition and provider event deduplication.
- Authenticated HTTP control plane, typed TypeScript client, MCP stdio adapter, and Claude-style end-to-end MCP work-loop tests.
- Decision priority gates, quiet hours, critical bypass, per-run/per-owner call budgets, escalation expiry, and durable policy-deferral reasons.
- Privacy-aware audit timeline with durable monotonic event ordering.
- Periodic lifecycle sweeps with exponential backoff, bounded automatic recovery attempts, and core enforcement of recovery exhaustion.

## Changes made this run

### Durable stalled-call review state

Added `stalled` to the durable `CallAttempt` state model together with `stalledAt` and a new `call_attempt_stalled` audit event type.

This state is intentionally distinct from ambiguous create recovery. `ambiguous` means CallYourAgent does not know whether a provider create request was accepted and therefore same-idempotency recovery may be required. `stalled` means the provider call id is already known, but the accepted call has remained `queued` or `in_progress` beyond the allowed age without terminal evidence.

### Lifecycle timeout enforcement

`LifecycleManager` now accepts `maxInProgressCallAgeMs`, defaulting to 10 minutes. During each sweep, accepted `queued`/`in_progress` decision calls and owner callbacks are checked before polling. If the attempt age reaches the limit, the manager:

1. marks the attempt `stalled`;
2. records `stalledAt` and updates durable state;
3. emits one privacy-safe `call_attempt_stalled` audit event with operational metadata only;
4. increments `staleCallsMarked` in the sweep result;
5. stops autonomous polling of that attempt on later sweeps;
6. never creates a replacement phone call or a new provider idempotency key.

For a blocking owner-decision escalation, the escalation remains `calling`, so only the affected scope remains blocked and unrelated work can continue.

### Late terminal outcomes remain recoverable

A stalled attempt is not terminal. The existing reconciliation and webhook paths can still apply a later terminal outcome to the original provider call id. An explicit reconciliation performs only a provider status read for a stalled attempt; it does not replay `start()` and therefore cannot create a replacement phone side effect.

This preserves truthful state while allowing delayed CALL-E evidence to resolve the original call safely.

### Runtime configuration

`src/server.ts` now accepts `CYA_MAX_IN_PROGRESS_CALL_AGE_MS` through the existing lifecycle configuration parser. The value must be a positive integer in milliseconds.

### Regression coverage

Added tests proving:

1. an accepted owner-decision call becomes `stalled` after the configured age;
2. the affected blocking scope remains blocked while the attempt is stalled;
3. later lifecycle sweeps do not create another provider call and do not repeatedly re-mark the attempt;
4. a `call_attempt_stalled` audit event is emitted;
5. after the original provider call later becomes terminal, explicit reconciliation resolves the same stalled attempt and owner decision without a second provider `start()` request.

### Documentation

Updated `docs/CALL_POLICY.md` with the distinction between ambiguous-create recovery and accepted-call stalling, the fail-closed semantics, late webhook/poll behavior, and the new runtime configuration.

## Architecture decisions made this run

1. Accepted-but-nonterminal timeout is a separate state-machine concern from ambiguous create recovery.
2. A known provider call id must never be replaced merely because the call took too long.
3. Stale accepted calls fail closed into a durable `stalled` review state rather than being mislabeled `failed` or `ambiguous`.
4. Automatic lifecycle work stops polling a stalled attempt to avoid endless churn, while webhook reconciliation and explicit read-only polling remain able to resolve the original call.
5. Blocking semantics remain branch/scope specific: a stalled blocking decision keeps only that scope blocked.
6. Stalling does not consume or inject owner instructions; instruction consumption remains checkpoint-only.

## Verification performed

- Direct local clone/test execution remains unavailable because the runtime cannot resolve `github.com`.
- Code-bearing commit `4fec8f21a8c90b8bbeae8541398ff734f8580c8a` triggered GitHub Actions CI run `34065824300`.
- CI completed successfully on September 6, 2026 UTC.
- The workflow used Node 24, installed dependencies, and ran `npm run check`, which covers TypeScript typechecking, build, and the complete Node test suite.
- The new stale-call regression tests passed as part of that successful run.
- No live CALL-E call was attempted. This run had no authorized CALL-E credential, owner destination phone, or public HTTPS deployment, and therefore makes no claim of live provider success.

## CALL-E integration status

- Fake provider: implemented and CI-tested end-to-end, including stale accepted-call behavior.
- Production CALL-E adapter: implemented with server-only API key, structured results, polling, webhook URL construction, and provider idempotency.
- Same-key ambiguous recovery: implemented.
- Automatic recovery bounds/backoff: implemented and CI-tested.
- Core enforcement of recovery exhaustion: implemented and CI-tested.
- Accepted-call stale timeout: implemented and CI-tested this run.
- Webhook dedupe + durable transaction: implemented.
- HTTP + TypeScript SDK + MCP integration path: implemented.
- Live CALL-E call: not attempted; external credentials/authorized phone/public HTTPS deployment are still absent.

## Current blockers

There is no blocker to continued repository development.

Live CALL-E verification still requires a valid CALL-E credential, an authorized owner phone number, and a public HTTPS deployment. Host-level Claude Code acceptance still requires an actual Claude Code installation/session. The execution container still cannot clone GitHub because of DNS resolution, but direct GitHub repository access and GitHub Actions CI remain available and were used successfully.

## Highest-value next actions

1. Add credential scopes and API-level rate limits, especially for owner callbacks and reconciliation endpoints, before exposing the service beyond a trusted single-owner environment.
2. Add graceful shutdown that stops lifecycle sweeps and cleanly closes HTTP/SQLite resources.
3. Add production deployment guidance for persistent disk and stable public HTTPS webhook ingress.
4. Add an explicit operator-only resolution path for `stalled` / exhausted-ambiguous attempts only if real deployment testing demonstrates a need; keep it separately authorized and audited.
5. Generate a lockfile and switch CI to `npm ci` once dependency choices stabilize.
6. Exercise the documented Claude Code MCP registration path in a real host and record exact acceptance results.
7. After reliability/security hardening, build a small status/demo UI over existing run/audit APIs rather than creating another business-state layer.
