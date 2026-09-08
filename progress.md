# CallYourAgent progress

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. Agents can raise important owner decisions without freezing unrelated scopes; owners can independently request callbacks for progress/questions/steering; human input is persisted and consumed only at explicit safe checkpoints rather than pretending to interrupt in-flight model generation.

The repository includes SQLite persistence, deterministic fake and production CALL-E providers, replayable/idempotent call attempts, polling/webhook convergence, scoped authenticated HTTP APIs, a typed TypeScript client, stdio MCP, branch-scoped blocking, call policy/quiet hours/budgets, privacy-aware audit history, bounded lifecycle recovery, fail-closed ambiguous/stalled handling, API abuse controls, graceful shutdown, bounded CALL-E HTTP requests, readiness/liveness surfaces, deterministic end-to-end and operator demos, a production Docker image, and a single-instance persistent-volume Compose deployment.

This run added a privacy-safe latest owner-callback status projection to the existing run overview and surfaced it in `/operator`. Judges can now watch the latest owner-requested callback move through queued/in-progress/completed or fail-closed states without the browser fetching the full persisted call task, callback prompt, provider transcript, owner instruction text, or reconciliation authority.

## Exact repo state inspected this run

Before making changes, inspected the complete recursive `main` tree at HEAD `4f6ea30ff99bd9c30b8236a385b6bacc2162ef6f`, covering root files, workflows, deploy assets, docs, `src`, and tests. Read `AGENTS.md`, this file, `README.md`, `docs/ARCHITECTURE.md`, `docs/INTEGRATIONS.md`, `docs/API_SECURITY.md`, `docs/CALL_POLICY.md`, `docs/DEPLOYMENT.md`, `docs/OPERATOR_CONSOLE.md`, and `deploy/README.md` in full before editing.

Inspected recent commits through the branch-safe operator visualization. Checked repository issues and pull requests; there were no open issues and no PRs. Inspected the relevant implementation surfaces: `src/operator-ui.ts`, `src/run-overview.ts`, `src/http-server.ts`, `src/control-plane.ts`, `src/domain.ts`, `tests/operator-ui.test.ts`, and `tests/run-overview.test.ts`.

Confirmed before changing code that `GET /v1/callbacks/:id` exposes the complete persisted `CallAttempt`, including the phone task, so using that route directly from the judge-facing browser would widen the current privacy surface. The safer increment was therefore to extend the already privacy-preserving run overview with a deliberately minimal callback projection.

## Changes made this run

### Privacy-safe callback status projection

Updated `src/run-overview.ts` with `latestOwnerCallback`, derived from the latest durable `owner_callback_requested` audit event and the linked call attempt. The projection contains only:

- call-attempt id;
- operational status;
- created timestamp;
- updated timestamp.

It intentionally excludes the persisted CALL-E task, provider metadata, callback prompt, agent briefing text, transcript/result content, and owner instructions.

The projection supports the existing call-attempt states `queued`, `in_progress`, `completed`, `failed`, `ambiguous`, and `stalled`. No new business state or state machine was added.

### Operator callback-status indicator

Updated `src/operator-ui.ts` with a **Latest owner callback** card driven only by `overview.latestOwnerCallback`. Auto-refresh now visibly reflects current status without calling reconciliation endpoints or fetching the full call attempt. Presentation distinguishes active states, completed state, and fail-closed ambiguous/stalled states while keeping reconciliation explicitly server-side.

A fresh browser-requested callback still uses the normal `POST /v1/callbacks` endpoint. The owner-scoped browser credential still lacks agent-write and `calls:reconcile` authority; the trusted demo process remains responsible for fake-provider completion/reconciliation and safe-checkpoint acknowledgement.

### Regression coverage

Updated `tests/run-overview.test.ts` to prove callback status is projected while sensitive callback task/prompt content is absent from serialized overview output.

