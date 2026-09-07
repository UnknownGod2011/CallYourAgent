# progress.md

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for two-way voice coordination between autonomous AI agents and their owners. It currently has SQLite persistence, deterministic fake and production CALL-E providers, persisted replayable call attempts, same-idempotency ambiguous-call recovery, polling/webhook convergence, scoped authenticated HTTP APIs, a typed TypeScript client, stdio MCP, CI-proven Claude-style branch/checkpoint behavior, decision-call policy, durable privacy-aware audit history, background lifecycle reconciliation, bounded ambiguous-call recovery, fail-closed stale accepted-call handling, and API abuse controls around human callbacks/provider reconciliation.

The product semantics remain unchanged: an agent may call its owner for genuinely important human judgment without freezing unrelated scopes; the owner may independently request a callback to hear current status and steer the run; human answers/instructions become durable structured state consumed only at safe checkpoints.

## Exact repo state inspected this run

Before making changes, inspected the complete recursive `main` tree at `8667b3c94b262e6d7cd56ac236e97ffc839fa4b6`, recent commits through the stale-call hardening work, and relevant issues/PRs (none). Read `AGENTS.md`, this file, `README.md`, `docs/ARCHITECTURE.md`, `docs/INTEGRATIONS.md`, and `docs/CALL_POLICY.md` in full. Inspected `src/http-server.ts`, `src/server.ts`, `src/index.ts`, `tests/http-server.test.ts`, and `.env.example` because the previous run identified credential scopes and API-level callback/reconciliation limits as the highest-value remaining exposure risk.

The runtime still cannot clone `github.com`, so direct repository changes were made through authenticated GitHub repository operations and verification used GitHub Actions.

## Existing foundation preserved

- Agent registration, run state, heartbeats/status, branch-scoped blocking, owner decisions, owner callbacks, durable instruction queues, and safe checkpoint consumption.
- In-memory and durable `node:sqlite` stores with WAL, explicit transactions, uniqueness constraints, rollback/reload behavior, and persisted audit ordering.
- Fake CALL-E provider and production CALL-E Calls API adapter with server-only credentials, structured results, provider idempotency, polling, and terminal webhook support.
- Persist-before-side-effect call attempts with exact task/metadata/idempotency data required for safe replay after ambiguous provider outcomes.
- Shared polling/webhook terminal transition and provider-event deduplication.
- Typed HTTP client, MCP stdio adapter, and Claude-style end-to-end MCP work-loop tests.
- Decision priority gates, quiet hours, critical bypass, per-run/per-owner call budgets, escalation expiry, and durable policy-deferral reasons.
- Privacy-aware audit timeline with durable monotonic event ordering.
- Periodic lifecycle sweeps with exponential backoff, bounded recovery, fail-closed exhaustion, and stalled accepted-call handling.

## Changes made this run

### Scoped HTTP credentials

The HTTP server now supports multiple bearer credentials with explicit scopes:

- `agent:read`
- `agent:write`
- `audit:read`
- `owner:callback`
- `calls:reconcile`
- `*`

Normal agent/MCP credentials can therefore be limited to agent read/write and optional audit access without implicitly receiving the ability to create owner callbacks or exercise provider reconciliation endpoints. Missing scope returns HTTP `403` before domain mutation.

`CYA_API_TOKEN` remains supported as a backwards-compatible full-access trusted token for local/single-owner setups. Exposed deployments can instead configure `CYA_API_CREDENTIALS_JSON`; runtime parsing validates the JSON structure, supported scopes, non-empty ids/tokens, and uniqueness. Bearer token comparison remains constant-time.

### Targeted API rate limits

Added per-credential fixed-window limits around the two HTTP surfaces most likely to amplify into real-world provider behavior:

- owner callback creation (`POST /v1/callbacks`) defaults to 6 requests/minute;
- explicit decision/callback reconciliation defaults to 60 requests/minute shared per credential.

Rate-limited requests return HTTP `429` plus `Retry-After` and do not invoke the control-plane operation. Limits are configurable through `CYA_CALLBACK_RATE_LIMIT_PER_MINUTE` and `CYA_RECONCILE_RATE_LIMIT_PER_MINUTE`.

