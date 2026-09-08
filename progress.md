# CallYourAgent progress

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. Agents can raise important owner decisions without freezing unrelated scopes; owners can independently request callbacks for progress/questions/steering; human input is persisted and consumed only at explicit safe checkpoints rather than pretending to interrupt in-flight model generation.

The repository includes SQLite persistence, deterministic fake and production CALL-E providers, replayable/idempotent call attempts, polling/webhook convergence, scoped authenticated HTTP APIs, a typed TypeScript client, stdio MCP, branch-scoped blocking, call policy/quiet hours/budgets, privacy-aware audit history, bounded lifecycle recovery, fail-closed ambiguous/stalled handling, API abuse controls, graceful shutdown, bounded CALL-E HTTP requests, readiness/liveness surfaces, deterministic end-to-end and operator demos, a production Docker image, and a single-instance persistent-volume Compose deployment.

This run completed a judge-facing branch-semantics visualization increment. `/operator` now gives a concise visual contrast between independent work continuing while another scope is owner-gated, and the post-decision state where no blocking scope remains and the run has resumed active work. The visualization is derived only from the existing privacy-safe run overview plus persisted audit events; it does not create browser-side business state or expose decision/instruction contents.

## Exact repo state inspected this run

Before making any changes, inspected the complete recursive `main` tree at HEAD `d1b58c784458377e5a014500d7b9cd782381f275`. The GitHub recursive tree response reported `truncated: false` and covered root files, GitHub Actions workflows, deployment assets, all documentation, every `src` file, and the complete tests directory.

Read `AGENTS.md` in full, this file in full, `README.md` in full, and every architecture/integration/operations document present before editing: `docs/ARCHITECTURE.md`, `docs/INTEGRATIONS.md`, `docs/API_SECURITY.md`, `docs/CALL_POLICY.md`, `docs/DEPLOYMENT.md`, `docs/OPERATOR_CONSOLE.md`, and `deploy/README.md`.

Inspected recent commits through the fresh owner-callback demo increment. Checked repository issues and pull requests; there were no open issues and no open PRs.

Inspected the implementation/test surfaces relevant to this increment, especially `src/operator-ui.ts`, `tests/operator-ui.test.ts`, `tests/audit-timeline.test.ts`, and the durable `AuditEvent` contract in `src/domain.ts`. Confirmed that the operator already consumed `GET /v1/runs/:runId/overview` and the metadata-only audit timeline, and that `owner_decision_recorded` is durable audit evidence that can be used for presentation without exposing the decision answer.

A direct local clone/test run was attempted before repository mutation, but this automation container still could not resolve `github.com`. Therefore no unsupported local execution result is claimed. Repository mutation used the connected GitHub API and verification used the repository's GitHub Actions workflows.

## Changes made this run

### Branch-safe execution visualization

Updated `src/operator-ui.ts` with a new privacy-safe **Branch-safe execution** card.

While an owner decision is pending and the current active scope is not one of the blocked scopes, the card now shows:

- the current independent scope as work that **kept running**;
- the owner-gated scope(s) separately as **waiting for owner judgment**;
- an explicit statement that only the owner-gated scope is blocked.

After an `owner_decision_recorded` audit event exists and the privacy-safe overview reports no unresolved blocking scopes, the card switches to a **Blocked branch resumed** state and reports the control-plane's current active scope. This is intentionally phrased from observable control-plane state: it does not claim hidden scheduler behavior or infer an in-flight model interruption.

The visualization uses only data already fetched for the operator page:

- `overview.run`;
- `overview.unresolvedBlockingScopes`;
- metadata-only `audit.events`.

It introduces no browser persistence, no second state machine, no additional API endpoint, no transcript/decision-answer exposure, and no owner-instruction text exposure.

Added responsive styling so the two branch lanes collapse cleanly on smaller screens.

### Regression coverage

Strengthened `tests/operator-ui.test.ts` to lock in the new semantics and privacy boundary. The static-shell test now verifies that the page contains the branch-safe execution presentation, uses the current overview plus the durable `owner_decision_recorded` event, distinguishes independent work from the owner-gated branch, and still does not contain configured secrets or `queuedInstructions` payloads.

Code/test commit:

- `e68a5803d45fd646a2799773434b39b498d05a7f` — `feat: visualize branch-safe execution in operator`

### README refresh

Updated `README.md` so the judge-facing `demo:operator` description reflects the current two-credential model, fresh owner callback flow, and new branch-safe execution visualization instead of describing only the earlier read-token stage.

