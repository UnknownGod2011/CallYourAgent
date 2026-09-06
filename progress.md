# progress.md

## Current status

CallYourAgent now has a durable Node 24 TypeScript control plane, SQLite persistence, fake and production CALL-E provider adapters, ambiguous-call recovery, polling/webhook convergence, and a deployable authenticated HTTP runtime. The core two-way product semantics remain unchanged: agents can escalate decisions without freezing unrelated work, owners can request callbacks, and resulting instructions are consumed at safe checkpoints.

## Inspected this run

- Full recursive repository tree before changes.
- `AGENTS.md` in full.
- `progress.md` in full.
- `README.md` in full.
- `docs/ARCHITECTURE.md` in full.
- `docs/INTEGRATIONS.md` in full.
- Recent commits on `main`.
- Open GitHub issues endpoint: none.
- Core source needed for the HTTP boundary: `control-plane.ts`, `domain.ts`, `sqlite-store.ts`, `call-provider.ts`, `calle-provider.ts`, `calle-webhook.ts`, `index.ts`, `.env.example`, and `package.json`.
- Current CALL-E developer/API/SDK documentation for terminal webhook delivery and security behavior.
- GitHub Actions run state after the HTTP/API test increment.

## Previously implemented

- Typed agent/run/escalation/decision/instruction/call-attempt domain model.
- `ControlPlaneStore` abstraction and deterministic in-memory store.
- Durable Node `node:sqlite` store with transactional webhook reconciliation and SQL uniqueness guarantees.
- `CallProvider` abstraction plus deterministic fake provider.
- Production CALL-E Calls API adapter with server-side auth, idempotency keys, structured results, polling, and webhook URL support.
- Persisted ambiguous create-call recovery using the exact same provider idempotency key.
- Shared terminal transition path for polling and webhooks.
- CALL-E terminal webhook parser and provider-event deduplication.
- End-to-end tests for non-blocking continuation, scoped blocking, callback steering, checkpoint consumption, idempotency, persistence, rollback, and webhook races.
- GitHub Actions Node 24 CI running `npm run check`.

## Implemented this run

### Authenticated HTTP control-plane API

Added `src/http-server.ts`, a dependency-free Node HTTP adapter over the existing `ControlPlane` semantics.

Agent-facing endpoints now include:

- `GET /health`
- `POST /v1/agents`
- `POST /v1/runs`
- `GET /v1/runs/:id`
- `POST /v1/runs/:id/heartbeat`
- `POST /v1/runs/:id/checkpoint`
- `POST /v1/escalations`
- `GET /v1/escalations/:id`
- `POST /v1/escalations/:id/reconcile`
- `POST /v1/callbacks`
- `GET /v1/callbacks/:id`
- `POST /v1/callbacks/:id/reconcile`
- `POST /webhooks/calle`

All agent-facing mutation/read routes except `/health` require `Authorization: Bearer <CYA_API_TOKEN>` with constant-time token comparison. JSON bodies are size-bounded and responses use `Cache-Control: no-store`.

Added public read methods on `ControlPlane` (`getRun`, `getEscalation`, `getCallAttempt`) so HTTP/MCP/SDK adapters can remain thin and not reach into store internals.

### Deployable environment bootstrap

Added `src/server.ts` and `npm start`.

Runtime selection is environment-driven:

- `CYA_CALL_PROVIDER=fake|calle`
- `CYA_STORE=memory|sqlite`
- `CYA_SQLITE_PATH`
- `CYA_API_TOKEN`
- `PORT`

Live CALL-E mode requires:

- `CALLE_API_KEY`
- `CYA_OWNER_PHONE`
- `CYA_PUBLIC_BASE_URL`
- `CYA_CALLE_WEBHOOK_TOKEN`

The backend constructs the full CALL-E webhook URL automatically, reducing future setup to credentials/configuration rather than code edits.

### CALL-E webhook ingress security

Fresh CALL-E SDK/documentation verification found that current terminal webhooks are unsigned: current delivery does not use a webhook secret, timestamp signature, or signature header. The documented integrity mechanism is the required `CALL-E-Event-Id` header matching the body event `id`, with event-id deduplication for at-least-once delivery.

Because a public unsigned webhook endpoint would otherwise be spoofable, CallYourAgent adds its own application-owned secret token to the webhook URL. The receiver requires BOTH:

1. constant-time match of the `CYA_CALLE_WEBHOOK_TOKEN` URL token;
2. exact `CALL-E-Event-Id` header/body-id agreement.

This is intentionally not described as a CALL-E signature. If CALL-E later adds signed webhook delivery, the HTTP ingress can add signature verification without changing domain reconciliation.

### Tests

Added `tests/http-server.test.ts` covering:

- health endpoint availability;
- rejection of unauthenticated agent API access;
- real register/start/escalate/checkpoint flow through HTTP;
- non-blocking escalation remaining absent from `unresolvedBlockingScopes`;
- CALL-E webhook secret-token rejection;
- CALL-E event-header/body mismatch rejection.

### Documentation/configuration

- Updated `.env.example` to match the real runtime contract.
- Exported HTTP/bootstrap surfaces from `src/index.ts`.
- Updated `docs/ARCHITECTURE.md` with the HTTP adapter, runtime selection, current CALL-E unsigned-webhook behavior, and security model.

## Architecture decisions

1. HTTP is an adapter over `ControlPlane`, not a second business-logic layer.
2. One bearer token is sufficient for the current trusted single-owner MVP; multi-tenant/per-agent credentials can evolve later without changing domain semantics.
3. Current CALL-E webhooks are treated as unsigned provider delivery. We verify their documented event-id invariant and add an application-owned secret URL capability token.
4. The webhook URL is generated by runtime configuration in live mode so setup remains low-friction.
5. Fake provider remains the default; selecting live CALL-E requires explicit environment configuration.
6. The server remains dependency-free for now, reducing attack/dependency surface before MCP/SDK libraries are introduced.

## Verification performed

- GitHub Actions run `34044298897` for commit `71db321ddb1e0dc50ca2fc2ed11c0a9262923f89` completed successfully.
- That code-bearing run includes the new HTTP server and HTTP API tests and executes dependency install, TypeScript typecheck/build, and the full Node test suite through `npm run check`.
- Earlier commit containing the server/bootstrap and package changes also completed CI successfully before the HTTP test commit.
- Reviewed the resulting source/configuration through GitHub connector reads/writes.
- Verified current CALL-E webhook behavior from current developer SDK/documentation: terminal webhooks are unsigned and receivers should validate `CALL-E-Event-Id` against body `id` and deduplicate by event id.
- No live CALL-E call was attempted because this run has no authorized API key/destination phone.

## CALL-E integration status

- Fake provider: implemented and tested.
- Production CALL-E HTTP provider: implemented.
- Server-only API key handling: implemented.
- Stable provider idempotency key propagation: implemented.
- Polling terminal reconciliation: implemented.
- Purpose-specific structured decision/callback results: implemented.
- Ambiguous create-call persistence and same-key recovery: implemented.
- Terminal webhook parser: implemented.
- Webhook event-id deduplication + shared terminal reconciliation: implemented.
- Durable webhook transaction boundary: implemented.
- Durable SQLite state across restart: implemented and tested.
- HTTP webhook receiver: implemented.
- Current provider event-id integrity validation: implemented.
- Application-owned webhook secret capability token: implemented.
- Environment-selectable live/fake provider: implemented.
- Live CALL-E call: not attempted because no credential/authorized phone is available to this run.

## Current blockers

No blocker to continued repository development.

Live CALL-E verification requires a valid `CALLE_API_KEY`, an authorized owner destination phone number, and a publicly reachable HTTPS deployment URL. Those are external/user/account prerequisites only; they do not block MCP, SDK, policy, or integration development.

## Highest-value next actions

1. Add an MCP server as a thin adapter over these exact HTTP/core semantics, with tools for register/start/status/escalation/checkpoint/callback.
2. Add a small TypeScript SDK so custom agents and platform adapters do not hand-write REST calls.
3. Build the first real Claude/Claude Code MCP + checkpoint integration and an end-to-end fixture proving queued owner steering is consumed between work units.
4. Add quiet hours, call budgets, retry bounds, escalation expiry sweep behavior, and an audit-event stream before broad UI work.
5. Add graceful shutdown and production deployment documentation; validate SQLite file persistence on the chosen host.
6. Add rate limiting / credential scoping before exposing the API beyond a trusted single-owner deployment.
7. Add a lockfile and switch CI back to `npm ci` once dependency choices stabilize.