The limiter is intentionally process-local and documented as such because the current reference deployment is single-instance SQLite. A future multi-instance deployment must move counters to shared storage rather than pretending these are globally distributed limits.

### Regression coverage

Expanded `tests/http-server.test.ts` to prove:

1. a normal scoped agent credential can still register/start work;
2. that agent credential cannot request owner callbacks;
3. an owner-scoped credential can request a callback;
4. repeated owner callbacks hit HTTP `429` with `Retry-After` before another control-plane call;
5. a normal agent credential cannot use reconciliation;
6. a dedicated reconciliation credential can use the endpoint but is rate-limited independently.

The existing legacy single-token authentication and webhook tests remain intact.

### Documentation/configuration

Updated `.env.example` with scoped credential and API-rate-limit configuration. Added `docs/API_SECURITY.md` documenting the privilege split, recommended credential assignments, exact rate-limit behavior, and the process-local limitation.

## Architecture decisions made this run

1. Agent capabilities and owner/operator call-control capabilities are separate privileges at the HTTP boundary.
2. A normal agent integration should not automatically receive `owner:callback` or `calls:reconcile`.
3. Backwards compatibility is preserved through the legacy full-access token, but it is explicitly a trusted-mode credential rather than the recommended exposed deployment model.
4. Rate limiting happens before the relevant control-plane operation so rejected requests cannot create or reconcile phone side effects.
5. API abuse limits are separate from durable decision-call policy. Quiet hours/budgets still govern autonomous agent -> owner calls in the control plane.
6. The current process-local limiter is sufficient for the single-instance SQLite reference architecture and is documented honestly rather than represented as distributed protection.

## Verification performed

- Direct local clone/test execution remains unavailable because the runtime cannot resolve `github.com`.
- Code-bearing commit `85c97e5bc238f95c7821588fd7b7b4ef60f02ed6` triggered GitHub Actions CI run `34068587632`.
- CI completed successfully on September 7, 2026 UTC.
- The workflow used Node 24 and the repository's `npm run check` path, covering TypeScript typechecking, build, and the complete Node test suite.
- The new scoped-credential and rate-limit HTTP regression tests passed in that run.
- No live CALL-E call was attempted. No authorized CALL-E credential/owner destination/public HTTPS deployment was available, so there is still no claim of live provider success.

## CALL-E integration status

- Fake provider: implemented and CI-tested end-to-end.
- Production CALL-E adapter: implemented with server-only API key, structured results, polling, webhook URL construction, and provider idempotency.
- Same-key ambiguous recovery: implemented.
- Automatic recovery bounds/backoff: implemented and CI-tested.
- Core enforcement of recovery exhaustion: implemented and CI-tested.
- Accepted-call stale timeout: implemented and CI-tested.
- Webhook dedupe + durable transaction: implemented.
- HTTP + TypeScript SDK + MCP integration path: implemented.
- Scoped HTTP credentials + callback/reconciliation rate limits: implemented and CI-tested this run.
- Live CALL-E call: not attempted; external credentials/authorized phone/public HTTPS deployment remain prerequisites.

## Current blockers

There is no blocker to continued repository development.

Live CALL-E verification still requires a valid CALL-E credential, authorized owner phone number, and public HTTPS deployment. Host-level Claude Code acceptance still requires an actual Claude Code installation/session. The execution runtime still cannot clone GitHub because of DNS resolution, but direct GitHub access and GitHub Actions CI remain available.

## Highest-value next actions

1. Add graceful shutdown that stops lifecycle sweeps and cleanly closes HTTP/SQLite resources.
2. Add production deployment guidance for persistent disk, TLS/reverse proxy expectations, scoped credential examples, and stable public HTTPS webhook ingress.
3. Consider persistent/shared rate-limit storage only when moving beyond a single control-plane instance.
4. Add an explicit operator-only resolution path for `stalled` / exhausted-ambiguous attempts only if real deployment testing demonstrates a need; keep it separately authorized and audited.
5. Generate a lockfile and switch CI to `npm ci` once dependency choices stabilize.
6. Exercise the documented Claude Code MCP registration path in a real host and record exact acceptance results.
7. After reliability/security hardening, build a small status/demo UI over existing run/audit APIs rather than adding another business-state layer.
