# CallYourAgent progress

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. Agents can raise important owner decisions without freezing unrelated scopes; owners can independently request callbacks for progress/questions/steering; human input is persisted and consumed only at explicit safe checkpoints rather than pretending to interrupt in-flight model generation.

The repository includes SQLite persistence, deterministic fake and production CALL-E providers, replayable/idempotent call attempts, typed active-provider observations, polling/webhook convergence, scoped authenticated HTTP APIs, a typed TypeScript client, stdio MCP, branch-scoped blocking, call policy/quiet hours/budgets, privacy-aware audit history, bounded lifecycle recovery, fail-closed ambiguous/stalled handling, API abuse controls, graceful shutdown, bounded CALL-E HTTP requests, readiness/liveness surfaces, deterministic end-to-end and operator demos, a production Docker image, and a single-instance persistent-volume Compose deployment.

This run closed the previously identified later-poll lifecycle gap: a phone call that is accepted as `queued` can now be observed later as genuinely `in_progress`, and the control plane durably records that progress without creating another phone side effect or letting repeated identical polls extend the stale-call timeout forever.

## Exact repo state inspected this run

Before making any change, inspected the complete recursive `main` Git tree at HEAD `62a456364ad09c0befbfa6773679a6fc838c9142`; GitHub reported `truncated: false`. The inspection covered root configuration, all GitHub Actions workflows, deployment assets, every documentation file, every source file, and every test file.

Inspected recent commits through the immediate-`in_progress` fake-provider work. Checked relevant repository issues and pull requests; there were no open issues and no open pull requests.

Read `AGENTS.md`, this file, `README.md`, `docs/ARCHITECTURE.md`, `docs/INTEGRATIONS.md`, `docs/API_SECURITY.md`, `docs/CALL_POLICY.md`, `docs/DEPLOYMENT.md`, `docs/OPERATOR_CONSOLE.md`, and `deploy/README.md` in full before editing.

Inspected the relevant implementation/tests before changing behavior: `src/call-provider.ts`, `src/calle-provider.ts`, `src/control-plane.ts`, `src/domain.ts`, `src/lifecycle.ts`, `tests/calle-provider.test.ts`, and `tests/lifecycle.test.ts`, plus the complete source/test listing from the recursive tree.

The prior run had explicitly identified the highest-value next action: stop collapsing later `queued` and `in_progress` provider reads into the same `null` result, persist a truthful `queued -> in_progress` transition, and ensure repeated polling cannot indefinitely refresh stale-call age.

## Changes made this run

### Typed provider observation contract

Added a provider observation model in `src/call-provider.ts`:

- `CallProvider.observe(providerCallId)` returns either an active `queued`/`in_progress` observation or a terminal `CallOutcome`;
- `getOutcome()` remains as a compatibility helper for integrations that only care about terminal evidence;
- active observations and terminal outcomes are discriminated by status, avoiding unsafe casts in reconciliation code.

The deterministic fake provider now stores its active state and exposes `progress(providerCallId)` so tests/demos can truthfully advance an already-created fake call from `queued` to `in_progress` without another create call. Its existing provider-side idempotency behavior is unchanged.

### Production CALL-E active-state observation

Updated `CalleCallProvider` so `GET /v1/calls/{call_id}` preserves CALL-E's documented active state:

- `queued` -> typed queued observation;
- `in_progress` -> typed in-progress observation;
- `completed`/`failed`/`canceled` -> existing provider-agnostic terminal outcome mapping.

`CALLE_API_KEY` remains server-side. No live CALL-E call was attempted.

### Durable `queued -> in_progress` transition

Updated `ControlPlane.reconcileEscalation` and `ControlPlane.reconcileCallback` to consume provider observations through the same shared domain service used by HTTP/MCP/runtime paths.

A new internal active-observation transition:

- validates that the observed provider call id matches the persisted attempt;
- persists only a genuine forward `queued -> in_progress` transition;
- writes one privacy-safe `call_attempt_progressed` audit event;
- refreshes `updatedAt` once when actual provider progress is learned;
- ignores repeated same-state observations without rewriting `updatedAt` or producing duplicate progress audit events;
- ignores a stale later `queued` observation for an already `in_progress` attempt rather than downgrading it;
- does not alter terminal polling/webhook convergence, which still uses the existing single terminal transition path.

Human-answer/instruction semantics are unchanged. Owner decisions remain durable state releasing only the relevant blocking scope, and callback steering remains queued until explicit safe-checkpoint acknowledgement.

### Timeout/idempotency regression coverage

Added `tests/provider-observation.test.ts`.

Coverage proves:

- the CALL-E adapter can distinguish later `queued` and `in_progress` reads instead of returning `null` for both;
- a fake callback created as `queued` can later advance to `in_progress` through provider observation;
- the transition updates durable status/timestamp exactly once and emits exactly one progress audit event;
- repeated `in_progress` reconciliation leaves `updatedAt` unchanged;
- lifecycle stale-call detection still marks the call `stalled` once the configured age is exceeded, proving polling cannot keep it alive forever.

