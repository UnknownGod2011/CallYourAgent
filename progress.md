# CallYourAgent progress

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. Agents can raise important owner decisions without freezing unrelated scopes; owners can independently request callbacks for progress/questions/steering; human input is persisted and consumed only at explicit safe checkpoints rather than pretending to interrupt in-flight model generation.

The repository includes SQLite persistence, deterministic fake and production CALL-E providers, replayable/idempotent call attempts, typed active-provider observations, polling/webhook convergence, scoped authenticated HTTP APIs, a typed TypeScript client, stdio MCP, branch-scoped blocking, call policy/quiet hours/budgets, privacy-aware audit history, bounded lifecycle recovery, fail-closed ambiguous/stalled handling, API abuse controls, graceful shutdown, bounded CALL-E HTTP requests, readiness/liveness surfaces, deterministic end-to-end and operator demos, a production Docker image, and a single-instance persistent-volume Compose deployment.

This run hardened the owner-decision privacy boundary. The durable owner answer/structured result returned by `GET /v1/escalations/:id` is no longer implied by generic `agent:read`: the endpoint now additionally requires an explicit `decision:read` scope. The standard agent role receives it because the agent that raised an escalation must consume the durable answer and resume the affected scope; standard owner/operator-read credentials intentionally do not.

## Exact repo state inspected this run

The run started from `main` HEAD `c84980efd41d69bbb33290a5a2c2e3dd8df30961`. Inspected the complete recursive Git tree and current architecture, covering root configuration, all GitHub Actions workflows, deployment assets, every documentation path, source modules, and tests. Inspected recent commits through the stale-provider downgrade acceptance and checked repository issues and pull requests; there were no relevant open issues or pull requests.

Read `AGENTS.md`, this file, `README.md`, `docs/ARCHITECTURE.md`, `docs/INTEGRATIONS.md`, and `docs/API_SECURITY.md` before the authorization code change. During the same repository review, also read `docs/CALL_POLICY.md`, `docs/DEPLOYMENT.md`, `docs/OPERATOR_CONSOLE.md`, and `deploy/README.md` in full before the final documentation/progress changes. Inspected the relevant implementation and regression surfaces: `src/http-server.ts`, `src/server.ts`, `src/credential-roles.ts`, `src/domain.ts`, `src/call-provider.ts`, `tests/credential-roles.test.ts`, `tests/credential-capabilities-http.test.ts`, `tests/callback-privacy-http.test.ts`, `tests/http-server.test.ts`, `tests/client.test.ts`, and `package.json`.

The prior run's highest-value next action was specifically to review `GET /v1/escalations/:id` and decide which credential roles should be allowed to receive the owner's decision answer/structured result. Inspection confirmed that the route required only `agent:read`, while both the standard owner and operator-read role presets also carried `agent:read`; those browser/observational credentials could therefore retrieve the full durable owner answer despite not needing it.

## Changes made this run

### Explicit owner-decision read authorization

Added `decision:read` as a concrete HTTP API scope and wired it through runtime environment validation and authenticated capability discovery.

`GET /v1/escalations/:id` now requires both:

1. `agent:read`, for access to agent/escalation state; and
2. `decision:read`, for access to the persisted `OwnerDecision.answer` and optional structured result.

This is intentionally conjunctive. A credential with only `decision:read` is insufficient, so the new scope cannot become a standalone decision-data exfiltration capability.

Updated the standard credential roles:

- `agent` -> `agent:read`, `agent:write`, `decision:read`, `audit:read`;
- `operator-read` -> `agent:read`, `audit:read`;
- `owner` -> `agent:read`, `audit:read`, `owner:callback`;
- `reconciler` -> `calls:reconcile`.

The legacy trusted `*` credential remains backwards-compatible full access and capability discovery projects it as the six concrete scopes rather than returning `*`.

### HTTP privacy regression coverage

Added `tests/owner-decision-authorization-http.test.ts`. Through the real HTTP boundary it creates and resolves a blocking owner decision, then proves:

- a standard-style operator credential with `agent:read` cannot retrieve the answer;
- a standard-style owner callback credential with `agent:read` cannot retrieve the answer;
- a `decision:read`-only credential is also rejected because it lacks `agent:read`;
- an agent credential carrying both scopes receives the resolved durable answer and structured result needed to resume safely.

Updated credential-role and capability tests to lock the new least-privilege split. The new authorization test deliberately leaves branch/scope blocking, provider reconciliation, and checkpoint semantics untouched.

### Documentation alignment

Expanded `docs/API_SECURITY.md` with the exact `decision:read` contract, role rationale, dual-scope requirement, and migration note for custom scoped agent credentials that previously relied on `agent:read`/`agent:write` alone.

Updated `docs/DEPLOYMENT.md` so its recommended internet-exposed agent/MCP credential includes `decision:read`, while owner/operator read surfaces remain intentionally narrower.

## Verification performed

