# progress.md

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. It has SQLite persistence, deterministic fake and production CALL-E providers, replayable/idempotent call attempts, polling/webhook convergence, scoped authenticated HTTP APIs, a typed TypeScript client, stdio MCP, CI-proven Claude-style branch/checkpoint behavior, decision-call policy, durable privacy-aware audit history, bounded lifecycle recovery, fail-closed ambiguous/stalled call handling, API abuse controls, an owned graceful runtime, hard deadlines around CALL-E HTTP operations, reproducible npm dependencies via `npm ci`, and now a thin built-in operator console over the existing authenticated run/audit/callback APIs.

The core semantics remain unchanged: an agent can escalate genuinely important human judgment without freezing unrelated scopes; the owner can independently request a callback to hear current status and steer the run; owner decisions and instructions become durable structured state and are consumed only at safe checkpoints rather than being represented as mid-generation interruption.

## Exact repo state inspected this run

Before making changes, inspected the complete recursive `main` tree at `4118db191c1987246dfaf7e875669ef1deb749ce`, including source, tests, workflow/configuration files, documentation paths, and the newly committed lockfile. Inspected recent commits through the dependency-locking work and checked open issues and pull requests; there were none.

Read `AGENTS.md`, this file, `README.md`, `docs/ARCHITECTURE.md`, `docs/INTEGRATIONS.md`, `docs/CALL_POLICY.md`, `docs/API_SECURITY.md`, and `docs/DEPLOYMENT.md` in full before modifying the repository. Also inspected `src/http-server.ts`, `src/domain.ts`, and `tests/http-server.test.ts` because the highest-value available next action was the small operator/status surface. A real Claude Code host is not available in this runtime, so no host-level acceptance result was fabricated.

The execution container still cannot resolve `github.com` for a normal local clone. Repository mutation therefore used authenticated GitHub Git-data operations and verification used GitHub Actions CI.

## Existing foundation preserved

- Agent registration, run state, heartbeats/status, branch-scoped blocking, owner decisions, owner callbacks, durable instruction queues, and safe checkpoint consumption.
- In-memory and durable `node:sqlite` stores with WAL, explicit transactions, uniqueness constraints, rollback/reload behavior, persisted causal audit ordering, and idempotent close semantics.
- Fake CALL-E provider and production CALL-E Calls API adapter with server-only credentials, structured results, provider idempotency, polling, terminal webhook support, and hard request deadlines.
- Persist-before-side-effect call attempts containing exact replayable provider requests/idempotency state.
- Shared polling/webhook terminal transition plus provider-event deduplication.
- Typed HTTP client, stdio MCP adapter, and Claude-style end-to-end MCP work-loop tests.
- Priority gates, quiet hours, critical bypass, per-run/per-owner call budgets, escalation expiry, durable policy deferral, bounded ambiguous recovery, and stalled accepted-call review state.
- Scoped HTTP credentials and per-credential callback/reconciliation rate limits.
- Owned runtime with non-overlapping lifecycle sweeps plus graceful HTTP/lifecycle/store shutdown.
- Reproducible dependency graph enforced by `npm ci` in CI.

## Changes made this run

### Built-in operator console

Added `src/operator-ui.ts` and exposed it as `GET /operator` from the existing HTTP server. The page is intentionally a presentation layer only; it does not introduce another state store, alternate decision path, or browser-agent behavior.

The console accepts a run id and a scoped bearer token in browser memory, then reads the existing authenticated APIs to show:

- run status;
- current scope;
- current agent summary and update time;
- the durable audit event count;
- the durable causal timeline, newest first.

It supports optional three-second auto-refresh so a hackathon demo can visibly show an agent continuing unrelated work while an escalation/call is pending, then later show owner decision/callback events and safe-checkpoint steering consumption.

### Owner callback from the same real API path

The console can request a callback through the existing `POST /v1/callbacks` route. It requires the normal `owner:callback` scope and therefore does not create a privileged browser-only path. The callback still uses the same control-plane persistence, budgets/rate limits where applicable, call provider abstraction, audit events, and durable instruction queue.

### Browser security boundary

`GET /operator` serves only static HTML/CSS/JavaScript and no configured token, phone number, CALL-E secret, run data, or audit data. API tokens remain in page memory and are sent only as bearer headers to same-origin API requests. The response uses `Cache-Control: no-store`, a restrictive same-origin Content Security Policy, `Referrer-Policy: no-referrer`, and `X-Content-Type-Options: nosniff`.

