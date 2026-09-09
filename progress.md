# CallYourAgent progress

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. Agents can escalate important decisions without freezing unrelated scopes; owners can independently request callbacks for progress/questions/steering; human input is persisted as structured state and consumed only at explicit safe checkpoints rather than pretending to interrupt in-flight model generation.

The repository currently includes deterministic fake and production CALL-E providers, SQLite persistence, replayable/idempotent call attempts, polling/webhook convergence, branch-scoped blocking, owner decision persistence, durable per-run instruction queues, exact instruction acknowledgement, call policy/quiet hours/budgets, bounded lifecycle recovery, fail-closed ambiguous/stalled handling, privacy-aware audit history, scoped HTTP authentication, a typed TypeScript client, a real stdio MCP adapter, deterministic end-to-end/demo flows, an operator console, and a single-instance persistent-volume Compose reference deployment.

This run moved the exact decision-call restart invariant onto the primary MCP integration path in the normal test suite. A new regression launches the actual built `dist/src/mcp-server.js` child through the official MCP stdio client, keeps that same child alive while the SQLite-backed HTTP control plane and fake provider are torn down and reconstructed on the same port, then proves that the MCP-raised blocking decision resumes through exactly one durable `call_attempt_created -> call_attempt_started -> call_attempt_completed` chain and exactly one owner decision. Independent `documentation` work remains active throughout while only `release-approval` is blocked.

## Exact repo state inspected this run

The run started from `main` HEAD `939a4068b14ffc20803b0e520f6dac569cc8a288`.

Before making any change, inspected the complete recursive repository tree and current architecture, recent commits, and repository issues/pull requests. There were no open issues or pull requests.

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

Also inspected the relevant implementation/deployment surfaces, especially:

- `tests/mcp-stdio-deployment-acceptance.ts`, including the real built stdio MCP child, official MCP client, scoped credentials, branch-blocking decision, restart while the decision call is still active, durable decision consumption, callback steering, safe checkpoint, and exact acknowledgement path;
- `.github/workflows/compose.yml`, where the HTTP deployment path already correlates a durable decision call by `callAttemptId` and proves exactly one create/start/completion audit chain;
- `tests/decision-call-audit-restart.test.ts`, which established the same exactly-once invariant at the SQLite/domain layer;
- `tests/mcp-work-loop.test.ts`, for the existing Claude-style MCP work-loop semantics;
- `package.json`, including the available typecheck/build/test/check scripts.

Recent commits for stdio MCP restart survival, fake-provider rehydration, in-flight Compose recovery, exact decision-call audit correlation, and CALL-E error redaction were reviewed before selecting this increment.

The automation environment did not provide a persistent local checkout with working external network access, so repository reads/writes used the connected GitHub integration and executable verification used the repository's own GitHub Actions workflows. No unsupported local execution claim is made.

## Changes made this run

### Real built stdio MCP child now has an always-on restart/audit regression

Implemented in commit `a55d69282492784bfd7798accac18f0e4dd1901c` (`test: correlate stdio MCP call audit across restart`).

Added `tests/mcp-stdio-call-audit-restart.test.ts`.

The new test deliberately crosses the real adapter/process boundary rather than constructing the MCP server in memory:

1. create a temporary SQLite database and deterministic fake provider;
2. start the real HTTP control-plane adapter on localhost;
3. launch the actual compiled `dist/src/mcp-server.js` process with `StdioClientTransport` and the official MCP client;
4. use that stdio MCP process to register an agent, start a run whose current scope is `documentation`, and raise a blocking owner decision for `release-approval`;
5. prove `documentation` remains active while only `release-approval` is blocked;
6. stop the HTTP server and close SQLite, reconstruct the SQLite store, fake provider, and control plane, and bind the restarted HTTP server back to the same port while leaving the same MCP child/client alive;
7. use that unchanged MCP session to prove the escalation is still calling and the same branch remains blocked after restart;
8. reconcile the persisted call through the reconstructed control plane and deliberately retry reconciliation;
9. use the same MCP session to consume the single structured owner decision and verify the blocked scope releases;
10. retrieve the audit timeline through MCP, derive the durable `callAttemptId` from the unique `owner_decision_recorded` event, and prove exactly one `call_attempt_created`, one `call_attempt_started`, and one `call_attempt_completed` event exist for that logical phone interaction;
11. prove causal ordering `created < started < completed` and that restart did not fabricate ambiguous/failed state.

This complements the heavier Compose deployment acceptance. Compose still proves Docker, persistent volume, scoped agent/owner/operator/reconciler credentials, callbacks, and safe-checkpoint steering. The new test makes the actual stdio MCP process + authenticated HTTP + SQLite restart + exact audit invariant part of the normal CI suite on every commit.