Primary security implementation commit: `91e8c4805ac7f7897731cf71007d5b5cd6768382` (`security: isolate owner decision read scope`).

Its first CI run `34208421320` failed in exactly one stale test expectation: `tests/client.test.ts` still expected the legacy wildcard capability projection to contain the previous five concrete scopes. Typecheck/build succeeded and the new owner-decision authorization acceptance itself passed. The production authorization boundary was not weakened.

Fixed that stale client capability assertion in commit `9e39a4c0976006c8d7f582d2f70440006830d645` (`test: include decision read in legacy capabilities`). All available verification paths then passed on that corrected code state:

- CI run `34208623075` — success. Node 24 setup, locked dependency install, TypeScript typecheck, build, and the complete Node test suite passed; the suite reported 77 tests with all passing, including the new owner-decision authorization acceptance.
- Container run `34208622923` — success. Production image build and deterministic fake-provider runtime smoke passed.
- Compose deployment run `34208622953` — success. Compose validation, fake-provider boot/health, durable API-state creation, named-volume restart, post-restart persistence verification, and cleanup passed.

Documentation-alignment commit: `57c20a3f1c29cb9c24dc372e5165a4e4e5a00750` (`docs: align agent credential decision scope`).

`package.json` has no separate lint script and no standalone migration/schema-check command. The repository's available executable verification remains CI typecheck/build/test plus Container and Compose deployment workflows.

No live CALL-E phone call was attempted or claimed.

## Architecture decisions made this run

1. A durable owner decision answer is agent-consumption state, not generic observational run metadata. `agent:read` therefore must not implicitly grant access to it.
2. `decision:read` is intentionally additive to `agent:read`; the sensitive route requires both rather than replacing the ordinary agent-state authorization boundary.
3. The standard agent role receives `decision:read` because the agent that raised the escalation must be able to consume the answer and safely resume only the affected scope.
4. Standard owner and read-only operator browser credentials intentionally do not receive `decision:read`. They can observe privacy-safe run/branch/audit state and request owner callbacks where authorized without retrieving the decision answer.
5. Provider reconciliation authority remains separate. `calls:reconcile` neither implies agent read access nor decision-answer access.
6. Legacy `*` remains supported for trusted/local compatibility, but scoped credentials are the recommended exposed-deployment path.
7. This security split changes only HTTP authorization. It does not alter CALL-E provider state, branch-scoped blocking, durable decision persistence, callback steering, or the rule that human instructions are consumed only at explicit safe checkpoints.

## CALL-E integration status

- Fake provider: deterministic and tested for decisions, callbacks, branch-scoped blocking, durable steering, idempotency, ambiguous recovery, immediate/later `in_progress`, repeated same-state polling, stale active-state downgrade rejection, bounded stale detection, provider-progress persistence across SQLite restart, auditability, HTTP/MCP integration, operator demos, persistence/restart behavior, and the newly hardened decision-read credential boundary.
- Production CALL-E adapter: implemented with server-only `CALLE_API_KEY`, idempotent create, structured result schemas, create-time and later active-state observation, terminal polling/webhook convergence, bounded requests, exact-key ambiguous recovery, duplicate prevention, and fail-closed stalled handling.
- HTTP + TypeScript SDK + MCP: share the same control-plane services and durable state machine. Scoped agent credentials that use `get_escalation_status`/`GET /v1/escalations/:id` now require `decision:read`; browser-facing owner/operator presets do not receive it.
- Live CALL-E success: unverified; no real authorized phone call was made.

## Current blockers / external prerequisites

No repository-development blocker prevents further useful work.

Live CALL-E verification still requires user-controlled prerequisites: a valid/authorized CALL-E credential, authorized owner phone destination, and stable public HTTPS webhook ingress configured with the application-owned webhook capability token.

Real Claude Code host acceptance still requires running the documented stdio MCP workflow in an actual Claude Code environment. Repository-side MCP behavior is tested; host acceptance must not be fabricated.

Executable verification for this run was taken from the repository's GitHub Actions workflows. No local CALL-E or external-agent-host success was claimed.

## Highest-value next actions

1. Consider splitting escalation observation into a privacy-safe escalation-status view and a separately authorized decision-result view, so owner/operator surfaces can inspect an individual escalation's lifecycle without ever being eligible to receive its answer; keep the current run overview as the safe browser default.
2. Add an explicit scoped MCP/TypeScript integration acceptance using the standard `agent` role to prove `request_owner_decision -> get_escalation_status` works with `decision:read`, while an owner/operator scoped client receives a clear authorization failure rather than widening its permissions.
3. Audit remaining deployment/config examples for custom `CYA_API_CREDENTIALS_JSON` snippets and ensure any agent credential intended to read decision results includes `decision:read` while owner/reconciler credentials remain narrow.
4. When an actual Claude Code host is available, run the documented stdio MCP host acceptance path with the deterministic fake provider.
5. When user-only CALL-E prerequisites are available, perform one bounded live provider acceptance test and record only observed results.
