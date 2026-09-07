# CallYourAgent progress

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. Agents can raise important owner decisions without freezing unrelated scopes; owners can independently request callbacks for progress/questions/steering; human input is persisted and consumed only at explicit safe checkpoints rather than pretending to interrupt in-flight model generation.

The repository includes SQLite persistence, deterministic fake and production CALL-E providers, replayable/idempotent call attempts, polling/webhook convergence, scoped authenticated HTTP APIs, a typed TypeScript client, stdio MCP, branch-scoped blocking, call policy/quiet hours/budgets, privacy-aware audit history, bounded lifecycle recovery, fail-closed ambiguous/stalled handling, API abuse controls, graceful shutdown, hard CALL-E HTTP deadlines, reproducible dependencies, readiness/liveness surfaces, deterministic end-to-end and operator demos, production Docker image, and single-instance persistent-volume Compose deployment.

This run improved the hackathon/operator experience without introducing another state layer. The existing durable audit events are now rendered with clear presentation-only causal stages so a judge can visually follow owner escalation, phone-call progress, recorded decision, owner callback, queued steering, and exact steering acknowledgement while all sensitive answers/transcripts/instruction text remain excluded from the browser-facing audit payload.

## Exact repo state inspected this run

Before making changes, inspected the complete recursive `main` tree at HEAD `a386ba3e521ba2741f78553bd5194cd22cc2ccfd`, including all source files, tests, workflows, deployment assets, and documentation paths.

Read `AGENTS.md`, this file, `README.md`, `docs/ARCHITECTURE.md`, `docs/INTEGRATIONS.md`, `docs/CALL_POLICY.md`, `docs/API_SECURITY.md`, `docs/DEPLOYMENT.md`, `docs/OPERATOR_CONSOLE.md`, and `deploy/README.md` in full before editing. Inspected recent commits through the real HTTP-boundary operator-demo acceptance work. Checked repository issues and pull requests; there were no open issues or PRs.

Inspected the implementation/test surfaces relevant to this increment: `src/operator-ui.ts`, `tests/operator-ui.test.ts`, `tests/audit-timeline.test.ts`, and `package.json`, including the privacy-safe overview contract and metadata-only durable audit semantics.

Repository mutation used the connected GitHub API and verification used GitHub Actions. The automation runtime could not clone GitHub directly because outbound DNS from the local container was unavailable, so no unexecuted local test result is claimed.

## Changes made this run

### Causal-stage operator timeline

Updated `src/operator-ui.ts` so the existing audit timeline is visually grouped into explicit presentation stages:

- **Needs owner** — escalation creation and policy defer/release events;
- **Phone call** — call-attempt creation/start/ambiguous/stalled/terminal and bounded recovery events;
- **Decision** — owner-decision recording or escalation expiry;
- **Callback** — owner callback request;
- **Steering queued** — durable owner instruction queued;
- **Steering acknowledged** — exact owner instruction consumption/acknowledgement;
- **Agent / system** — all other run/system events.

Each timeline card still displays the persisted event sequence, actor, raw audit event type, timestamp, and existing privacy-safe summary. The stage mapping lives only in the browser presentation and does not create, persist, or infer new business state.

Added distinct stage styling and an inline legend so the asynchronous human loop is visible immediately during a demo. The UI copy explicitly states that decision answers, callback transcripts, and owner instruction text are not exposed.

### Regression coverage

Updated `tests/operator-ui.test.ts` to verify the operator page:

1. still uses the authenticated privacy-safe overview contract;
2. still exposes only `queuedInstructionCount`, never `queuedInstructions`;
3. contains all six human-loop stage labels;
4. maps the key durable event types `owner_decision_recorded`, `owner_instruction_queued`, and `owner_instruction_consumed` into the presentation;
5. contains no configured API/webhook secrets;
6. explicitly documents that sensitive human content is not exposed;
7. keeps the protected overview endpoint authenticated.

### Documentation

