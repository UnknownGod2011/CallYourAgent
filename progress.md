# CallYourAgent progress

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. Agents can raise important owner decisions without freezing unrelated scopes; owners can independently request callbacks for progress/questions/steering; human input is persisted and consumed only at explicit safe checkpoints rather than pretending to interrupt in-flight model generation.

The repository includes SQLite persistence, deterministic fake and production CALL-E providers, replayable/idempotent call attempts, polling/webhook convergence, scoped authenticated HTTP APIs, a typed TypeScript client, stdio MCP, branch-scoped blocking, call policy/quiet hours/budgets, privacy-aware audit history, bounded lifecycle recovery, fail-closed ambiguous/stalled handling, API abuse controls, graceful shutdown, hard CALL-E HTTP deadlines, reproducible dependencies, readiness/liveness surfaces, a deterministic end-to-end demo, operator console, production Docker image, and single-instance persistent-volume Compose deployment.

This run wired the operator console to the existing privacy-safe `RunOverview` contract so the hackathon surface now visibly distinguishes active independent work, unresolved blocked scopes, and pending owner steering count without receiving owner instruction text.

## Exact repo state inspected this run

Before making changes, inspected the complete recursive `main` tree at HEAD `1702e95d49fe7ee305a3e10588792f701c83b8b0`, including source, tests, workflows, package/deployment assets, and documentation paths. Also inspected the full tests directory listing to confirm current acceptance/regression coverage.

Read `AGENTS.md`, this file, `README.md`, `docs/ARCHITECTURE.md`, `docs/INTEGRATIONS.md`, and `docs/OPERATOR_CONSOLE.md` in full before editing. Inspected recent commits through the authenticated run-overview HTTP/client integration and checked repository issues and pull requests; there were no open issues or PRs.

Inspected the implementation/test surfaces relevant to this increment: `src/operator-ui.ts`, `src/run-overview.ts`, the authenticated overview route/client behavior established in the previous run, `tests/operator-ui.test.ts`, the test-suite layout, and `package.json` scripts.

The previously corrected run-overview commit `d4fae29cbbf9e51d8e1b0d4e9afb23e2896bdcc3` was rechecked before new changes; its CI, Container, and Compose workflows had all completed successfully.

Repository mutation used the connected GitHub API and verification used GitHub Actions; no local-only result was fabricated.

## Changes made this run

### Branch-safe operator overview

Updated `src/operator-ui.ts` so `/operator` now reads:

- `GET /v1/runs/:runId/overview` for the sanitized run projection;
- `GET /v1/runs/:runId/audit` for the existing durable causal timeline.

The console no longer needs the plain run-read route for its status card. The visible status area now shows:

- run state;
- active/current scope;
- unresolved blocking scope ids;
- pending owner-steering count;
- agent summary, update time, and audit-event count.

The UI also explains when the current scope is independent of one or more blocked scopes, making the core product invariant visible during a demo: one branch can be waiting on owner judgment while unrelated work remains active.

Crucially, the browser receives only `queuedInstructionCount`; owner instruction objects/text remain outside the overview contract and are still consumed only through the agent checkpoint/instruction path.

### Operator regression coverage

Strengthened `tests/operator-ui.test.ts` to verify that the static operator shell:

1. includes the Active scope, Blocked scopes, and Pending steering indicators;
2. calls the authenticated `/overview` endpoint;
3. references `queuedInstructionCount` rather than `queuedInstructions`;
4. still embeds no configured API token or webhook secret;
5. still leaves the overview API protected when no bearer credential is supplied.

### Documentation

Updated `docs/OPERATOR_CONSOLE.md` to describe the privacy-safe overview contract, the branch-safe demo behavior, the queued-count-only privacy rule, and the exact demo sequence for showing active independent work beside blocked scopes.

Code/documentation commits this run:

- `1d94716c8190700cd55fe1f6627228827af7ffbe` — show branch-safe run overview in operator console;
- `2d95eb49b7fbe9a8f5184f1a4e9de906ab5eb335` — cover operator branch-safe overview indicators;
- `36d36b11a1ad93cde2c99c9d9229dbc31c86abf0` — document the operator overview behavior.

## Architecture decisions made this run

1. `/operator` consumes the same sanitized `RunOverview` contract already used by the HTTP client instead of deriving blocked scopes or instruction state from audit events.
2. Operator status reads remain observational and non-consuming; viewing the console cannot acknowledge owner instructions.
3. Pending steering is represented as a count only. Instruction text remains an agent-side checkpoint concern and is not promoted into an operator/dashboard data surface.
4. The console explicitly separates the active/current scope from unresolved blocked scopes so branch-level non-blocking behavior is visible rather than merely described in documentation.
5. The audit timeline remains a separate durable causal view; the overview is current-state projection, not a second event log or state machine.
6. No new platform capability or mid-token interruption behavior is claimed.

## Verification performed

The final code/documentation state at commit `36d36b11a1ad93cde2c99c9d9229dbc31c86abf0` triggered all repository workflows and all completed successfully:

- CI run `34131122190` — successful; this workflow performs locked dependency installation, TypeScript typecheck, build, and the full Node test suite, including the strengthened operator-console regression.
- Compose deployment run `34131122300` — successful.
- Container run `34131122271` — successful.

The repository currently has no separate lint script or migration command in `package.json`; the available standard verification is `typecheck`, build/test via `check`, plus the Container and Compose workflow checks above.

No live CALL-E call was attempted or claimed.

## CALL-E integration status

- Fake provider: implemented and tested across owner decisions, callbacks, branch-scoped blocking, durable steering, exact acknowledgement, idempotency, policy/lifecycle recovery, auditability, SQLite restart, deterministic demo, MCP work-loop acceptance, privacy-safe run overview semantics, and now an operator visualization of those semantics.
- Production CALL-E adapter: implemented with server-only `CALLE_API_KEY`, provider idempotency, structured result handling, polling/webhook convergence, bounded HTTP requests, duplicate-call prevention, exact-key ambiguous replay, and fail-closed stalled handling.
- HTTP + TypeScript SDK + MCP: implemented over shared control-plane semantics. The operator console now consumes the same sanitized overview route rather than introducing another business-state path.
- Live CALL-E success: unverified; no real authorized phone call was made.

## Current blockers / external prerequisites

No repository-development blocker currently prevents further useful work.

Live CALL-E verification still requires user-controlled prerequisites: a valid/authorized CALL-E credential, authorized owner destination, and stable public HTTPS webhook ingress with the configured webhook capability token.

Real Claude Code host acceptance still requires running the documented stdio MCP registration/workflow in an actual Claude Code environment. Repository-side MCP behavior is CI-tested, but host acceptance must not be invented.

## Highest-value next actions

1. Add a small deterministic operator/demo fixture command or endpoint flow that seeds a realistic active-run scenario (one independent active scope, one blocked scope, pending owner steering) using only the fake provider and existing public contracts, so judges can reproduce the visual demo without manual API choreography.
2. Keep that fixture outside production business semantics: it should orchestrate existing APIs/services rather than add a demo-only state machine.
3. Add focused regression coverage proving the demo fixture is idempotent/reproducible and does not weaken authentication or expose instruction text.
4. When an actual Claude Code host is available, run the documented stdio MCP host acceptance flow with the deterministic fake provider.
5. When the user-only CALL-E prerequisites are available, perform a bounded live provider acceptance test and record only the observed result.