### Documentation

Updated `docs/ARCHITECTURE.md` and `docs/CALL_POLICY.md` to document active observations, forward-only progress semantics, privacy-safe auditing, and the exact stale-timeout rule.

## Architecture decisions made this run

1. Provider reads are observations, not merely optional terminal outcomes. Active provider progress is first-class typed evidence.
2. `queued -> in_progress` is the only accepted active forward transition. Same-state polls are no-ops and stale provider regressions cannot downgrade local state.
3. A real progress transition may refresh the stale-call window once; an unchanged poll may not. This keeps timeout semantics truthful and bounded.
4. Active observation never creates a new provider side effect. Only the already-known provider call id is polled.
5. Terminal polling and webhooks continue converging through the same terminal state machine so decisions/instructions cannot be duplicated by different delivery mechanisms.
6. Provider observation ids are checked against persisted provider ids before state mutation.
7. Audit remains metadata-only: progress status/purpose/provider may be recorded, but callback prompts, decision answers, transcripts, and steering text are not copied into audit events.
8. Type safety is part of the contract. After CI exposed an overly broad status-union model, active and terminal observation states were made genuinely discriminated rather than papering over the problem with casts.

## Verification performed

The first code-bearing verification exposed TypeScript narrowing failures in the new observation union. CI run `34193138442` and the corresponding container path failed at typecheck. This was a genuine implementation defect and was not treated as success.

A first correction made terminal `CallOutcome` discriminated, but CI run `34193451354` still showed that `ActiveCallObservation` itself used a status union and therefore could not be excluded safely by TypeScript in the control-plane terminal branch. The active observation type was then corrected to a true discriminated union (`queued` vs `in_progress`) rather than using a cast.

The final code-bearing state `3d6b628ff22e2af2f84647488fe82ae5f7cd744e` passed all available repository verification paths:

- CI run `34193511353` / job `101956231730` — success. Locked dependency install, Node 24 TypeScript typecheck, build, and full Node test suite passed, including `provider-observation.test.ts`.
- Container run `34193511338` — success. Production image build and fake-provider runtime smoke passed.
- Compose deployment run `34193511316` / job `101956231572` — success. Compose validation, fake-provider boot/health, durable API-state creation, named-volume restart, post-restart state verification, and cleanup all passed.

`package.json` has no separate lint script and no standalone migration/schema-check command. The repository's available verification remains CI typecheck/build/test plus Container and Compose deployment workflows.

No live CALL-E phone call was attempted or claimed.

## CALL-E integration status

- Fake provider: deterministic and tested for decisions, callbacks, branch-scoped blocking, durable steering, idempotency, ambiguous recovery, immediate and later `in_progress` states, bounded stale detection, auditability, HTTP/MCP integration, operator demos, and persistence/restart behavior.
- Production CALL-E adapter: implemented with server-only `CALLE_API_KEY`, idempotent create, structured result schemas, create-time and later active-state observation, terminal polling/webhook convergence, bounded requests, exact-key ambiguous recovery, duplicate prevention, and fail-closed stalled handling.
- HTTP + TypeScript SDK + MCP: share the same control-plane services and durable state machine. No browser-side provider reconciliation or replay material was introduced.
- Live CALL-E success: unverified; no real authorized phone call was made.

## Current blockers / external prerequisites

No repository-development blocker prevents further useful work.

Live CALL-E verification still requires user-controlled prerequisites: a valid/authorized CALL-E credential, authorized owner phone destination, and stable public HTTPS webhook ingress configured with the application-owned webhook capability token.

Real Claude Code host acceptance still requires running the documented stdio MCP workflow in an actual Claude Code environment. Repository-side MCP behavior is tested; host acceptance must not be fabricated.

The execution environment used for this run could not clone GitHub directly because outbound DNS resolution to `github.com` was unavailable, so all executable verification was taken from the repository's GitHub Actions workflows rather than claiming local test execution.

## Highest-value next actions

1. Add restart/persistence acceptance for a durable call that has already advanced `queued -> in_progress`, proving the progress timestamp/status and progress audit survive SQLite close/reopen and still age into `stalled` correctly after restart.
2. Add a stale-provider-regression acceptance (`in_progress` locally, later provider read says `queued`) so the forward-only no-downgrade rule is locked explicitly rather than only by implementation.
3. Review owner-decision read authorization (`GET /v1/escalations/:id`) and document/test which credential roles are intentionally allowed to receive the decision answer/structured result.
4. When an actual Claude Code host is available, run the documented stdio MCP host acceptance path with the deterministic fake provider.
5. When user-only CALL-E prerequisites are available, perform one bounded live provider acceptance test and record only observed results.