No production state machine was changed because the existing behavior already satisfied the intended invariant.

## Verification performed

The substantive implementation commit `a55d69282492784bfd7798accac18f0e4dd1901c` passed every repository verification surface:

- CI run `34293470304` — **success**. Locked dependency install, TypeScript typecheck, build, and the complete Node test suite passed, including the new real stdio MCP child restart/audit regression.
- Container run `34293470271` — **success**. Production image build and deterministic fake-provider runtime smoke passed.
- Compose deployment run `34293470346` — **success**. The complete Docker/SQLite/scoped-credential acceptance passed, including the existing real stdio MCP deployment path, in-flight decision/callback restarts, branch-scoped continuation, durable steering, exact acknowledgement, and authorization boundaries.

`package.json` still has no separate lint script and no standalone migration/schema-check command. The repository's available `npm run check` path covers TypeScript typechecking, build, and Node tests; Container and Compose cover runtime/deployment verification.

No live CALL-E phone call was attempted or claimed.

## Architecture decisions made this run

1. Exactly-once phone-side-effect evidence should be verified across the same boundary real hosts use: a separate stdio MCP process talking through the typed HTTP client to the persistent control plane.
2. The MCP process is a thin adapter and should survive a control-plane restart without holding authoritative run/call state locally; SQLite/control-plane state remains the source of truth.
3. `callAttemptId` remains the durable correlation key for one logical phone interaction across process/provider reconstruction. Provider-local identity is not the source of truth.
4. Provider rehydration is reconstruction of an already-accepted fake call, not a new call start; therefore restart must not create a second `call_attempt_started` event.
5. Reconciliation is retryable and terminal convergence is idempotent; a retry must not duplicate either `call_attempt_completed` or `owner_decision_recorded`.
6. Branch-scoped blocking remains orthogonal to adapter/process restarts: `documentation` can continue while only `release-approval` waits for owner judgment.
7. The normal CI regression and the Compose acceptance are complementary: CI now gives a fast executable stdio-process reliability contract, while Compose remains the strongest deployment/scoped-auth proof.
8. Fake-provider/CI success is not evidence of live CALL-E success.

## CALL-E integration status

- **Fake provider:** deterministic, credential-free, restart-stable provider identities, provider-local rehydration for durable accepted `queued`/`in_progress` calls, optional observation-driven completion, duplicate prevention, and exact call-attempt audit-chain coverage across both direct SQLite and real external stdio MCP restart paths.
- **Production CALL-E adapter:** implemented against the asynchronous Calls API with server-only `CALLE_API_KEY`, stable idempotency, structured result schemas, bounded create/poll requests, persisted metadata/correlation, polling/webhook convergence, duplicate prevention, fail-closed ambiguous/stalled handling, and privacy-safe non-2xx error reporting.
- **Shared surfaces:** HTTP, TypeScript SDK, stdio MCP, lifecycle worker, and deployment workflows share the same persistent `ControlPlane` semantics rather than separate adapter-specific state machines.
- **Live status:** no authorized real CALL-E phone call has been performed, so live provider success remains unverified.

## Current blockers / external prerequisites

No repository-development blocker prevents further useful work.

Live CALL-E verification still requires user-controlled prerequisites: a valid/authorized CALL-E credential, an authorized owner phone destination, and stable public HTTPS webhook ingress configured with the application-owned webhook capability token.

A true Claude Code host acceptance still requires running the documented MCP registration in an actual Claude Code environment. The repository now proves the actual built stdio MCP process with the official MCP client across an HTTP/SQLite control-plane restart and exact call-attempt correlation, but that must not be described as evidence of an actual Claude Code host run.

## Highest-value next actions

1. Add the same exact `callAttemptId` create/start/completion assertions directly to `tests/mcp-stdio-deployment-acceptance.ts`, so the full Docker + scoped-credential stdio MCP acceptance itself explicitly checks the physical/logical decision-call chain rather than relying on the new normal-CI companion regression.
2. Add a compact executable Claude Code real-host acceptance/runbook fixture using the standard agent credential, existing stdio command, expected tool sequence, branch-safe semantics, and explicit checkpoint/acknowledgement behavior. Keep the real-host prerequisite explicit.
3. Audit MCP child stderr and lifecycle/deployment diagnostic paths for accidental bearer/webhook/phone/task disclosure and add focused regression assertions where useful.
4. Document fake-provider `rehydrate` behavior more explicitly in `docs/ARCHITECTURE.md`, separating local fake-provider reconstruction from production CALL-E's remote durable call identity.
5. When the user-controlled CALL-E prerequisites are available, perform one tightly bounded live provider acceptance and record only observed behavior.
