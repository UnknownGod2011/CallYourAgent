# CallYourAgent progress

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. Agents can raise important owner decisions without freezing unrelated scopes; owners can independently request callbacks for progress/questions/steering; human input is persisted and consumed only at explicit safe checkpoints rather than pretending to interrupt in-flight model generation.

The repository includes SQLite persistence, deterministic fake and production CALL-E providers, replayable/idempotent call attempts, typed active-provider observations, polling/webhook convergence, scoped authenticated HTTP APIs, a typed TypeScript client, stdio MCP, branch-scoped blocking, call policy/quiet hours/budgets, privacy-aware audit history, bounded lifecycle recovery, fail-closed ambiguous/stalled handling, API abuse controls, graceful shutdown, bounded CALL-E HTTP requests, readiness/liveness surfaces, deterministic end-to-end and operator demos, a production Docker image, and a single-instance persistent-volume Compose deployment.

This run closed the restart/persistence gap for provider progress: a call that has durably advanced `queued -> in_progress` is now explicitly proven to retain its status, meaningful progress timestamp, and progress audit event across SQLite close/reopen, while repeated post-restart polling still cannot refresh its age and the same attempt still becomes fail-closed `stalled` when its bounded timeout expires.

## Exact repo state inspected this run

Before making any change, inspected the complete recursive `main` Git tree at HEAD `500eb4ee70f9f7b8a212243ae21249f7698f6d28`; GitHub reported `truncated: false`. The inspection covered root configuration, all GitHub Actions workflows, deployment assets, every documentation file, every source file, and every test file.

Inspected recent commits through the typed provider-observation work. Checked relevant repository issues and pull requests; there were no open issues and no pull requests.

Read `AGENTS.md`, this file, `README.md`, `docs/ARCHITECTURE.md`, `docs/INTEGRATIONS.md`, `docs/API_SECURITY.md`, `docs/CALL_POLICY.md`, `docs/DEPLOYMENT.md`, `docs/OPERATOR_CONSOLE.md`, and `deploy/README.md` in full before editing.

Inspected the relevant implementation/tests before changing behavior: `src/call-provider.ts`, `src/lifecycle.ts`, `src/sqlite-store.ts`, `tests/provider-observation.test.ts`, `tests/sqlite-store.test.ts`, plus the complete source/test listing from the recursive tree.

The prior run had explicitly identified the highest-value next action: prove that a call already advanced from `queued` to `in_progress` retains that state and timeout anchor across SQLite process-style reopen and still ages into `stalled` correctly afterward.

## Changes made this run

### SQLite restart acceptance for active provider progress

Extended `tests/sqlite-store.test.ts` with a process-style restart acceptance using the real `SqliteControlPlaneStore`, `ControlPlane`, deterministic `FakeCallProvider`, a mutable clock, and the normal `LifecycleManager`.

The test now proves this sequence:

1. create an owner callback through the normal control-plane service with the provider initially reporting `queued`;
2. advance the already-created fake provider call to `in_progress` without creating another phone side effect;
3. reconcile the existing callback and persist `status = in_progress` plus the meaningful progress `updatedAt` timestamp;
4. verify exactly one privacy-safe `call_attempt_progressed` audit event exists;
5. close the SQLite store and reopen the same database, simulating process restart;
6. verify the `in_progress` status, progress timestamp, and exact persisted audit sequence survive reopen;
7. run lifecycle reconciliation after restart while the call is still under the configured age limit and prove an identical `in_progress` provider observation does not rewrite `updatedAt` or duplicate the progress audit event;
8. advance beyond the same original progress-based timeout anchor and prove lifecycle marks exactly that durable call `stalled`, records `stalledAt`, and emits exactly one `call_attempt_stalled` event.

No production code path needed modification: the existing SQLite map persistence and lifecycle semantics already satisfied the intended architecture. This run converts that assumption into an explicit regression guarantee.

## Architecture decisions made this run