Documentation commit:

- `f02cb722a02b73e980e2db633620cd38df0e9b45` — `docs: refresh operator demo story`

## Architecture decisions made this run

1. Judge-facing visualization must remain a projection of existing durable state, not a new demo state machine.
2. The current active scope and unresolved blocking scopes come only from the privacy-safe run overview.
3. The post-decision visual state may use the durable metadata-only `owner_decision_recorded` audit event as evidence that owner judgment occurred, but it must not expose or reconstruct the decision answer.
4. The card deliberately says that the run now reports a scope as active with no blocked scopes rather than pretending CallYourAgent can interrupt or inject into an in-flight model generation.
5. No token, CALL-E key, webhook secret, owner decision answer, callback transcript, or owner-instruction text is added to browser-visible state.
6. Existing HTTP authorization, callback credential separation, provider reconciliation authority, and safe-checkpoint acknowledgement semantics remain unchanged.
7. No live CALL-E success or undocumented Claude/Codex/ChatGPT interruption capability is claimed.

## Verification performed

The code/test-bearing commit `e68a5803d45fd646a2799773434b39b498d05a7f` triggered all three repository verification workflows and all completed successfully:

- CI run `34172058251` — `completed` / `success`; this path performs locked dependency installation and the repository `npm run check` path, covering TypeScript typecheck plus the build-backed Node test suite.
- Container run `34172058295` — `completed` / `success`; production image build and fake-provider runtime smoke verification passed.
- Compose deployment run `34172058373` — `completed` / `success`; the single-instance SQLite deployment/persistence restart verification passed.

`package.json` has no separate lint script and no migration/schema command. The available standard project scripts remain `build`, `typecheck`, `test`, and `check`; the CI path covers the relevant typecheck/build/test verification.

The local clone attempt failed before execution because the automation container could not resolve `github.com`; this is an environment limitation and is not represented as a repository test failure.

No live CALL-E phone call was attempted or claimed.

## CALL-E integration status

- Fake provider: implemented and tested across owner decisions, callbacks, branch-scoped blocking, durable steering, exact acknowledgement, idempotency, policy/lifecycle recovery, auditability, SQLite restart, deterministic product demo, MCP work-loop acceptance, privacy-safe run overview, operator visualization, one-command fixture, real HTTP-boundary fixture acceptance, complete seeded-state progression, least-privilege observational access, separately scoped owner-callback access, capability introspection, capability-aware operator controls, fresh browser-requested callback/reconciliation/checkpoint flow, and now explicit judge-facing branch-safe execution visualization.
- Production CALL-E adapter: implemented with server-only `CALLE_API_KEY`, provider idempotency, structured result handling, polling/webhook convergence, bounded HTTP requests, duplicate-call prevention, exact-key ambiguous replay, and fail-closed stalled handling.
- HTTP + TypeScript SDK + MCP: implemented over shared control-plane semantics. The operator remains a thin read/callback surface over those same contracts rather than a separate product backend.
- Live CALL-E success: unverified; no real authorized phone call was made.

## Current blockers / external prerequisites

No repository-development blocker currently prevents further useful work.

This automation environment cannot currently clone from `github.com` because outbound DNS resolution fails. GitHub Actions remain the external verification path for repository changes.

Live CALL-E verification still requires user-controlled prerequisites: a valid/authorized CALL-E credential, an authorized owner destination, and stable public HTTPS webhook ingress with the configured webhook capability token.

Real Claude Code host acceptance still requires running the documented stdio MCP registration/workflow in an actual Claude Code environment. Repository-side MCP behavior is CI-tested, but host acceptance must not be invented.

## Highest-value next actions

1. Add a privacy-safe callback-status indicator to `/operator` so a judge can see that a freshly requested owner callback is queued/in progress/completed without exposing transcript content or granting reconciliation authority.
2. Add a deterministic acceptance test that drives the operator fixture through both visual branch states and verifies the underlying overview/audit payloads match the presentation semantics.
3. Refresh `docs/OPERATOR_CONSOLE.md` and `docs/INTEGRATIONS.md` to explicitly describe the branch-safe execution card and current owner/read credential split if those docs drift from the README.
4. Consider a SQLite-backed HTTP acceptance for the owner credential split and operator read surfaces while preserving the supported one-instance topology and process-local limiter assumptions.
5. When an actual Claude Code host is available, run the documented stdio MCP host acceptance flow with the deterministic fake provider.
6. When the user-only CALL-E prerequisites are available, perform a bounded live provider acceptance test and record only the observed result.