Updated `tests/operator-ui.test.ts` to lock in the callback-status presentation and confirm it consumes `overview.latestOwnerCallback` rather than the full callback request object.

Code/test commits made this run:

- `083bcf332ac1eaa4c7ba445d5793d73012e3abc6` — `feat: expose privacy-safe callback status in run overview`
- `27ce1e77502127bb987e589795ba0690e5e0e718` — `test: cover privacy-safe callback overview projection`
- `438b45f4874168243e969020072036c43706c357` — `feat: show privacy-safe owner callback status`
- `8c7af852fc77993d5638f331f58e2a0054ea48a4` — `test: cover operator callback status projection`

## Architecture decisions made this run

1. The browser should not use `GET /v1/callbacks/:id` for status because that existing agent-facing route returns the replayable call request/task and is broader than the operator needs.
2. Callback status belongs in the existing privacy-safe run read model rather than in a browser-side state machine.
3. The projection exposes only operational state needed for an owner/operator UI and remains read-only under `agent:read`.
4. Ambiguous/stalled states are shown as fail-closed review states; the browser never offers a retry/reconcile control or invents a replacement phone call.
5. The owner callback flow still does not interrupt model generation. Any resulting steering continues to enter the durable instruction queue and is consumed only at a safe checkpoint.
6. No live CALL-E success or undocumented Claude/Codex/ChatGPT interruption capability is claimed.

## Verification performed

The code/test-bearing commit `8c7af852fc77993d5638f331f58e2a0054ea48a4` triggered all three repository workflows. CI run `34175423493` completed successfully, covering locked dependency installation, TypeScript typecheck, build, and the Node test suite. Compose deployment run `34175423480` and Container run `34175423498` were also triggered for the same commit; they were still running/queued when this progress entry was written, so no unsupported success claim is made here.

`package.json` has no separate lint script and no migration/schema command. The normal verification path remains typecheck/build/test via CI plus container and Compose deployment workflows.

No live CALL-E phone call was attempted or claimed.

## CALL-E integration status

- Fake provider: implemented and tested across owner decisions, callbacks, branch-scoped blocking, durable steering, exact acknowledgement, idempotency, lifecycle recovery, auditability, deterministic demos, HTTP/MCP integration, credential separation, branch-safe visualization, and now privacy-safe callback-status presentation.
- Production CALL-E adapter: implemented with server-only `CALLE_API_KEY`, idempotent create requests, structured outcomes, polling/webhook convergence, bounded requests, duplicate-call prevention, exact-key ambiguous replay, and fail-closed stalled handling.
- HTTP + TypeScript SDK + MCP: implemented over shared control-plane semantics. Operator remains a thin read/callback surface over the same backend.
- Live CALL-E success: unverified; no real authorized phone call was made.

## Current blockers / external prerequisites

No repository-development blocker currently prevents further useful work.

Live CALL-E verification still requires user-controlled prerequisites: a valid/authorized CALL-E credential, an authorized owner destination, and stable public HTTPS webhook ingress with the configured webhook capability token.

Real Claude Code host acceptance still requires running the documented stdio MCP registration/workflow in an actual Claude Code environment. Repository-side MCP behavior is tested, but host acceptance must not be invented.

## Highest-value next actions

1. Add deterministic acceptance coverage that drives the operator fixture through callback queued/in-progress/completed presentation states and validates the overview payload at each stage.
2. Update `docs/OPERATOR_CONSOLE.md` and README to explicitly mention the new privacy-safe callback-status card and that it does not fetch the full persisted call task.
3. Consider a small typed SDK read model for operator/run overview if broader external owner surfaces need the same privacy-safe projection.
4. Add a SQLite-backed HTTP acceptance for the owner/read credential split plus callback-status overview while preserving the supported one-instance topology.
5. When an actual Claude Code host is available, run the documented stdio MCP host acceptance flow with the deterministic fake provider.
6. When user-only CALL-E prerequisites are available, perform a bounded live provider acceptance test and record only the observed result.
