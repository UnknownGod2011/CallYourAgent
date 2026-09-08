# CallYourAgent progress

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. Agents can raise important owner decisions without freezing unrelated scopes; owners can independently request callbacks for progress/questions/steering; human input is persisted and consumed only at explicit safe checkpoints rather than pretending to interrupt in-flight model generation.

The repository includes SQLite persistence, deterministic fake and production CALL-E providers, replayable/idempotent call attempts, typed active-provider observations, polling/webhook convergence, scoped authenticated HTTP APIs, a typed TypeScript client, stdio MCP, branch-scoped blocking, call policy/quiet hours/budgets, privacy-aware audit history, bounded lifecycle recovery, fail-closed ambiguous/stalled handling, API abuse controls, graceful shutdown, bounded CALL-E HTTP requests, readiness/liveness surfaces, deterministic end-to-end and operator demos, a production Docker image, and a single-instance persistent-volume Compose deployment.

This run closed the stale-provider-observation regression gap: once a durable call has advanced from `queued` to `in_progress`, an out-of-order later provider observation reporting `queued` is now explicitly proven to be a no-op. It cannot downgrade local state, refresh the timeout anchor, duplicate progress audit events, or create another phone side effect; the original in-progress call still ages into the normal fail-closed `stalled` state.

## Exact repo state inspected this run

Before making any change, inspected the complete recursive `main` Git tree at HEAD `80a35ef5435b066048e3d75d27a9f3042abd82ea`; the recursive tree covered root configuration, GitHub Actions workflows, deployment assets, all documentation, all source files, and all test files.

Read `AGENTS.md`, this file, `README.md`, `docs/ARCHITECTURE.md`, `docs/INTEGRATIONS.md`, `docs/API_SECURITY.md`, `docs/CALL_POLICY.md`, `docs/DEPLOYMENT.md`, `docs/OPERATOR_CONSOLE.md`, and `deploy/README.md` in full before editing.

Inspected recent commits through the SQLite provider-progress restart acceptance. Checked relevant repository issues and pull requests; there were no open issues and no pull requests.

Inspected the relevant implementation/tests before changing behavior: `src/call-provider.ts`, the reconciliation/active-observation paths in `src/control-plane.ts`, `tests/provider-observation.test.ts`, and the repository verification scripts in `package.json`.

The prior run had explicitly identified the highest-value next action: prove that once local state is `in_progress`, a stale provider `queued` observation cannot rewind state, reset call age, or duplicate audit evidence.

## Changes made this run

### Stale provider active-state downgrade acceptance

Extended `tests/provider-observation.test.ts` with a purpose-built mutable observation provider implementing the real `CallProvider` interface. The provider starts one callback as `queued`, can later report `in_progress`, and can intentionally regress its observation back to stale `queued` without creating a second call.

The new acceptance proves this sequence:

1. create an owner callback through the normal `ControlPlane.requestOwnerCallback` path and verify exactly one provider create side effect;
2. advance the provider observation to `in_progress` and reconcile through the normal callback boundary;
3. persist the one genuine `queued -> in_progress` transition and its meaningful `updatedAt` timeout anchor;
4. verify exactly one `call_attempt_progressed` audit event;
5. advance time, make the provider report stale `queued`, and reconcile the same callback again;
6. verify local status remains `in_progress`, the timeout anchor is unchanged, no additional provider create occurs, and no duplicate progress audit event appears;
7. run lifecycle reconciliation before timeout and verify the call remains active with the original progress timestamp;
8. advance beyond the original progress-based age limit and verify the same attempt enters `stalled`, with exactly one stalled audit event and still no replacement phone side effect.

No production code path needed modification: `ControlPlane.applyActiveObservation` already implements the intended forward-only active-state rule. This run turns that rule into explicit regression coverage against an out-of-order provider response.

## Verification performed

Initial test commit: `6f24da13aab54153c652c398bfc8d1c90b05e991` (`test: reject stale provider active-state downgrade`).

The first CI run (`34202280848`) correctly failed only in the new test. The acceptance had incorrectly expected `updatedAt` to remain at the in-progress timestamp *after* lifecycle intentionally transitions the call to `stalled`. The production lifecycle correctly sets `updatedAt` when the meaningful stalled transition occurs. The test was fixed rather than changing production behavior.

