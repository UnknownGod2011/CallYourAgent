# progress.md

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. It has SQLite persistence, deterministic fake and production CALL-E providers, replayable/idempotent call attempts, polling/webhook convergence, scoped authenticated HTTP APIs, a typed TypeScript client, stdio MCP, CI-proven Claude-style branch/checkpoint behavior, decision-call policy, durable privacy-aware audit history, bounded lifecycle recovery, fail-closed ambiguous/stalled call handling, API abuse controls, graceful runtime shutdown, hard CALL-E HTTP deadlines, reproducible npm dependencies, a thin operator console, and now a production-oriented container image that is built and smoke-tested in CI.

The core product semantics remain unchanged: an autonomous agent can request genuinely important human judgment without freezing unrelated scopes; the owner can independently request a voice callback to hear current status and steer the run; owner decisions and instructions become durable structured state and are consumed at safe checkpoints rather than being represented as impossible mid-generation interruption.

## Exact repo state inspected this run

Before making changes, inspected the complete recursive `main` repository tree at `abf7f7a65eeab0efdc0befcef2a6291327ad42d9`, including source, tests, CI/configuration, package metadata, and all documentation paths. Inspected recent commits through the operator-console work and checked repository issues; there were no current issues.

Read `AGENTS.md`, this file, `README.md`, `docs/ARCHITECTURE.md`, `docs/INTEGRATIONS.md`, `docs/CALL_POLICY.md`, `docs/API_SECURITY.md`, `docs/DEPLOYMENT.md`, and `docs/OPERATOR_CONSOLE.md` in full before modifying the repository. Also inspected `src/http-server.ts`, `src/server.ts`, `tests/http-server.test.ts`, and `package.json` while evaluating the recorded readiness/configuration endpoint as the next increment.

The execution container still cannot resolve `github.com`, so a normal local clone remains unavailable. Rather than hand-rewrite a large working HTTP/server file through the contents API, this run switched to a safe new-file-only deployment increment and verified it externally through GitHub Actions.

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

## Changes made this run

### Production container image

Added a multi-stage `Dockerfile` based on Node 24 Bookworm slim. The build stage installs the committed dependency graph with `npm ci`, compiles TypeScript, and prunes development dependencies. The runtime stage contains only the production dependency tree and compiled `dist` output, runs as the non-root `node` user, exposes port 8787, and uses `/data` as the persistent SQLite volume location.

The image defaults to `CYA_STORE=sqlite` and `CYA_SQLITE_PATH=/data/callyouragent.db`. It deliberately does not bake any API token, CALL-E credential, phone number, or webhook secret into the image. Provider mode and credentials remain runtime configuration.

Added a container `HEALTHCHECK` against the existing unauthenticated `/health` liveness endpoint. This is intentionally only process liveness; it does not claim CALL-E provider health or live deployment readiness.

### Minimal Docker build context

Added `.dockerignore` to exclude local dependencies, build output, Git metadata, SQLite/WAL files, logs, and local environment files while retaining `.env.example` as documentation.

### Container CI and fake-provider smoke test

Added `.github/workflows/container.yml`. On pushes to `main` and pull requests, GitHub Actions now:

1. builds the production Docker image;
2. starts the image with the deterministic fake CALL-E provider and a CI-only local bearer token;
3. polls `/health` from the host;
4. fails and prints container logs if the runtime does not become healthy.

This proves the checked-in container can actually build and boot the same compiled server used by the repository rather than treating the Dockerfile as unexecuted deployment documentation.

## Architecture decisions made this run

1. Containerization must not create a second runtime path: the image runs the existing `dist/src/server.js` control plane.
2. Production image configuration remains environment-driven; no CALL-E key, phone number, API token, or webhook secret belongs in the image layers.
3. The reference container defaults to durable SQLite storage under `/data`, but deployment operators still must attach a persistent volume; declaring a Docker volume is not itself a hosted persistence guarantee.
4. CI smoke testing uses the deterministic fake provider so verification never spends credits or falsely claims live CALL-E success.
5. Docker health checks continue to represent liveness only. A future readiness/configuration endpoint must remain separate and must not trigger a provider side effect.
6. Because direct clone/patch support is unavailable in this runtime, large existing source files were not riskily reconstructed by hand merely to force the previously listed readiness endpoint into this run.

## Verification performed

- `Dockerfile` commit: `459b61cd569f6cce1aedba3fa77deac85e26fc3e`.
- `.dockerignore` commit: `697c167675521c03f4b56c8805c51d171b58c486`.
- Container workflow commit: `553e556c17cd6ea6649a55580d0cdabc6e48df3f`.
- Standard GitHub Actions CI run `34085098551` completed successfully for `553e556c17cd6ea6649a55580d0cdabc6e48df3f`, covering locked dependency installation and the repository's existing `npm run check` typecheck/build/test pipeline.
- New Container workflow run `34085098399` completed successfully for the same commit. The Docker production image build passed and the fake-provider runtime smoke test reached `/health` successfully.
- No live CALL-E call was attempted or claimed.

## CALL-E integration status

- Fake provider: implemented and CI-tested end-to-end, including decision calls, callbacks, branch-scoped blocking, queued owner steering, checkpoint consumption, idempotency, policy, lifecycle recovery, auditability, restart-safe state, operator visualization, and now boot inside the production container image.
- Production CALL-E adapter: implemented with server-only API key, structured result schemas, provider idempotency, asynchronous polling, webhook URL construction, terminal reconciliation, bounded create/poll HTTP requests, and duplicate-call prevention.
- Ambiguous create replay with the exact original idempotency key: implemented.
- Automatic recovery bounds/backoff and core recovery-exhaustion enforcement: implemented and CI-tested.
- Accepted-call stale timeout: implemented and CI-tested.
- Webhook event-id validation/deduplication plus durable transaction: implemented.
- HTTP + TypeScript SDK + MCP path: implemented.
- Scoped credentials plus callback/reconciliation rate limits: implemented and CI-tested.
- Graceful server/lifecycle/store shutdown: implemented and CI-tested.
- Reproducible dependency graph / `npm ci`: implemented and CI-tested.
- Production container build + fake boot smoke test: implemented and CI-tested this run.
- Live CALL-E call: **not attempted and not claimed**. A valid CALL-E credential, authorized owner phone destination, and stable public HTTPS deployment remain external prerequisites.

## Current blockers

There is no blocker to continued repository development.

Live CALL-E verification still requires a valid CALL-E credential, authorized owner phone number, and public HTTPS deployment. Host-level Claude Code acceptance still requires an actual Claude Code installation/session. The automation runtime cannot perform a normal networked local clone, but authenticated GitHub repository operations and GitHub Actions remain usable implementation and verification paths.

## Highest-value next actions

1. Add the narrowly scoped readiness/configuration endpoint previously identified, distinguishing liveness from valid runtime configuration without probing CALL-E or initiating a phone side effect. Prefer doing this when a safe source patch path is available rather than hand-rewriting the large HTTP/server files.
2. Add an optional deployment recipe/manifest for one persistent-volume hosting target only after preserving the single-instance SQLite boundary explicitly.
3. Exercise the documented Claude Code stdio MCP registration path in a real Claude Code host when such a host is available and record exact acceptance evidence.
4. Improve the operator console with a read-only run snapshot only if needed to show unresolved blocking scopes or queued instruction counts without consuming checkpoint state.
5. Add broader Codex/ChatGPT adapters only where current platform capabilities genuinely support the existing tool/checkpoint semantics; do not duplicate the state machine or claim mid-generation interruption.
