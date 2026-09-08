# CallYourAgent progress

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. Agents can raise important owner decisions without freezing unrelated scopes; owners can independently request callbacks for progress/questions/steering; human input is persisted and consumed only at explicit safe checkpoints rather than pretending to interrupt in-flight model generation.

The repository includes SQLite persistence, deterministic fake and production CALL-E providers, replayable/idempotent call attempts, polling/webhook convergence, scoped authenticated HTTP APIs, a typed TypeScript client, stdio MCP, branch-scoped blocking, call policy/quiet hours/budgets, privacy-aware audit history, bounded lifecycle recovery, fail-closed ambiguous/stalled handling, API abuse controls, graceful shutdown, bounded CALL-E HTTP requests, readiness/liveness surfaces, deterministic end-to-end and operator demos, a production Docker image, and a single-instance persistent-volume Compose deployment.

This run added a SQLite-backed HTTP acceptance that verifies the least-privilege read/owner/reconciler credential split and privacy-safe callback overview survive a real store close/reopen. It also proves callback idempotency mapping survives restart so retrying the same owner callback does not create another durable call attempt.

## Exact repo state inspected this run

Before making changes, inspected the complete recursive `main` tree at HEAD `ba6753da2e966b02519e860be217b8b86856d998`. The recursive Git tree reported `truncated: false` and covered root files, all GitHub workflows, deployment assets, every documentation file, every `src` file, and every test file.

Read `AGENTS.md`, this file, `README.md`, `docs/ARCHITECTURE.md`, `docs/INTEGRATIONS.md`, `docs/API_SECURITY.md`, `docs/CALL_POLICY.md`, `docs/DEPLOYMENT.md`, `docs/OPERATOR_CONSOLE.md`, and `deploy/README.md` in full before editing. Inspected recent commits through the operator callback-lifecycle HTTP acceptance. Checked repository issues and pull requests; there were no open issues and no open PRs.

Inspected the relevant implementation/test surfaces before changing anything: `src/http-server.ts`, `src/client.ts`, `src/mcp-server.ts`, `src/sqlite-store.ts`, `tests/run-overview-http.test.ts`, `tests/sqlite-store.test.ts`, `tests/operator-owner-credential.test.ts`, and `tests/operator-callback-lifecycle-http.test.ts`.

The previous run had already established the deterministic fake-provider callback lifecycle over the real owner HTTP boundary. The missing high-value durability gap was proving that the browser-safe read model and credential split remain correct after durable SQLite restart rather than only in an in-memory fixture.

## Changes made this run

### SQLite-backed owner callback HTTP restart acceptance

Added `tests/sqlite-owner-callback-http-restart.test.ts`.

The test uses the real `SqliteControlPlaneStore`, `ControlPlane`, HTTP server, typed client, deterministic `FakeCallProvider`, and four least-privilege credentials:

- agent: `agent:read`, `agent:write`, `audit:read`;
- operator-read: `agent:read`, `audit:read`;
- owner: `agent:read`, `audit:read`, `owner:callback`;
- reconciler: `calls:reconcile`.

It creates an agent/run over HTTP, requests an owner callback over the owner credential, completes the exact fake-provider call, reconciles it with the separate reconciler credential, and verifies one private steering instruction is durably queued.

It then closes the HTTP server and SQLite store, reopens the same database into a new `ControlPlane` and HTTP server, and proves:

- both read-only and owner credentials still see the same persisted run and latest completed callback through the privacy-safe overview;
- the overview exposes only `queuedInstructionCount` plus the narrow latest-callback projection, not callback prompt/task content or owner instruction text;
- the read credential still cannot request callbacks (`403`);
- the owner credential still cannot checkpoint/consume steering (`403`);
- the owner credential still cannot reconcile provider calls (`403`);
- replaying the same owner callback idempotency key after restart returns the same completed callback id;
- only one durable callback call attempt exists after the replay, proving the SQLite idempotency map prevents a duplicate phone side effect.

No production state machine or browser authorization rule was changed in this run.

Code/test commit made this run:

- `c4163dfd10c8d2e1b4fbfd12af821c8346ad378e` — `test: cover owner callback privacy across SQLite restart`