Fix commit: `42b48931e9b91a4ba6f38c943201cbe5a8b705cf` (`fix: assert stale observation timeout anchor before stall`).

All available repository verification paths passed on that corrected code state:

- CI run `34202381230` / job `101983928818` — success. Node 24 setup, locked dependency install, TypeScript typecheck, build, and complete Node test suite passed, including the new stale-provider downgrade acceptance.
- Container run `34202381511` — success. Production image build and deterministic fake-provider runtime smoke passed.
- Compose deployment run `34202381389` — success. Compose validation, fake-provider boot/health, durable API-state creation, named-volume restart, post-restart persistence verification, and cleanup passed.

`package.json` has no separate lint script and no standalone migration/schema-check command. The repository's available verification remains CI typecheck/build/test plus Container and Compose deployment workflows.

No live CALL-E phone call was attempted or claimed.

## Architecture decisions made this run

1. Provider active-state observations are monotonic from the control plane's perspective: `queued -> in_progress` is meaningful forward progress, while `in_progress -> queued` is stale/out-of-order evidence and must be ignored.
2. Ignoring stale provider evidence means a strict state no-op: no status rewrite, no timeout-anchor refresh, no duplicate progress audit event, and no replacement provider create.
3. A provider observation is not itself authorization to extend call lifetime. Only a genuine meaningful transition updates the active-call age anchor.
4. The later `in_progress -> stalled` lifecycle transition is itself meaningful local state and therefore legitimately receives a new `updatedAt`; the invariant being protected is that stale `queued` cannot move that timeout anchor before the stall transition.
5. The stale-provider acceptance uses the public `CallProvider` interface and normal reconciliation path rather than mutating control-plane storage directly, so it protects the actual provider/control-plane boundary.
6. Human-answer/instruction semantics are unchanged: owner steering remains durable queued state consumed only at explicit safe checkpoints, with no claim of mid-generation interruption.

## CALL-E integration status

- Fake provider: deterministic and tested for decisions, callbacks, branch-scoped blocking, durable steering, idempotency, ambiguous recovery, immediate/later `in_progress`, repeated same-state polling, stale active-state downgrade rejection, bounded stale detection, provider-progress persistence across SQLite restart, auditability, HTTP/MCP integration, operator demos, and persistence/restart behavior.
- Production CALL-E adapter: implemented with server-only `CALLE_API_KEY`, idempotent create, structured result schemas, create-time and later active-state observation, terminal polling/webhook convergence, bounded requests, exact-key ambiguous recovery, duplicate prevention, and fail-closed stalled handling.
- HTTP + TypeScript SDK + MCP: share the same control-plane services and durable state machine. No browser-side provider reconciliation or replay material was introduced.
- Live CALL-E success: unverified; no real authorized phone call was made.

## Current blockers / external prerequisites

No repository-development blocker prevents further useful work.

Live CALL-E verification still requires user-controlled prerequisites: a valid/authorized CALL-E credential, authorized owner phone destination, and stable public HTTPS webhook ingress configured with the application-owned webhook capability token.

Real Claude Code host acceptance still requires running the documented stdio MCP workflow in an actual Claude Code environment. Repository-side MCP behavior is tested; host acceptance must not be fabricated.

Executable verification for this run was taken from the repository's GitHub Actions workflows. No local CALL-E or external-agent-host success was claimed.

## Highest-value next actions

1. Review owner-decision read authorization (`GET /v1/escalations/:id`) and document/test exactly which credential roles are intentionally allowed to receive the decision answer/structured result; keep owner-facing privacy boundaries least-privilege.
2. Add a stale-provider active-state acceptance for the agent -> owner decision path as well if the current shared helper coverage is judged insufficient, while avoiding duplicate tests of the same `applyActiveObservation` invariant.
3. Consider deployment-path coverage for an active call attempt if the Compose fixture can do so without introducing test-only provider mutation APIs; keep the domain restart tests authoritative for provider-progress semantics.
4. When an actual Claude Code host is available, run the documented stdio MCP host acceptance path with the deterministic fake provider.
5. When user-only CALL-E prerequisites are available, perform one bounded live provider acceptance test and record only observed results.
