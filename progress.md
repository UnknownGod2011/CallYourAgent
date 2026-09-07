# progress.md

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. It currently has SQLite persistence, deterministic fake and production CALL-E providers, replayable/idempotent call attempts, polling/webhook convergence, scoped authenticated HTTP APIs, a typed TypeScript client, stdio MCP, CI-proven Claude-style branch/checkpoint behavior, decision-call policy, durable privacy-aware audit history, bounded lifecycle recovery, fail-closed ambiguous/stalled call handling, API abuse controls, and an owned runtime with graceful HTTP/lifecycle/store shutdown.

The core product semantics remain unchanged: an agent can escalate genuinely important human judgment without freezing unrelated scopes; the owner can independently request a callback to hear current status and steer the run; owner decisions and instructions become durable structured state and are consumed only at safe checkpoints rather than being represented as mid-generation interruption.

## Exact repo state inspected this run

Before making changes, inspected the complete recursive `main` repository tree at `a0119e009b7f1faa4e3d4483fdb7cdb49a286398` (tree `33a6d27c1d7af02c23ae4539fcc01015afab406a`), including every source/test/doc path. Inspected recent commits through the scoped API hardening work and checked repository issues and pull requests; there were no open/relevant issues or PRs.

Read `AGENTS.md`, this file, `README.md`, `docs/ARCHITECTURE.md`, `docs/INTEGRATIONS.md`, `docs/CALL_POLICY.md`, and `docs/API_SECURITY.md` in full before modifying the repository. Inspected `src/server.ts`, `src/http-server.ts`, `src/lifecycle.ts`, `src/sqlite-store.ts`, `src/store.ts`, relevant `src/control-plane.ts` reconciliation paths, `src/call-policy.ts`, `src/calle-provider.ts`, `.env.example`, `package.json`, `tests/http-server.test.ts`, and `tests/lifecycle.test.ts` because graceful shutdown/deployment hardening was the highest-value recorded next increment.

Direct local clone/test execution remains unavailable in this runtime because `github.com` DNS resolution is unavailable to the container. Repository mutations therefore used authenticated GitHub Git-data operations and verification used the repository's GitHub Actions CI.

## Existing foundation preserved

- Agent registration, run state, heartbeats/status, branch-scoped blocking, owner decisions, owner callbacks, durable instruction queues, and safe checkpoint consumption.
- In-memory and durable `node:sqlite` stores with WAL, explicit transactions, uniqueness constraints, rollback/reload behavior, and persisted causal audit ordering.
- Fake CALL-E provider and production CALL-E Calls API adapter with server-only credentials, structured results, provider idempotency, polling, and terminal webhook support.
- Persist-before-side-effect call attempts containing exact replayable provider request/idempotency state.
- Shared polling/webhook terminal transition and provider-event deduplication.
- Typed HTTP client, stdio MCP adapter, and Claude-style end-to-end MCP work-loop tests.
- Priority gates, quiet hours, critical bypass, per-run/per-owner call budgets, escalation expiry, durable policy deferral, bounded ambiguous recovery, and stalled accepted-call review state.
- Scoped HTTP credentials and per-credential callback/reconciliation rate limits.

## Changes made this run

### Owned runtime and graceful shutdown

Added `startRuntimeFromEnv()` as the deployable owner of the HTTP server, background lifecycle reconciliation, and backing store.

The runtime now:

1. validates the selected store mode instead of silently treating every non-memory value as SQLite;
2. supports an ephemeral `PORT=0` bind for integration tests while retaining the normal configured port behavior;
3. prevents overlapping periodic lifecycle sweeps;
4. stops scheduling new sweeps during shutdown;
5. calls `server.close()` so new HTTP connections stop while active requests drain;
6. waits for an already-running lifecycle sweep before closing persistence;
7. closes the backing store exactly once;
8. handles `SIGTERM` and `SIGINT` through the same idempotent shutdown path rather than exiting immediately.

`ControlPlaneStore` now owns a `close()` contract. The in-memory implementation is a no-op and `SqliteControlPlaneStore.close()` is idempotent, so repeated shutdown requests cannot double-close the database handle.

Added `tests/server-runtime.test.ts` proving ephemeral startup/health, repeated shutdown safety, durable SQLite resource closure, and rejection of an unsupported store mode.

### Correct stale-call reconciliation ordering

The first CI run exposed a genuine lifecycle correctness edge case rather than a shutdown regression. Accepted calls were checked for staleness *before* the provider was polled. If a provider call had completed while the control plane was asleep, a later sweep could mark the locally old attempt `stalled` and skip terminal evidence that was already available.

Changed lifecycle ordering so a known non-stalled provider call receives one reconciliation poll first. Only if it remains nonterminal after that poll can the stale-age guard move it into the durable `stalled` review state.

This preserves the fail-closed invariant: no replacement call or new idempotency key is created. It simply ensures already-available terminal evidence wins over a local timeout. Genuine queued/in-progress calls that remain nonterminal beyond the configured age still become `stalled`, and late webhook/explicit reconciliation behavior remains unchanged.

### Production deployment contract

Added `docs/DEPLOYMENT.md` covering the supported reference topology and operational boundaries:

- single Node control-plane instance with SQLite;
- persistent writable directory for the SQLite database plus WAL/SHM files;
- no claim of horizontally scalable SQLite/process-local rate limiting;
- TLS termination at a reverse proxy/hosting platform;
- stable public HTTPS origin for CALL-E webhook ingress;
- redaction/non-logging of the webhook query capability token;
- scoped bearer credential role separation;
- process termination grace and graceful shutdown sequence;
- fake-provider-first deployment verification before live CALL-E mode;
- liveness-vs-provider-readiness distinction for `/health`;
- backup/restore and monitoring expectations.

Updated `README.md` to link policy, API security, and deployment documentation. Updated `.env.example` with the existing lifecycle/recovery/stale-call runtime variables and explicit webhook query-log redaction guidance.

## Architecture decisions made this run

1. HTTP, lifecycle scheduling, and persistence are one owned runtime lifecycle rather than independent process globals.
2. Shutdown order is: prevent new background work, stop/drain HTTP, wait for an active sweep, then close persistence.
3. Lifecycle sweeps do not overlap within one runtime instance; this avoids concurrent reconciliation churn against the same single-process store.
4. Provider terminal evidence that is already obtainable should be reconciled before a local accepted-call age threshold moves the attempt to `stalled` review.
5. The stale guard remains fail-closed: polling an existing provider call is safe; creating a replacement call is not.
6. The supported production reference remains one SQLite-backed instance. Multi-instance operation requires a shared transactional store and shared rate limiter rather than undocumented assumptions.
7. Because the current CALL-E webhook protection includes an application capability token in the URL, production ingress logging must redact the webhook query string.
8. `/health` remains process liveness only; it intentionally does not fabricate CALL-E/public-webhook readiness.

## Verification performed

- GitHub Actions run `34071731498` on initial graceful-shutdown commit `9d13fecb545035e417ec3bf7ec9239275ac0272c` completed with Node 24 typecheck/build successful and all three new runtime tests passing, but one existing lifecycle test failed.
- The failure was diagnosed from CI logs: an escalation stayed `calling` because stale detection occurred before provider reconciliation under mismatched deterministic/system clocks. This revealed the real terminal-evidence-before-stall issue described above.
- Follow-up code commit `031fa21bb5e9094b4ecc97dedb3b930efb39f15e` corrected the lifecycle ordering.
- GitHub Actions run `34071916332` for that corrected code-bearing commit completed successfully on September 7, 2026 UTC.
- The successful workflow used Node 24 and `npm run check`, covering TypeScript typechecking, build, and the complete Node test suite, including the new runtime shutdown tests and existing lifecycle/stalled-call regressions.
- Documentation/configuration commit `62146fd462fc71ea1a25c568bf44936faac19374` adds the deployment contract and environment guidance without changing business-state semantics.
- No live CALL-E call was attempted in this run.

## CALL-E integration status

- Fake provider: implemented and CI-tested end-to-end, including decision calls, callbacks, branch-scoped blocking, queued owner steering, checkpoint consumption, idempotency, policy, lifecycle recovery, and auditability.
- Production CALL-E adapter: implemented with server-only API key, structured result schemas, provider idempotency, asynchronous polling, webhook URL construction, and terminal reconciliation.
- Ambiguous create replay with the exact original idempotency key: implemented.
- Automatic recovery bounds/backoff and core recovery-exhaustion enforcement: implemented and CI-tested.
- Accepted-call stale timeout: implemented; terminal provider evidence is now polled before stalling and CI-tested.
- Webhook event-id validation/deduplication + durable transaction: implemented.
- HTTP + TypeScript SDK + MCP path: implemented.
- Scoped credentials + callback/reconciliation rate limits: implemented and CI-tested.
- Graceful server/lifecycle/store shutdown: implemented and CI-tested this run.
- Live CALL-E call: **not attempted and not claimed**. A valid CALL-E credential, authorized owner phone destination, and stable public HTTPS deployment remain external prerequisites.

## Current blockers

There is no blocker to continued repository development.

Live CALL-E verification still requires a valid CALL-E credential, authorized owner phone number, and public HTTPS deployment. Host-level Claude Code acceptance still requires an actual Claude Code installation/session. The automation runtime still cannot clone GitHub directly, but authenticated GitHub access and GitHub Actions provide a working implementation/verification path.

One small startup-hardening follow-up remains: environment parsing occurs before SQLite is opened for the common paths, but constructors that validate certain derived configuration (for example invalid IANA timezone/backoff relationships) should be made explicitly resource-safe if they throw after a durable store has been opened.

## Highest-value next actions

1. Add an explicit timeout/abort bound around CALL-E HTTP `POST /v1/calls` and `GET /v1/calls/{id}` so a hung provider connection cannot indefinitely delay lifecycle progress or graceful termination; preserve create-timeout ambiguity semantics and exact-idempotency recovery.
2. Make post-store-open runtime construction exception-safe so any remaining startup validation failure always closes SQLite before propagating.
3. Generate and commit a lockfile, then switch CI from `npm install` to reproducible `npm ci` once dependency choices are stable.
4. Exercise the documented Claude Code stdio MCP registration path in a real Claude Code host and record exact acceptance results rather than inferring host behavior from protocol-level tests.
5. Add an explicit operator-only resolution/recovery path for `stalled` or exhausted-ambiguous calls only if real deployment testing demonstrates a need; keep it separately scoped and audited.
6. Consider a shared store/rate limiter only when moving beyond the supported single-instance reference deployment.
7. After reliability/host acceptance work, build a small status/demo UI over the existing run/audit APIs without introducing a second business-state layer.
