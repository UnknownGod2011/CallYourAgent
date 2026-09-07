# progress.md

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. The core product semantics remain unchanged: an autonomous agent can request genuinely important human judgment without freezing unrelated branches/scopes; the owner can independently request a callback for current progress or steering; human decisions/instructions become durable structured state and are consumed at safe checkpoints rather than being represented as impossible mid-generation interruption.

The repository currently includes SQLite persistence, deterministic fake and production CALL-E providers, replayable/idempotent call attempts, polling/webhook convergence, scoped authenticated HTTP APIs, a typed TypeScript client, stdio MCP, branch/checkpoint semantics, decision-call policy, privacy-aware audit history, bounded lifecycle recovery, fail-closed ambiguous/stalled call handling, API abuse controls, graceful runtime shutdown, hard CALL-E HTTP deadlines, reproducible npm dependencies, a thin operator console, a production container image, and a single-instance Docker Compose reference deployment with persistent SQLite storage.

## Exact repo state inspected this run

Before making any change, inspected the complete recursive `main` repository tree at `5b15e058673341046b0ca7ac1c949c22077885ad`, including source, tests, CI/configuration, package metadata, Docker/deployment files, and all documentation paths.

Read `AGENTS.md`, this file, `README.md`, `docs/ARCHITECTURE.md`, `docs/INTEGRATIONS.md`, `docs/CALL_POLICY.md`, `docs/API_SECURITY.md`, `docs/DEPLOYMENT.md`, and `docs/OPERATOR_CONSOLE.md` in full. Inspected recent commits through the persistent Compose deployment work. Checked repository issues and pull requests; there were none.

Also inspected `src/http-server.ts`, `src/server.ts`, `tests/http-server.test.ts`, `package.json`, `.github/workflows/compose.yml`, and `deploy/README.md` while evaluating the next implementation increment.

A normal local clone was attempted again and still failed because the automation runtime cannot resolve `github.com`. Rather than manually reconstructing large working TypeScript files through whole-file replacement, this run switched to the next high-value deployment/reliability increment that could be changed safely and verified through GitHub Actions.

## Existing foundation preserved

- Agent registration, run state, heartbeats/status, branch-scoped blocking, owner decisions, owner callbacks, durable instruction queues, and safe checkpoint consumption.
- In-memory and durable `node:sqlite` stores with WAL, transactions, uniqueness constraints, rollback/reload behavior, durable audit ordering, and restart-safe state.
- Fake CALL-E provider plus production CALL-E Calls API adapter with server-only credentials, structured results, provider idempotency, polling, terminal webhook support, and hard HTTP deadlines.
- Persist-before-side-effect call attempts containing the exact replayable provider request and idempotency key.
- Shared polling/webhook terminal transition and provider-event deduplication.
- Typed HTTP client, stdio MCP adapter, and Claude-style checkpoint/work-loop tests.
- Priority gates, quiet hours, critical bypass, per-run/per-owner call budgets, escalation expiry, durable policy deferral, bounded ambiguous recovery, and stalled accepted-call review state.
- Scoped HTTP credentials and per-credential callback/reconciliation rate limits.
- Owned runtime with non-overlapping lifecycle sweeps and graceful HTTP/lifecycle/store shutdown.
- Reproducible dependency graph enforced with `npm ci`.
- Built-in `/operator` UI over existing authenticated run/audit/callback APIs.
- Production non-root Docker image and deterministic fake-provider container smoke testing.
- Single-instance Compose deployment using a named volume for the full SQLite `/data` directory.

## Changes made this run

### Deployment-path durable-state verification

Strengthened `.github/workflows/compose.yml` so Compose CI now verifies durable **control-plane state**, not merely process health across restart.

The workflow now:

1. validates the Compose model;
2. builds and boots the production image in deterministic fake-provider mode;
3. waits for `/health`;
4. creates an agent through the authenticated `POST /v1/agents` API;
5. starts a run through `POST /v1/runs`;
6. reports a heartbeat with a distinctive summary/scope;
7. records the generated run id in the workflow environment;
8. verifies the named SQLite volume exists;
9. restarts the same `callyouragent` service;
10. waits for the runtime to become healthy again;
11. fetches the original run through `GET /v1/runs/:runId` and asserts the persisted summary/scope survived;
12. fetches `GET /v1/runs/:runId/audit` and asserts persisted audit history also survived;
13. cleans up the CI deployment and volume.

This closes an important gap between unit-level SQLite restart tests and deployment-level evidence: the actual production Compose topology now proves authenticated API-created state is durable across a real container restart.

