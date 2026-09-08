# CallYourAgent progress

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. Agents can raise important owner decisions without freezing unrelated scopes; owners can independently request callbacks for progress/questions/steering; human input is persisted and consumed only at explicit safe checkpoints rather than pretending to interrupt in-flight model generation.

The repository includes SQLite persistence, deterministic fake and production CALL-E providers, replayable/idempotent call attempts, typed active-provider observations, polling/webhook convergence, scoped authenticated HTTP APIs, a typed TypeScript client, stdio MCP, branch-scoped blocking, call policy/quiet hours/budgets, privacy-aware audit history, bounded lifecycle recovery, fail-closed ambiguous/stalled handling, API abuse controls, graceful shutdown, bounded CALL-E HTTP requests, readiness/liveness surfaces, deterministic end-to-end and operator demos, a production Docker image, and a single-instance persistent-volume Compose deployment.

This run split individual escalation observation from sensitive decision-result retrieval. Owner/operator credentials with ordinary `agent:read` can now inspect one escalation's privacy-safe lifecycle through `GET /v1/escalations/:id/status`, while the owner's durable answer/structured result remains available only through the existing `GET /v1/escalations/:id` route requiring both `agent:read` and `decision:read`.

## Exact repo state inspected this run

The run started from `main` HEAD `cc93bb0ad0e7b89b2f0a31f7ffbef0583c1d6821`.

Before making changes, inspected the complete recursive repository tree and current architecture, including root configuration, GitHub Actions workflows, deployment assets, documentation, source modules, and tests. Inspected the recent commit history through the owner-decision authorization hardening. Checked relevant repository issues and pull requests; there were no open issues or pull requests.

Read in full before implementation:

- `AGENTS.md`
- `progress.md`
- `README.md`
- `docs/ARCHITECTURE.md`
- `docs/INTEGRATIONS.md`
- `docs/API_SECURITY.md`
- `docs/CALL_POLICY.md`
- `docs/DEPLOYMENT.md`
- `docs/OPERATOR_CONSOLE.md`
- `deploy/README.md`

Also inspected the relevant implementation and verification surfaces, including `src/http-server.ts`, `src/domain.ts`, `src/client.ts`, `src/index.ts`, `tests/owner-decision-authorization-http.test.ts`, `package.json`, and `tsconfig.json`.

The previous run's highest-value next action was to separate privacy-safe individual escalation lifecycle observation from sensitive owner-decision retrieval. Inspection confirmed that the only individual escalation GET surface returned the full `Escalation` plus `OwnerDecision`, so owner/operator credentials correctly lost access when `decision:read` was introduced but had no narrow per-escalation alternative.

## Changes made this run

### Privacy-safe escalation lifecycle projection

Added `src/escalation-view.ts` with a typed `EscalationLifecycleView` and `getEscalationLifecycleView` projection.

The view intentionally exposes only operational lifecycle data:

- escalation id;
- run id;
- scope id;
- blocking flag;
- priority;
- escalation status;
- current call-attempt status when a call attempt exists;
- optional policy deferral reason;
- created/updated timestamps;
- optional expiry timestamp.

It deliberately omits the escalation question/context, escalation idempotency key, call-attempt id, decision id, provider call id/provider metadata, replayable phone task, owner decision answer, and structured owner result.

### Least-privilege HTTP split

Added:

```text
GET /v1/escalations/:id/status
```

The route requires only `agent:read` and returns the privacy-safe lifecycle projection. It does not mutate state and does not grant decision-result access.

The existing sensitive route remains unchanged in authority:

```text
GET /v1/escalations/:id
```

It still requires both `agent:read` and `decision:read` and remains the route an agent uses when it must consume the owner's durable answer to safely resume the affected branch.

### TypeScript SDK surface

Added `CallYourAgentClient.getEscalationLifecycleStatus(escalationId)` returning `EscalationLifecycleView`, and exported the new view from `src/index.ts`.

This keeps the HTTP and SDK contracts aligned rather than forcing platform adapters to hand-build a browser-only request.

### Privacy regression acceptance

Added `tests/escalation-lifecycle-privacy-http.test.ts` through the real authenticated HTTP boundary. It creates and resolves a blocking owner decision containing deliberately private question/context/answer material, then proves:

- an operator credential with `agent:read` can read the new lifecycle endpoint;
- the response exposes the resolved escalation and completed call lifecycle;
- the response does not contain the private question, context, owner answer, idempotency key, provider call id, call-attempt id, decision id, or decision object;
- that same operator credential still receives `403 decision:read` from the sensitive decision-result endpoint;
- an agent credential carrying `agent:read` + `decision:read` can still retrieve the durable owner answer.

### Documentation alignment

Updated `docs/API_SECURITY.md` to document the new lifecycle endpoint, `EscalationLifecycleView`, scope split, and the rule that observational credentials should use the safe route rather than being granted `decision:read` merely to inspect status.

