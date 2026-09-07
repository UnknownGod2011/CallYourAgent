# progress.md

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. It has SQLite persistence, deterministic fake and production CALL-E providers, replayable/idempotent call attempts, polling/webhook convergence, scoped authenticated HTTP APIs, a typed TypeScript client, stdio MCP, branch/checkpoint semantics, decision-call policy, durable privacy-aware audit history, bounded lifecycle recovery, fail-closed ambiguous/stalled call handling, API abuse controls, graceful runtime shutdown, hard CALL-E HTTP deadlines, reproducible npm dependencies, a thin operator console, a production container image, and now a reproducible single-instance Docker Compose deployment with a named persistent SQLite volume and CI verification across restart.

The core product semantics remain unchanged: an autonomous agent can request genuinely important human judgment without freezing unrelated scopes; the owner can independently request a voice callback to hear current status and steer the run; owner decisions and instructions become durable structured state and are consumed at safe checkpoints rather than being represented as impossible mid-generation interruption.

## Exact repo state inspected this run

Before making any change, inspected the complete recursive `main` repository tree at `2482f171ea444c6a869248d219ebf0eea8e062de`, including source, tests, CI/configuration, package metadata, Docker artifacts, and all documentation paths.

Read `AGENTS.md`, this file, `README.md`, `docs/ARCHITECTURE.md`, `docs/INTEGRATIONS.md`, `docs/CALL_POLICY.md`, `docs/API_SECURITY.md`, `docs/DEPLOYMENT.md`, and `docs/OPERATOR_CONSOLE.md` in full. Inspected recent commits through the production-container work. Checked repository issues and pull requests; there were none.

Also inspected `src/http-server.ts`, `src/server.ts`, `tests/http-server.test.ts`, `Dockerfile`, and `.github/workflows/container.yml` while evaluating the next increment. The runtime still cannot resolve `github.com` for a normal local clone, so repository mutations used authenticated GitHub Git-data operations and verification used GitHub Actions.

## Existing foundation preserved

- Agent registration, run state, heartbeats/status, branch-scoped blocking, owner decisions, owner callbacks, durable instruction queues, and safe checkpoint consumption.
- In-memory and durable `node:sqlite` stores with WAL, explicit transactions, uniqueness constraints, rollback/reload behavior, persisted causal audit ordering, and idempotent close semantics.
- Fake CALL-E provider and production CALL-E Calls API adapter with server-only credentials, structured results, provider idempotency, polling, terminal webhook support, and hard request deadlines.
- Persist-before-side-effect call attempts containing exact replayable provider requests and idempotency state.
- Shared polling/webhook terminal transition plus provider-event deduplication.
- Typed HTTP client, stdio MCP adapter, and Claude-style end-to-end MCP work-loop tests.
- Priority gates, quiet hours, critical bypass, per-run/per-owner call budgets, escalation expiry, durable policy deferral, bounded ambiguous recovery, and stalled accepted-call review state.
- Scoped HTTP credentials and per-credential callback/reconciliation rate limits.
- Owned runtime with non-overlapping lifecycle sweeps and graceful HTTP/lifecycle/store shutdown.
- Reproducible dependency graph enforced by `npm ci` in CI.
- Built-in `/operator` UI over existing authenticated run/audit/callback APIs.
- Production-oriented non-root Docker image with fake-provider container smoke testing.

## Changes made this run

### Reproducible single-instance Compose deployment

Added `deploy/compose.yml` as the supported local/reference deployment recipe for the existing single-instance SQLite architecture. It builds the checked-in production `Dockerfile`, runs one CallYourAgent process, binds the HTTP service to loopback by default, and mounts the entire `/data` directory from a named Docker volume.

Persisting the directory rather than a single database file preserves SQLite WAL sibling files and matches the durable-store assumptions already documented by the project.

The Compose recipe keeps CALL-E credentials and API credentials runtime-only. Fake provider mode remains the default. Live CALL-E values are optional environment inputs and do not enter image layers.

The service uses a 30-second stop grace period so the existing graceful HTTP/lifecycle/store shutdown path has time to drain. The deployment remains explicitly single-instance; this change does not pretend SQLite or the process-local limiter is horizontally scalable.

### Deployment instructions

Added `deploy/README.md` with fake-first startup, restart, safe shutdown, volume-retention guidance, live CALL-E prerequisites, loopback/TLS boundaries, webhook query-token log redaction, scoped-credential guidance, and the explicit single-instance limitation.

The instructions distinguish `/health` liveness from live provider verification and do not claim a real CALL-E call.

### Compose CI

Added `.github/workflows/compose.yml`. On pushes to `main` and pull requests it:

1. validates the Compose model with `docker compose config --quiet`;
2. builds and boots CallYourAgent in deterministic fake-provider mode;
3. waits for `/health`;
4. verifies the configured named Docker volume exists;
5. restarts the same service and verifies it becomes healthy again;
6. tears down the CI deployment and volume.

This is deployment-path verification, not a second application runtime or fake business-state implementation.

## Architecture decisions made this run

1. The reference deployment remains one Node process + one SQLite volume. Compose must make this boundary obvious rather than implying horizontal scalability.
2. Persistence is mounted at the `/data` directory level because WAL state lives beside the main database file.
3. Fake provider mode is the deployment default so bring-up and CI never spend phone credits or fabricate live success.
4. Host publishing defaults to `127.0.0.1`; public HTTPS ingress remains an explicit operator responsibility for live CALL-E webhooks.
5. Deployment orchestration must use the existing production Docker image and existing control-plane runtime, not a parallel demo server.
6. Container restart verification is useful evidence that the deployment recipe preserves the durable-volume topology, while deeper domain restart persistence remains covered by the existing SQLite tests.
7. The previously identified readiness/configuration endpoint remains valuable and should stay separate from `/health`; this run did not risk reconstructing large working HTTP/server source files merely to force that change through a connector without patch semantics.

## Verification performed

Code/deployment commit: `eb8ceb306ee0ee3c90af6a6b0a22f13505d14324` (`deploy: add persistent compose reference`).

GitHub Actions on that commit:

- Compose deployment run `34089093398`: passed. Compose configuration validation, fake-provider build/boot, health wait, named-volume inspection, service restart, second health wait, and cleanup all succeeded.
- Standard CI run `34089093377`: passed, covering locked `npm ci` plus the repository's existing `npm run check` typecheck/build/test pipeline.
- Existing Container run `34089093357`: passed, preserving the production Docker image build and fake-provider container smoke test.

A normal local clone/test run was not possible because this automation container still cannot resolve `github.com`; external GitHub Actions provided the executable verification path instead.

No live CALL-E call was attempted or claimed.

## CALL-E integration status

- Fake provider: implemented and CI-tested end-to-end, including decision calls, callbacks, branch-scoped blocking, queued owner steering, checkpoint consumption, idempotency, policy, lifecycle recovery, auditability, restart-safe state, operator visualization, production container boot, and now Compose deployment/restart verification.
- Production CALL-E adapter: implemented with server-only API key, structured result schemas, provider idempotency, asynchronous polling, webhook URL construction, terminal reconciliation, bounded create/poll HTTP requests, and duplicate-call prevention.
- Ambiguous create replay with the exact original idempotency key: implemented.
- Automatic recovery bounds/backoff and core recovery-exhaustion enforcement: implemented and CI-tested.
- Accepted-call stale timeout: implemented and CI-tested.
- Webhook event-id validation/deduplication plus durable transaction: implemented.
- HTTP + TypeScript SDK + MCP path: implemented.
- Scoped credentials plus callback/reconciliation rate limits: implemented and CI-tested.
- Graceful server/lifecycle/store shutdown: implemented and CI-tested.
- Reproducible dependency graph / `npm ci`: implemented and CI-tested.
- Production container + Compose persistent-volume deployment path: implemented and CI-tested.
- Live CALL-E call: **not attempted and not claimed**. A valid CALL-E credential, authorized owner phone destination, and stable public HTTPS deployment remain external prerequisites.

## Current blockers

There is no blocker to continued repository development.

Live CALL-E verification still requires a valid CALL-E credential, authorized owner phone number, and public HTTPS deployment. Host-level Claude Code acceptance still requires an actual Claude Code installation/session. The automation runtime cannot perform a normal networked local clone, but authenticated GitHub repository operations and GitHub Actions remain usable implementation and verification paths.

## Highest-value next actions

1. Add the narrowly scoped readiness/configuration endpoint already identified, distinguishing liveness from valid runtime configuration without probing CALL-E or initiating a phone side effect. Prefer a safe source-patch path rather than manually reconstructing large working files.
2. Exercise the documented Claude Code stdio MCP registration path in a real Claude Code host when such a host becomes available and record exact acceptance evidence.
3. Strengthen the Compose smoke test from restart-safe boot to a small API-created durable run/state round trip across restart if that can be done without duplicating existing domain tests.
4. Improve the operator console with a read-only run snapshot only if needed to show unresolved blocking scopes or queued instruction counts without consuming checkpoint state.
5. Add broader Codex/ChatGPT adapters only where current platform capabilities genuinely support the existing tool/checkpoint semantics; do not duplicate the state machine or claim mid-generation interruption.
