# CallYourAgent progress

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. Agents can raise important owner decisions without freezing unrelated scopes; owners can independently request callbacks for progress/questions/steering; human input is persisted and consumed only at explicit safe checkpoints rather than pretending to interrupt in-flight model generation.

The repository includes SQLite persistence, deterministic fake and production CALL-E providers, replayable/idempotent call attempts, typed active-provider observations, polling/webhook convergence, scoped authenticated HTTP APIs, a typed TypeScript client, stdio MCP, branch-scoped blocking, call policy/quiet hours/budgets, privacy-aware audit history, bounded lifecycle recovery, fail-closed ambiguous/stalled handling, API abuse controls, graceful shutdown, bounded CALL-E HTTP requests, readiness/liveness surfaces, deterministic end-to-end and operator demos, a production Docker image, and a single-instance persistent-volume Compose deployment.

This run carried the escalation privacy split through the MCP integration layer and added a scoped end-to-end acceptance. MCP now exposes a distinct `get_escalation_lifecycle_status` observational tool over the existing privacy-safe HTTP/TypeScript contract, while `get_escalation_status` remains the sensitive decision-consumption tool for agent credentials carrying `decision:read`.

## Exact repo state inspected this run

The run started from `main` HEAD `2d4442eba6fa04087d6749ce002e937e5b520630`.

Before making changes, inspected the complete recursive repository tree and current architecture, including root configuration, GitHub Actions workflows, deployment assets, all documentation, source modules, and tests. Inspected recent commit history through the escalation-lifecycle privacy work. Checked repository issues and pull requests; there were no open issues or pull requests.

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

Also inspected the relevant implementation and verification surfaces, including `src/mcp-server.ts`, `src/client.ts`, `src/http-server.ts`, `src/call-provider.ts`, `src/escalation-view.ts`, `tests/mcp-server.test.ts`, `tests/owner-decision-authorization-http.test.ts`, `package.json`, and the existing HTTP privacy tests.

The previous run's highest-value next action was a scoped TypeScript/MCP acceptance proving that the standard agent credential can request a decision and later consume its durable answer, while owner/operator-style credentials can inspect the new lifecycle status but cannot retrieve the answer. Inspection confirmed that the HTTP and TypeScript SDK split already existed, but MCP exposed only the richer sensitive `get_escalation_status` tool.

## Changes made this run

### Privacy-safe MCP lifecycle tool

Added a distinct MCP tool:

```text
get_escalation_lifecycle_status
```

It delegates to `CallYourAgentClient.getEscalationLifecycleStatus`, which uses the existing `GET /v1/escalations/:id/status` HTTP contract. The tool therefore shares the same `EscalationLifecycleView` projection and `agent:read` authorization boundary rather than introducing MCP-specific business state.

The tool returns operational escalation lifecycle metadata suitable for owner/operator observation and does not return the escalation question/context, owner answer/structured result, provider ids, replayable call tasks, idempotency material, or recovery state.

The existing MCP `get_escalation_status` tool remains available for the agent that must consume the owner's decision. Its description now explicitly states that it requires both `agent:read` and `decision:read` and may return the structured owner decision.

### Scoped MCP/HTTP acceptance

Added `tests/mcp-scope-boundary.test.ts` using two real MCP clients over the stdio-compatible MCP server abstraction, both ultimately calling the same authenticated HTTP control plane.

The acceptance configures:

- an agent credential with `agent:read`, `agent:write`, `decision:read`, and `audit:read`;
- an owner credential with `agent:read`, `audit:read`, and `owner:callback`, deliberately without `decision:read`.

It proves the complete boundary:

1. the agent MCP client registers an agent, starts a run, and raises a blocking owner decision;
2. the owner MCP client can call `get_escalation_lifecycle_status` while the escalation is calling;
3. that safe lifecycle result contains neither the private question nor private context;
4. the same owner MCP credential receives a structured HTTP-derived `403` tool error from sensitive `get_escalation_status`, specifically requiring `decision:read`;
5. the deterministic fake provider completes the already-persisted decision call and normal control-plane reconciliation records the durable owner decision;
6. the owner MCP client can observe `resolved` plus `completed` call lifecycle without receiving the answer or structured decision;
7. the owner credential remains unable to call the sensitive result tool after resolution;
8. the standard agent MCP credential can call `get_escalation_status` and receive the durable answer and structured result it needs to resume safely.

The test does not create a demo-only mutation path. Provider completion is fixture setup inside the trusted test process, and decision reconciliation still goes through the normal control-plane state machine.

### Integration documentation

Updated `docs/INTEGRATIONS.md` to list and distinguish both MCP escalation-read tools.

The documentation now makes explicit that:

- `get_escalation_lifecycle_status` is the `agent:read` observational surface;
- `get_escalation_status` is the `agent:read` + `decision:read` decision-consumption surface;
- owner/operator integrations should not receive `decision:read` merely to observe lifecycle state;
- MCP tool discovery is not an authorization boundary, so the shared HTTP control plane remains authoritative even when a credential sees a tool it lacks permission to execute;
- Claude/Claude Code integrations should use the sensitive tool only when the agent actually needs to consume the durable answer at a safe work boundary.