## Verification performed

Repository-side network access is unavailable in the execution container, so no local clone/build was claimed. Executable verification was performed through the repository's existing GitHub Actions workflows.

The code/test state at commit `1ad34343671649839537a68b5c46c05522772d22` passed all available verification paths:

- CI run `34213240458` — success. Node 24 setup, locked dependency install, TypeScript typecheck, build, and complete Node test suite passed, including the new escalation lifecycle privacy acceptance.
- Container run `34213240430` — success. Production image build and deterministic fake-provider runtime smoke passed.
- Compose deployment run `34213240431` — success. Compose validation, fake-provider boot/health, durable API-state creation, named-volume restart, post-restart persistence verification, and cleanup passed.

Implementation commits in this run:

- `c19233dde6bdd184f9b0aeb64673d40c56189b06` — `feat: add privacy-safe escalation lifecycle view`
- `31959aac1b725d1cabc1139505f94719ea975123` — `feat: expose privacy-safe escalation lifecycle status`
- `552c80765d53f2ff40c8f69aedbdbc8cf6d6e29b` — `feat: add typed escalation lifecycle read`
- `d545f0857bb4206839d80a194f2fca427888fef4` — `feat: export escalation lifecycle view`
- `1ad34343671649839537a68b5c46c05522772d22` — `test: prove privacy-safe escalation lifecycle reads`
- `a388b2a87a958c76041cad4d5b7dce5eb2a01449` — `docs: document escalation lifecycle privacy view`

`package.json` has no separate lint script and no standalone migration/schema-check command. The available executable verification remains CI typecheck/build/test plus Container and Compose deployment workflows.

No live CALL-E phone call was attempted or claimed.

## Architecture decisions made this run

1. Individual escalation lifecycle state is observational metadata and may be exposed under `agent:read` when projected through a deliberately narrow view.
2. The owner's decision answer/structured result remains agent-consumption state and continues to require the stronger additive `decision:read` capability.
3. The safe lifecycle projection must not reuse the persisted `Escalation` object directly because that object contains question/context/idempotency/correlation fields that an operator does not need.
4. Provider call status is safe to expose as an operational enum, but provider call ids, replayable tasks, provider metadata, and recovery material remain server-side.
5. The new HTTP route and TypeScript SDK method share the same projection helper so privacy semantics cannot silently diverge between adapters.
6. No branch-blocking, owner-decision persistence, callback steering, CALL-E reconciliation, or safe-checkpoint semantics were changed.
7. Human steering still enters durable queued state and is consumed only at explicit safe checkpoints; no mid-generation interruption capability is claimed.

## CALL-E integration status

- Fake provider: deterministic and tested for decisions, callbacks, branch-scoped blocking, durable steering, idempotency, ambiguous recovery, active-state progress, stale downgrade rejection, bounded stale detection, restart durability, auditability, HTTP/MCP integration, operator demos, credential boundaries, and the new privacy-safe individual escalation lifecycle read.
- Production CALL-E adapter: implemented with server-only `CALLE_API_KEY`, idempotent create, structured result schemas, active-state observation, terminal polling/webhook convergence, bounded requests, exact-key ambiguous recovery, duplicate prevention, and fail-closed stalled handling.
- HTTP + TypeScript SDK + MCP continue to share the same control-plane services and durable state machine. The new lifecycle route is an observational projection only; sensitive decision consumption remains separately scoped.
- Live CALL-E success remains unverified; no real authorized phone call was made.

## Current blockers / external prerequisites

No repository-development blocker prevents further useful work.

Live CALL-E verification still requires user-controlled prerequisites: a valid/authorized CALL-E credential, authorized owner phone destination, and stable public HTTPS webhook ingress configured with the application-owned webhook capability token.

Real Claude Code host acceptance still requires running the documented stdio MCP workflow in an actual Claude Code environment. Repository-side MCP behavior is tested; host acceptance must not be fabricated.

## Highest-value next actions

1. Add scoped TypeScript/MCP integration acceptance proving the standard `agent` role can execute `request_owner_decision -> get_escalation_status` with `decision:read`, while an owner/operator scoped client can use the new lifecycle-status read but receives a clear authorization failure for the sensitive decision result.
2. Consider exposing the new privacy-safe escalation lifecycle read as a distinct read-only MCP tool only if it improves real operator/agent host workflows; do not replace the sensitive agent decision-consumption tool.
3. Audit deployment/config examples for custom credential JSON and ensure observational clients use `agent:read` without `decision:read`, while agent credentials that must consume owner decisions include both.
4. When an actual Claude Code host is available, run the documented stdio MCP host acceptance path with the deterministic fake provider.
5. When user-only CALL-E prerequisites are available, perform one bounded live provider acceptance test and record only observed results.