Updated `docs/OPERATOR_CONSOLE.md` to document that stage labels are presentation-only groupings over persisted audit events, not a second state machine, and to explain the privacy boundary and manual demo flow.

Commits from this increment:

- `6d64c7ef8b0cc4232f805200a127093a33c84e83` — add causal stage rendering to the operator timeline.
- `106d9e5ed6323e51e4f1724e58e855fa0a012f16` — add operator causal-stage regression coverage.
- `d7923ce4d8180e92101a40b6034a05a54f149841` — document operator causal-stage semantics.

## Architecture decisions made this run

1. Causal stages are deliberately a browser projection over already-persisted audit events; no duplicate workflow state or derived backend state was introduced.
2. Raw audit event types remain visible beside the human-readable stage label so the demo is understandable without hiding the underlying control-plane semantics.
3. The operator continues consuming only the authenticated `RunOverview` and audit APIs; it does not gain instruction/checkpoint privileges or receive owner steering text.
4. The timeline does not infer a completed callback from presentation heuristics beyond the actual persisted audit events. It labels only the event types the control plane already recorded.
5. Unknown/future audit events fail safely into the neutral `Agent / system` presentation category instead of being misrepresented.
6. No Claude/Codex/ChatGPT mid-generation interruption capability is claimed, and fake-provider UI behavior is not treated as live CALL-E evidence.

## Verification performed

The code/test-bearing commit `106d9e5ed6323e51e4f1724e58e855fa0a012f16` triggered all repository workflows and all completed successfully:

- CI run `34145916910` — successful; locked dependency install, TypeScript typecheck, build, and the full Node test suite, including the updated operator-console regression.
- Container run `34145916916` — successful.
- Compose deployment run `34145916930` — successful.

The repository still has no separate lint script or migration command in `package.json`; the available standard verification remains `typecheck`, build/test via `check`, plus Container and Compose workflow checks.

No live CALL-E call was attempted or claimed.

## CALL-E integration status

- Fake provider: implemented and tested across owner decisions, callbacks, branch-scoped blocking, durable steering, exact acknowledgement, idempotency, policy/lifecycle recovery, auditability, SQLite restart, deterministic product demo, MCP work-loop acceptance, privacy-safe run overview, operator visualization, one-command fixture, real HTTP-boundary fixture acceptance, and now clear causal-stage presentation of the persisted human loop.
- Production CALL-E adapter: implemented with server-only `CALLE_API_KEY`, provider idempotency, structured result handling, polling/webhook convergence, bounded HTTP requests, duplicate-call prevention, exact-key ambiguous replay, and fail-closed stalled handling.
- HTTP + TypeScript SDK + MCP: implemented over shared control-plane semantics. The operator remains a thin read/callback surface over the same HTTP API rather than a second state engine.
- Live CALL-E success: unverified; no real authorized phone call was made.

## Current blockers / external prerequisites

No repository-development blocker currently prevents further useful work.

Live CALL-E verification still requires user-controlled prerequisites: a valid/authorized CALL-E credential, authorized owner destination, and stable public HTTPS webhook ingress with the configured webhook capability token.

Real Claude Code host acceptance still requires running the documented stdio MCP registration/workflow in an actual Claude Code environment. Repository-side MCP behavior is CI-tested, but host acceptance must not be invented.

## Highest-value next actions

1. Add a deterministic authenticated second-stage demo command/control that resolves the seeded blocking owner decision and then safely consumes/acknowledges the queued steering through the existing HTTP/control-plane contracts, so judges can watch the operator timeline advance end to end without manual API choreography.
2. Keep that second-stage action composition-only: it must use existing decision/callback/checkpoint/acknowledgement semantics and must not introduce a privileged demo-only mutation endpoint.
3. Consider splitting the demo launcher into least-privilege read and callback credentials while preserving the one-command local experience.
4. When an actual Claude Code host is available, run the documented stdio MCP host acceptance flow with the deterministic fake provider.
5. When the user-only CALL-E prerequisites are available, perform a bounded live provider acceptance test and record only the observed result.