## Verification performed

Repository-side network access is unavailable in the execution container, so no local clone/build was claimed. Executable verification was performed through the repository's existing GitHub Actions workflows.

The code/test-bearing state at commit `555c88415d5e65c65052cfe9ee0accc5a5aeb19f` passed all available verification paths:

- CI run `34218291161` — success. Node 24 setup, locked dependency install, TypeScript typecheck, build, and complete Node test suite passed, including the new scoped MCP decision privacy acceptance.
- Container run `34218291164` — success. Production image build and deterministic fake-provider runtime smoke passed.
- Compose deployment run `34218291237` — success. Compose validation, fake-provider boot/health, durable API-state creation, named-volume restart, post-restart persistence verification, and cleanup passed.

Implementation/documentation commits in this run:

- `b2bbe19e025986dc9d622ffb94cdd2f1db0bb1ec` — `feat: expose privacy-safe escalation lifecycle through MCP`
- `555c88415d5e65c65052cfe9ee0accc5a5aeb19f` — `test: prove scoped MCP decision privacy boundary`
- `3379452db2a62f5c0b4fd9e7ceb800ee07a5d86a` — `docs: document scoped MCP escalation reads`

`package.json` has no separate lint script and no standalone migration/schema-check command. The available executable verification remains CI typecheck/build/test plus Container and Compose deployment workflows.

No live CALL-E phone call was attempted or claimed.

## Architecture decisions made this run

1. MCP should expose both lifecycle observation and decision consumption because they have materially different privacy/authorization requirements.
2. `get_escalation_lifecycle_status` must reuse the existing HTTP/SDK privacy projection rather than introduce an MCP-specific reduced object that could drift over time.
3. `get_escalation_status` remains the agent's durable decision-consumption path; it is not appropriate for owner/operator observation because it may contain the human answer and structured result.
4. MCP tool discovery is not itself an authorization mechanism. Keeping authorization authoritative at the HTTP control-plane boundary preserves one permission model for MCP, TypeScript SDK, and custom clients. A credential may discover a tool it cannot execute and should receive a clear scoped error rather than a weaker duplicate authorization implementation in MCP.
5. Owner/operator credentials may observe lifecycle with `agent:read` but do not receive `decision:read` simply for UI or monitoring convenience.
6. Branch-scoped blocking, decision persistence, callback steering, CALL-E reconciliation, and safe-checkpoint semantics were not changed.
7. Human steering still becomes durable queued state and is consumed only at explicit safe checkpoints; no mid-generation interruption capability is claimed.

## CALL-E integration status

- Fake provider: deterministic and tested for decisions, callbacks, branch-scoped blocking, durable steering, idempotency, ambiguous recovery, active-state progress, stale downgrade rejection, bounded stale detection, restart durability, auditability, HTTP/TypeScript/MCP integration, operator demos, credential boundaries, privacy-safe escalation lifecycle reads, and the new scoped MCP decision-consumption boundary.
- Production CALL-E adapter: implemented with server-only `CALLE_API_KEY`, idempotent create, structured result schemas, active-state observation, terminal polling/webhook convergence, bounded requests, exact-key ambiguous recovery, duplicate prevention, and fail-closed stalled handling.
- HTTP + TypeScript SDK + MCP continue to share the same control-plane services and durable state machine. MCP now mirrors the HTTP privacy split instead of forcing all escalation reads through the sensitive result endpoint.
- Live CALL-E success remains unverified; no real authorized phone call was made.

## Current blockers / external prerequisites

No repository-development blocker prevents further useful work.

Live CALL-E verification still requires user-controlled prerequisites: a valid/authorized CALL-E credential, authorized owner phone destination, and stable public HTTPS webhook ingress configured with the application-owned webhook capability token.

Real Claude Code host acceptance still requires running the documented stdio MCP workflow in an actual Claude Code environment. Repository-side MCP behavior is tested through the official MCP client/server packages and the real authenticated HTTP boundary; host acceptance must not be fabricated.

## Highest-value next actions

1. Audit and strengthen deployment/config examples for scoped `CYA_API_CREDENTIALS_JSON` so agent, owner, read-only operator, and reconciler tokens can be copied without accidentally granting `decision:read` or `calls:reconcile` to browser-facing surfaces.
2. Add a focused typed-SDK credential acceptance only if it adds a distinct regression guarantee beyond the new MCP test; avoid redundant tests that merely repeat the same HTTP authorization path.
3. Consider capability-aware MCP UX only as a presentation improvement. Do not move authorization out of the HTTP control plane or create platform-specific permission semantics.
4. When an actual Claude Code host is available, run the documented stdio MCP host acceptance path with the deterministic fake provider and verify tool discovery plus checkpoint behavior from the real host.
5. When user-only CALL-E prerequisites are available, perform one bounded live provider acceptance test and record only observed results.
