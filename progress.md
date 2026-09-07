# CallYourAgent progress

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. Agents can raise important owner decisions without freezing unrelated scopes; owners can independently request callbacks for progress/questions/steering; human input is persisted and consumed only at explicit safe checkpoints rather than pretending to interrupt in-flight model generation.

The repository includes SQLite persistence, deterministic fake and production CALL-E providers, replayable/idempotent call attempts, polling/webhook convergence, scoped authenticated HTTP APIs, a typed TypeScript client, stdio MCP, branch-scoped blocking, call policy/quiet hours/budgets, privacy-aware audit history, bounded lifecycle recovery, fail-closed ambiguous/stalled handling, API abuse controls, graceful shutdown, hard CALL-E HTTP deadlines, readiness/liveness surfaces, deterministic end-to-end and operator demos, production Docker image, and single-instance persistent-volume Compose deployment.

This run completed the next owner -> agent demo/acceptance increment. A separately scoped owner browser credential can now create a genuinely new callback through the normal HTTP contract; the trusted deterministic demo process completes and reconciles that exact persisted callback; the resulting owner steering first becomes durable queued state and is only acknowledged in a later explicit safe-checkpoint step.

## Exact repo state inspected this run

Before making changes, inspected the complete recursive `main` tree at HEAD `001ef0b8f63d9230f30b369d12cd6275e9e477e9`. The GitHub recursive tree response reported `truncated: false` and covered root files, GitHub Actions workflows, deployment assets, all documentation, all `src` files, and the complete tests directory.

Read `AGENTS.md` in full, this file in full, `README.md` in full, and every architecture/integration/operations document present before editing: `docs/ARCHITECTURE.md`, `docs/INTEGRATIONS.md`, `docs/API_SECURITY.md`, `docs/CALL_POLICY.md`, `docs/DEPLOYMENT.md`, `docs/OPERATOR_CONSOLE.md`, and `deploy/README.md`.

Inspected recent commits through the capability-aware operator increment. Checked repository issues and pull requests; there were no open issues and no open PRs.

Inspected the implementation/test surfaces relevant to this increment, especially `src/operator-demo.ts`, `src/operator-ui.ts`, `src/control-plane.ts`, `src/http-server.ts`, `tests/operator-demo.test.ts`, `tests/operator-owner-credential.test.ts`, and `package.json`.

Confirmed the existing architecture before editing:

- owner callback creation already uses `POST /v1/callbacks` with `owner:callback`;
- callback task construction snapshots the active run summary/current scope;
- callback reconciliation is a trusted `calls:reconcile` operation and completed callbacks enqueue durable owner instructions;
- checkpoints are non-consuming unless explicitly requested and exact acknowledgement is a separate agent-write operation;
- the owner role has read/audit/callback authority but no agent-write or reconciliation authority;
- the in-memory demo store retains the same durable call-attempt model used by the control plane, allowing the trusted demo process to locate a newly persisted callback without inventing a browser mutation endpoint.

Repository mutation used the connected GitHub API. A direct local clone/test run was not available because the automation container could not resolve `github.com`; therefore no unsupported local execution result is claimed. Verification used the repository's GitHub Actions workflows.

## Changes made this run

### Fresh owner-triggered callback demo path

Updated `src/operator-demo.ts` so the deterministic operator fixture now supports a second, genuinely fresh owner -> agent interaction after the seeded decision flow.

Added `completeFreshOwnerCallback()` semantics:

1. the browser/owner first creates a callback using the existing authenticated `POST /v1/callbacks` route;
2. the trusted demo process discovers the newly persisted `owner_callback` attempt for the active run, explicitly excluding the fixture's seeded callback;
3. the deterministic fake provider completes that exact provider call;
4. normal `ControlPlane.reconcileCallback` applies the provider outcome;
5. exactly one new owner instruction is persisted as queued state;
6. the privacy-safe overview still exposes only the queued count, not the instruction text.

Added a separate `consumeFreshOwnerSteering()` step. It performs a non-consuming checkpoint, verifies that the exact fresh instruction ids are still queued, and acknowledges only those ids. This keeps callback completion and agent consumption as two distinct durable phases and does not pretend to interrupt an in-flight model/token generation.

The CLI `npm run demo:operator` now supports a three-stage judge flow through successive terminal Enter presses:

1. resolve the seeded blocking decision and safely acknowledge the seeded steering;
2. after a fresh owner callback is requested from `/operator`, complete/reconcile that exact callback and leave its new steering queued;
3. acknowledge only that fresh steering at a later safe checkpoint.

There is still no demo-only HTTP mutation endpoint. Browser credentials still do not receive `agent:write`, `calls:reconcile`, or any CALL-E server credential.

### HTTP/security acceptance coverage

Strengthened `tests/operator-owner-credential.test.ts` so the real HTTP boundary now proves:

- read-token capabilities are exactly `agent:read` + `audit:read`;
- owner-token capabilities are exactly `agent:read` + `audit:read` + `owner:callback`;
- the read token cannot create callbacks;
- the owner token can create a fresh callback after the run has resumed `production-deploy`;
- the resulting normal callback task contains the current scope and the owner's requested briefing prompt;
- the owner token can read the callback but cannot checkpoint or reconcile it;
- the trusted demo process reconciles the exact callback id created by the browser request;
- fresh steering increases the browser-visible pending count to one without leaking steering text;
- later safe-checkpoint acknowledgement uses exactly the newly queued instruction id and returns the pending count to zero;
- the durable audit timeline orders the fresh instruction's `owner_instruction_queued` event before its `owner_instruction_consumed` event.