Added `tests/operator-ui.test.ts` proving the shell is served without embedding configured API/webhook secrets and that protected run data still returns `401` without authentication.

Added `docs/OPERATOR_CONSOLE.md` and linked the console from README.

## Architecture decisions made this run

1. The demo/operator surface must consume existing run/audit/callback contracts rather than deriving a second business-state layer.
2. Serving the static shell without authentication is acceptable only because it contains no server state or credentials; every data/action request still crosses the existing bearer/scope boundary.
3. Bearer credentials must never be placed in query strings, cookies, local storage, or server-rendered HTML by the built-in console.
4. Owner callback remains an explicitly scoped existing API operation, not a UI-specific privilege.
5. The console is evidence of control-plane behavior, not evidence of live CALL-E success.
6. No attempt was made to fake mid-generation interruption; the timeline continues to reflect safe-checkpoint instruction consumption.

## Verification performed

- Code-bearing commit `99fcc65cde7967655cd4476e9eb6f05ccc5c8291` (`feat: add operator run console`) added the UI, HTTP route, security headers, and regression test.
- GitHub Actions CI run `34081665407` completed successfully on September 7, 2026 UTC for that commit.
- CI used Node 24, locked dependency installation with `npm ci`, and the repository's `npm run check` pipeline. TypeScript typechecking/build and the full test suite, including the new operator-console test, passed.
- No live CALL-E call was attempted in this run.

## CALL-E integration status

- Fake provider: implemented and CI-tested end-to-end, including decision calls, callbacks, branch-scoped blocking, queued owner steering, checkpoint consumption, idempotency, policy, lifecycle recovery, auditability, restart-safe state, and now a browser-visible operator timeline over the same APIs.
- Production CALL-E adapter: implemented with server-only API key, structured result schemas, provider idempotency, asynchronous polling, webhook URL construction, terminal reconciliation, bounded create/poll HTTP requests, and duplicate-call prevention.
- Ambiguous create replay with the exact original idempotency key: implemented.
- Automatic recovery bounds/backoff and core recovery-exhaustion enforcement: implemented and CI-tested.
- Accepted-call stale timeout: implemented; terminal provider evidence is polled before stalling and CI-tested.
- Webhook event-id validation/deduplication + durable transaction: implemented.
- HTTP + TypeScript SDK + MCP path: implemented.
- Scoped credentials + callback/reconciliation rate limits: implemented and CI-tested.
- Graceful server/lifecycle/store shutdown: implemented and CI-tested.
- Reproducible dependency graph / `npm ci`: implemented and CI-tested.
- Operator console: implemented over existing authenticated APIs and CI-tested this run.
- Live CALL-E call: **not attempted and not claimed**. A valid CALL-E credential, authorized owner phone destination, and stable public HTTPS deployment remain external prerequisites.

## Current blockers

There is no blocker to continued repository development.

Live CALL-E verification still requires a valid CALL-E credential, authorized owner phone number, and public HTTPS deployment. Host-level Claude Code acceptance still requires an actual Claude Code installation/session. The current automation runtime cannot perform a normal networked local clone, but authenticated GitHub repository operations and GitHub Actions remain a working implementation/verification path.

## Highest-value next actions

1. Add a narrowly scoped readiness/configuration endpoint that distinguishes process liveness from deployment readiness without initiating a phone side effect or claiming unverified provider health.
2. Exercise the documented Claude Code stdio MCP registration path in a real Claude Code host when such a host is available, recording exact acceptance results instead of inferring them from protocol-level tests.
3. Improve the operator console with a read-only run snapshot endpoint only if needed to show unresolved blocking scopes/queued instruction counts without invoking `checkpoint`; keep it derived from core state and scoped as read-only.
4. Add an explicit operator-only resolution/recovery path for `stalled` or exhausted-ambiguous calls only if real deployment testing demonstrates a need; keep it separately scoped and audited.
5. Consider a shared store/rate limiter only when moving beyond the supported single-instance reference deployment.
6. Add broader Codex/ChatGPT adapters only where current platform capabilities can genuinely support the existing checkpoint/tool semantics; do not duplicate the state machine or claim mid-generation interruption.