### Deployment documentation

Updated `deploy/README.md` to document exactly what the Compose workflow proves and what it does not. The documentation continues to distinguish `/health` liveness from CALL-E/provider readiness and does not claim live CALL-E behavior.

## Architecture decisions made this run

1. Deployment verification should exercise the existing HTTP control plane and SQLite persistence rather than introduce a special test-only persistence path.
2. The restart smoke test should verify both the current run snapshot and durable audit history, because successful `/health` after restart alone does not prove state survived.
3. CI uses the deterministic fake provider and a CI-only API token; no phone side effect, CALL-E credential, or real destination is involved.
4. The existing single-instance SQLite boundary remains explicit. This work does not imply multi-instance safety.
5. `/health` remains process liveness only. A future readiness/configuration endpoint should remain separate and must not probe CALL-E or trigger a call.
6. The readiness endpoint remains the preferred next source-code increment, but whole-file reconstruction of `src/http-server.ts`/`src/server.ts` was intentionally avoided while this runtime lacks a safe clone/patch path.

## Verification performed

Implementation commit: `c9559842d54ebecb182e325848c95d32c6803d17` (`ci: prove compose state survives restart`).

GitHub Actions on that commit all passed:

- Standard `check` job (workflow run `34094760242`): passed. This covers the repository's locked `npm ci` plus `npm run check` typecheck/build/test pipeline.
- Compose deployment run `34094760204`: passed. Every step succeeded, including authenticated agent/run creation, heartbeat, named-volume inspection, container restart, persisted run snapshot verification, persisted audit verification, and cleanup.
- Production container run `34094760187`: passed, preserving the production Docker image build and deterministic fake-provider boot smoke test.

Local clone/test execution was not possible because this automation runtime still cannot resolve `github.com`; GitHub Actions provided executable verification against the committed repository state.

No live CALL-E call was attempted or claimed.

## CALL-E integration status

- Fake provider: implemented and CI-tested end-to-end for decision calls, callbacks, branch-scoped blocking, queued owner steering, checkpoint consumption, idempotency, policy, lifecycle recovery, auditability, SQLite restart, operator visualization, production container boot, Compose deployment, and now authenticated API state persistence across Compose restart.
- Production CALL-E adapter: implemented with server-only API key, structured result schemas, provider idempotency, asynchronous polling, webhook URL construction, terminal reconciliation, bounded create/poll HTTP requests, and duplicate-call prevention.
- Ambiguous create replay using the exact original idempotency key: implemented.
- Bounded automatic recovery/backoff and core recovery-exhaustion enforcement: implemented and tested.
- Accepted-call stale timeout/fail-closed `stalled` state: implemented and tested.
- Webhook event-id validation/deduplication plus durable transaction: implemented.
- HTTP + TypeScript SDK + MCP path: implemented.
- Scoped credentials plus callback/reconciliation rate limits: implemented and tested.
- Graceful server/lifecycle/store shutdown: implemented and tested.
- Production container + persistent-volume Compose deployment: implemented and CI-tested.
- Live CALL-E call: **not attempted and not claimed**. A valid CALL-E credential, authorized owner phone destination, and stable public HTTPS deployment remain external prerequisites.

## Current blockers

There is no blocker to continued repository development.

Live CALL-E verification still requires a valid CALL-E credential, authorized owner phone number, and public HTTPS deployment. Real Claude Code host acceptance still requires an actual Claude Code installation/session. This automation runtime still cannot perform a normal networked clone, but authenticated GitHub mutations and GitHub Actions remain usable implementation/verification paths.

## Highest-value next actions

1. Add the narrowly scoped readiness/configuration endpoint already identified, distinguishing process liveness from validated runtime configuration while explicitly not probing CALL-E or initiating a phone side effect. Do this when a safe source patch path is available.
2. Exercise the documented Claude Code stdio MCP registration path in a real Claude Code host when such an environment becomes available, and record exact acceptance evidence.
3. Consider extending deployment smoke coverage to one complete fake-provider escalation/callback/checkpoint round trip only if it adds evidence beyond the already extensive domain/integration tests without making CI brittle.
4. Improve the operator console with read-only unresolved blocking-scope and queued-instruction counts only if useful for the hackathon demo, without consuming checkpoint state or adding a second business-state layer.
5. Add broader Codex/ChatGPT adapters only where current platform capabilities genuinely support the existing tool/checkpoint semantics; never claim mid-generation interruption.