1. The meaningful active-call timeout anchor is durable state. A genuine `queued -> in_progress` transition must survive process restart with the same `updatedAt` value rather than receiving a fresh window merely because the service restarted.
2. Restart is not provider progress. Reopening SQLite or observing the same active provider state must not refresh call age.
3. Audit causality is durable alongside state. The existing `call_attempt_progressed` event and its monotonic sequence survive reopen rather than being regenerated on the first post-restart poll.
4. Stale detection remains tied to the persisted meaningful-transition timestamp, so process restarts cannot indefinitely extend an accepted phone call's automatic polling lifetime.
5. The provider object is deliberately reused in this process-style test so the already-known provider call still exists while only the control-plane persistence layer is restarted; no new create call or idempotency key is introduced.
6. Human-answer/instruction semantics are unchanged: callback steering remains durable queued state consumed only at explicit safe checkpoints, and this test adds no mid-generation interruption behavior.

## Verification performed

Code/test commit: `742dc8a2fd2c4ae9c2afa6a1ab135233a2f870c7` (`test: persist provider progress across sqlite restart`).

All available repository verification paths passed on that code state:

- CI run `34197262189` / job `101967660038` — success. Node 24 setup, locked dependency install, TypeScript typecheck, build, and complete Node test suite passed, including the new SQLite in-progress restart acceptance.
- Container run `34197262216` / job `101967660047` — success. Production image build and deterministic fake-provider runtime smoke passed.
- Compose deployment run `34197262179` / job `101967660215` — success. Compose validation, fake-provider boot/health, durable API-state creation, named-volume restart, post-restart state verification, and cleanup all passed.

`package.json` has no separate lint script and no standalone migration/schema-check command. The repository's available verification remains CI typecheck/build/test plus Container and Compose deployment workflows.

No live CALL-E phone call was attempted or claimed.

## CALL-E integration status

- Fake provider: deterministic and tested for decisions, callbacks, branch-scoped blocking, durable steering, idempotency, ambiguous recovery, immediate and later `in_progress` states, bounded stale detection, provider-progress persistence across SQLite restart, auditability, HTTP/MCP integration, operator demos, and persistence/restart behavior.
- Production CALL-E adapter: implemented with server-only `CALLE_API_KEY`, idempotent create, structured result schemas, create-time and later active-state observation, terminal polling/webhook convergence, bounded requests, exact-key ambiguous recovery, duplicate prevention, and fail-closed stalled handling.
- HTTP + TypeScript SDK + MCP: share the same control-plane services and durable state machine. No browser-side provider reconciliation or replay material was introduced.
- Live CALL-E success: unverified; no real authorized phone call was made.

## Current blockers / external prerequisites

No repository-development blocker prevents further useful work.

Live CALL-E verification still requires user-controlled prerequisites: a valid/authorized CALL-E credential, authorized owner phone destination, and stable public HTTPS webhook ingress configured with the application-owned webhook capability token.

Real Claude Code host acceptance still requires running the documented stdio MCP workflow in an actual Claude Code environment. Repository-side MCP behavior is tested; host acceptance must not be fabricated.

Executable verification for this run was taken from the repository's GitHub Actions workflows. No local CALL-E or external-agent-host success was claimed.

## Highest-value next actions

1. Add an explicit stale-provider-regression acceptance where local state is already `in_progress` but a later provider observation says `queued`, proving the forward-only no-downgrade rule does not rewrite status/timestamp or duplicate audit across the control-plane boundary.
2. Review owner-decision read authorization (`GET /v1/escalations/:id`) and document/test which credential roles are intentionally allowed to receive the decision answer/structured result.
3. Consider adding deployment-path coverage for an active call attempt if the Compose fixture can do so without introducing test-only provider mutation APIs; keep the current domain restart acceptance as the authoritative provider-progress state-machine test.
4. When an actual Claude Code host is available, run the documented stdio MCP host acceptance path with the deterministic fake provider.
5. When user-only CALL-E prerequisites are available, perform one bounded live provider acceptance test and record only observed results.