Code/test commit:

- `0a9bec9467837f2d5eb55385e4fb7117461d0bc6` — `feat: complete fresh owner callback demo loop`

### Operator documentation

Updated `docs/OPERATOR_CONSOLE.md` with the capability-aware credential behavior and the full three-stage owner-callback demo choreography. The documentation explicitly states that fresh callback creation uses the normal HTTP contract, provider completion/reconciliation stays in the trusted process, the browser sees only pending-steering counts, and instruction acknowledgement happens later at a safe checkpoint.

Documentation commit:

- `57b6132300d695503af4b5a6819130258ae8bbba` — `docs: document fresh owner callback demo loop`

## Architecture decisions made this run

1. A judge-facing fresh callback must originate through the same `POST /v1/callbacks` contract used by real owner integrations; the demo must not synthesize it directly in browser-only state.
2. Provider completion/reconciliation remains trusted server/process work. Granting `calls:reconcile` to the owner browser merely for demo convenience would weaken the actual security model.
3. The trusted fixture may discover the newly persisted call attempt from the control-plane store because that is existing source-of-truth state; it does not create a second callback registry or demo state machine.
4. The fresh callback must snapshot the run after the blocked branch resumes, proving that owner callbacks are context-aware at request time rather than replaying seeded context.
5. Callback completion and steering consumption remain deliberately separate. A completed voice interaction creates durable queued state first; the agent acknowledges that state only at a later safe checkpoint.
6. The browser-facing run overview continues to expose only `queuedInstructionCount`, never owner instruction text.
7. The owner credential remains unable to checkpoint, mutate agent state, or reconcile provider calls even though it may request an owner callback.
8. No Claude/Codex/ChatGPT mid-token interruption capability is claimed, and deterministic fake-provider behavior is not treated as live CALL-E evidence.

## Verification performed

The final code + operator-documentation state `57b6132300d695503af4b5a6819130258ae8bbba` produced exactly three GitHub Actions checks, and all completed successfully:

- CI/check run `34168939474` — successful. This repository path runs locked dependency installation and `npm run check`; `check` runs TypeScript typechecking plus the build-backed full Node test suite.
- Container run `34168939507` — successful. Production image build and fake-provider runtime smoke verification passed.
- Compose deployment run `34168939463` — successful. The single-instance SQLite deployment/persistence restart verification passed.

GitHub's commit check-runs API reported all three check runs (`check`, `build-container`, and `compose-smoke`) as `completed` with conclusion `success` for `57b6132300d695503af4b5a6819130258ae8bbba`.

`package.json` has no separate lint script and no migration/schema command. Available standard project scripts include `build`, `typecheck`, `test`, and `check`; the CI `check` path covers typecheck + build-backed tests. Therefore no available lint or migration command was omitted.

No live CALL-E call was attempted or claimed.

## CALL-E integration status

- Fake provider: implemented and tested across owner decisions, callbacks, branch-scoped blocking, durable steering, exact acknowledgement, idempotency, policy/lifecycle recovery, auditability, SQLite restart, deterministic product demo, MCP work-loop acceptance, privacy-safe run overview, operator visualization, one-command fixture, real HTTP-boundary fixture acceptance, complete seeded-state progression, least-privilege observational access, separately scoped owner-callback access, capability introspection, capability-aware operator controls, and now a fresh browser-requested callback that is reconciled server-side and consumed only at a later safe checkpoint.
- Production CALL-E adapter: implemented with server-only `CALLE_API_KEY`, provider idempotency, structured result handling, polling/webhook convergence, bounded HTTP requests, duplicate-call prevention, exact-key ambiguous replay, and fail-closed stalled handling.
- HTTP + TypeScript SDK + MCP: implemented over shared control-plane semantics. The owner -> agent demo now exercises the normal HTTP callback route while keeping provider reconciliation and agent checkpoint authority separated exactly as the production scope model intends.
- Live CALL-E success: unverified; no real authorized phone call was made.

## Current blockers / external prerequisites

No repository-development blocker currently prevents further useful work.

This automation environment could not perform a local clone because outbound DNS resolution for `github.com` was unavailable. That is an execution-environment limitation rather than a repository blocker; GitHub Actions supplied the external typecheck/build/test/deployment verification for this run.

Live CALL-E verification still requires user-controlled prerequisites: a valid/authorized CALL-E credential, authorized owner destination, and stable public HTTPS webhook ingress with the configured webhook capability token.

Real Claude Code host acceptance still requires running the documented stdio MCP registration/workflow in an actual Claude Code environment. Repository-side MCP behavior is CI-tested, but host acceptance must not be invented.

## Highest-value next actions

1. Add a concise operator visualization card that explicitly contrasts “independent branch kept running” with “blocked branch resumed” using only the existing privacy-safe overview and audit state; the end-to-end fake-provider semantics are now strong enough for UI polish to be worthwhile.
2. Update `README.md` and `docs/INTEGRATIONS.md` so the one-command demo and typed `getCredentialCapabilities()` surface fully reflect the current owner/read credential split and fresh callback flow.
3. Add a deterministic browser-facing callback-status/pending-call indicator using the existing read-only callback/audit contracts if it improves judge clarity, without exposing transcripts or introducing another state source.
4. Consider a deployment-focused acceptance that exercises the owner credential split against the SQLite-backed HTTP runtime, while preserving one-instance topology and process-local limiter assumptions.
5. When an actual Claude Code host is available, run the documented stdio MCP host acceptance flow with the deterministic fake provider.
6. When the user-only CALL-E prerequisites are available, perform a bounded live provider acceptance test and record only the observed result.