## Architecture decisions made this run

1. Persistence acceptance must cross the real HTTP boundary, not only inspect SQLite maps directly, because credential scopes and privacy-safe response shaping are part of the product contract.
2. The owner surface remains intentionally unable to consume instructions or reconcile calls. Those authorities stay with the agent and trusted backend/reconciler roles respectively.
3. Restart safety must include callback idempotency, not only data readability. A callback retry after process restart must resolve through the durable idempotency mapping and must not create another call attempt.
4. The operator overview remains a privacy-safe projection. Persisting richer replayable call state internally does not justify exposing callback tasks, prompts, transcripts, or instruction text to the browser.
5. Fake-provider completion remains deterministic and server-side. No live CALL-E behavior is inferred from this acceptance.
6. Human steering remains queued durable state consumed only at an explicit agent checkpoint; no mid-generation interruption semantics were added.

## Verification performed

The code/test-bearing commit `c4163dfd10c8d2e1b4fbfd12af821c8346ad378e` triggered all three repository verification workflows and all completed successfully:

- CI run `34182222410` — `completed` / `success`; checkout, Node 24 setup, locked dependency installation, repository typecheck/build/test command, and the full Node test suite passed including the new SQLite HTTP restart acceptance.
- Container run `34182222352` — `completed` / `success`; production image build and fake-provider runtime smoke test passed.
- Compose deployment run `34182222391` — `completed` / `success`; Compose validation, fake-provider deployment boot/health, durable API-state creation, named-volume restart, and post-restart API/audit persistence verification passed.

`package.json` has no separate lint script and no standalone migration/schema command. The repository's available verification path remains the CI typecheck/build/test flow plus Container and Compose deployment workflows.

No live CALL-E phone call was attempted or claimed.

## CALL-E integration status

- Fake provider: implemented and tested across owner decisions, callbacks, branch-scoped blocking, durable steering, exact acknowledgement, idempotency, lifecycle recovery, auditability, deterministic demos, HTTP/MCP integration, credential separation, branch-safe visualization, privacy-safe callback-status presentation, HTTP-boundary callback lifecycle acceptance, and now SQLite restart persistence for the owner/read credential split and callback idempotency.
- Production CALL-E adapter: implemented with server-only `CALLE_API_KEY`, idempotent create requests, structured outcomes, polling/webhook convergence, bounded requests, duplicate-call prevention, exact-key ambiguous replay, and fail-closed stalled handling.
- HTTP + TypeScript SDK + MCP: implemented over shared control-plane semantics. Operator remains a thin read/callback surface over the same backend.
- Live CALL-E success: unverified; no real authorized phone call was made.

## Current blockers / external prerequisites

No repository-development blocker currently prevents further useful work.

Live CALL-E verification still requires user-controlled prerequisites: a valid/authorized CALL-E credential, an authorized owner destination, and stable public HTTPS webhook ingress with the configured webhook capability token.

Real Claude Code host acceptance still requires running the documented stdio MCP registration/workflow in an actual Claude Code environment. Repository-side MCP behavior is tested, but host acceptance must not be invented.

## Highest-value next actions

1. Narrow owner-facing callback HTTP responses so `POST /v1/callbacks` does not return the persisted replayable `CallAttempt.request.task`/briefing to a browser-facing owner credential; define a stable minimal callback DTO and keep rich replay state server-side.
2. Review `GET /v1/callbacks/:id` for the same privacy boundary so an owner/read credential cannot simply recover the rich persisted phone task after creation. Preserve any richer representation only for trusted server-side/reconciler needs.
3. Update README and `docs/OPERATOR_CONSOLE.md` to explicitly call out the privacy-safe latest-callback status card and tested `queued -> completed -> steering queued -> steering acknowledged` fake-provider story.
4. Add focused coverage for a provider that truthfully returns `in_progress`, ensuring the same privacy-safe overview/operator read model projects that state without changing fake-provider semantics.
5. When an actual Claude Code host is available, run the documented stdio MCP host acceptance flow with the deterministic fake provider.
6. When user-only CALL-E prerequisites are available, perform a bounded live provider acceptance test and record only the observed result.
