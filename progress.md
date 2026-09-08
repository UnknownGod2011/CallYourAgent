# CallYourAgent progress

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. Agents can raise important owner decisions without freezing unrelated scopes; owners can independently request callbacks for progress/questions/steering; human input is persisted and consumed only at explicit safe checkpoints rather than pretending to interrupt in-flight model generation.

The repository includes SQLite persistence, deterministic fake and production CALL-E providers, replayable/idempotent call attempts, polling/webhook convergence, scoped authenticated HTTP APIs, a typed TypeScript client, stdio MCP, branch-scoped blocking, call policy/quiet hours/budgets, privacy-aware audit history, bounded lifecycle recovery, fail-closed ambiguous/stalled handling, API abuse controls, graceful shutdown, readiness/liveness surfaces, deterministic demos, and a single-instance persistent-volume Compose deployment.

This run closed the remaining repository-side gap between in-process MCP tests and the real deployment boundary. The Compose workflow now launches the actual built `dist/src/mcp-server.js` child process over stdio with the standard agent credential and drives it through the official MCP client while the control plane runs separately in the production Docker image with SQLite. Provider reconciliation remains on the separate reconciler credential, and owner callback authority remains outside the agent MCP process.

## Exact repo state inspected this run

The run started from `main` HEAD `1757c9744ed18cee9f20767f036fff89421f6ae0`.

Before making any change, inspected the complete recursive repository tree and current architecture, including root configuration, all GitHub Actions workflows, deployment assets, source modules, scripts, docs, and the test inventory. Inspected recent commits through the prior Compose fake-provider acceptance. Checked open issues and pull requests; there were no open issues or pull requests.

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

Also inspected the relevant implementation/test/deployment surfaces before editing:

- `src/mcp-server.ts`
- `src/client.ts`
- `package.json`
- `tsconfig.json`
- `tests/mcp-server.test.ts`
- `tests/mcp-work-loop.test.ts`
- `.github/workflows/compose.yml`

The previous repository state already had strong MCP semantics tests, but they connected client/server with the SDK's in-memory transport. Separately, the Compose workflow proved the production Docker + authenticated HTTP + SQLite path. The missing acceptance was the actual stdio subprocess boundary a Claude Code-style host uses.

## Changes made this run

### Real stdio MCP deployment acceptance

Added `tests/mcp-stdio-deployment-acceptance.ts`, a reusable executable acceptance harness that uses `StdioClientTransport` to launch the built `dist/src/mcp-server.js` process as a real child process.

The MCP child receives only:

- `CYA_BASE_URL` pointing at the separately running control plane;
- `CYA_API_TOKEN` containing the standard least-privilege **agent** credential.

The owner and reconciler credentials are deliberately not placed in the MCP child's environment. They remain in the trusted acceptance harness solely to exercise the externally owned callback and provider-reconciliation responsibilities.

Through the actual stdio MCP protocol, the harness now proves:

1. tool discovery from the built MCP server;
2. agent registration;
3. run start and status reporting;
4. a blocking owner decision for `release-approval`;
5. a checkpoint showing `documentation` still active while only `release-approval` is blocked;
6. the agent-scoped MCP process is rejected with HTTP-derived `403` when it tries `request_owner_callback`;
7. the separately scoped reconciler progresses the decision through the real authenticated HTTP endpoint;
8. the MCP agent consumes the durable structured owner decision and sees the blocked scope released;
9. the owner credential independently requests a callback through the normal HTTP contract;
10. the reconciler progresses that callback;
11. the MCP agent sees the resulting steering only at a non-consuming safe checkpoint;
12. the MCP agent acknowledges exactly that instruction id;
13. a subsequent checkpoint proves the queue is empty;
14. the MCP audit tool sees the expected durable causal events.

This is the real `stdio MCP child -> TypeScript SDK -> authenticated HTTP -> ControlPlane -> SQLite` path. It does not add a second state machine, fake mutation endpoint, provider authority to the agent token, or any mid-token interruption claim.

### Compose workflow wiring

Updated `.github/workflows/compose.yml` to build the repository and run the stdio acceptance against the already-running fake-provider Compose deployment immediately after the generated credential capability checks.

The existing deployment acceptance remains intact afterward, including the separate HTTP branch-decision/callback flow and SQLite restart proof. The workflow therefore now covers both the host-facing MCP boundary and the persistent deployment boundary in one reference topology.

### Transient acceptance assertion correction

The first workflow execution exposed a test-only shape mistake in the new harness: `get_audit_timeline` returns the audit event array from `CallYourAgentClient`, while the new harness initially asserted an `{ events: [...] }` wrapper. The existing MCP/client implementation was correct.

Corrected the harness to treat the MCP tool result as `AuditEvent[]`. No production API, MCP tool, control-plane state transition, authorization rule, or persistence behavior was changed to satisfy the acceptance.

Commits made before this progress update:

- `95cd03e88df18ea354c9912f11e32dd021e98be8` — `test: add stdio MCP deployment acceptance harness`
- `bd8981149de8e93dff44fe8d80cac4ac2711278c` — `ci: exercise stdio MCP against compose control plane`
- `b2ac493c34abbaa7c3232604b1aad5cb0f85d504` — `test: fix stdio audit result assertion`

## Verification performed

The automation environment did not provide a local repository checkout suitable for running the repository's Node/Docker commands directly, so no local execution claim is made. Verification used the repository's GitHub Actions workflows.

The harness-only commit `95cd03e88df18ea354c9912f11e32dd021e98be8` passed all pre-existing verification surfaces, proving the new TypeScript source compiled and did not regress the test/container paths:

- CI run `34255011499` — **success**.
- Container run `34255011580` — **success**.
- Compose run `34255011809` — **success** (this was before the workflow had been wired to execute the new stdio harness).

After wiring the harness into Compose, commit `bd8981149de8e93dff44fe8d80cac4ac2711278c` had CI and Container success, but Compose run `34255159580` failed specifically in `Verify stdio MCP against deployed control plane`. The failure was `TypeError: Cannot read properties of undefined (reading 'map')` in the new audit assertion. The production server and prior steps were healthy; the new harness was corrected rather than changing production behavior.

The corrected substantive state at commit `b2ac493c34abbaa7c3232604b1aad5cb0f85d504` passed every available verification surface:

- CI run `34255332227` — **success**. Locked install, TypeScript typecheck, build, and complete test suite passed.
- Container run `34255332184` — **success**. Production image build/runtime smoke passed.
- Compose deployment run `34255332150` — **success**. The `Verify stdio MCP against deployed control plane` step passed, followed by the existing branch-decision, owner-callback, SQLite restart, safe-checkpoint exact-acknowledgement, and post-restart authorization checks.

`package.json` still has no separate lint script and no standalone migration/schema-check command. Available executable verification remains CI typecheck/build/test plus Container and Compose workflows.

No live CALL-E phone call was attempted or claimed.

## Architecture decisions made this run

1. The actual stdio subprocess is now a tested integration boundary, not merely an inferred consequence of in-memory MCP tests.
2. The MCP child receives only the normal agent credential. A host integration must not gain `owner:callback` or `calls:reconcile` merely because those operations exist elsewhere in the system.
3. MCP tool discovery remains separate from authorization. `request_owner_callback` can be advertised yet correctly returns a scoped tool error for the agent credential; the HTTP control plane remains authoritative.
4. Provider reconciliation stays outside the normal agent host process and uses the dedicated reconciler credential.
5. Owner-requested callback initiation stays an owner responsibility and is exercised through the existing HTTP boundary rather than widening the agent credential for test convenience.
6. Branch blocking remains scope-specific: the stdio acceptance proves `documentation` continues while `release-approval` waits.
7. Owner steering remains checkpoint-based. The stdio host sees queued instructions at a safe boundary and acknowledges exactly the incorporated id; nothing claims to interrupt an in-flight generation.
8. The first failing acceptance was fixed at the assertion layer because the existing typed client intentionally returns `AuditEvent[]`; no working production contract was rewritten to accommodate the test.
9. No CALL-E provider schema, idempotency logic, webhook semantics, persistence schema, call policy, timeout/recovery behavior, or operator privacy projection changed in this run.

## CALL-E integration status

- Fake provider: deterministic and tested across domain, HTTP, TypeScript SDK, in-process MCP, **real stdio MCP subprocess**, operator demo, scoped credentials, Compose deployment, branch-scoped decisions, callbacks, safe checkpoints, exact acknowledgement, ambiguity/recovery/stall handling, and SQLite restart durability.
- Production CALL-E adapter: implemented with server-only `CALLE_API_KEY`, idempotent create, structured results, active-state observation, polling/webhook terminal convergence, bounded HTTP requests, exact-key ambiguous recovery, duplicate prevention, and fail-closed stalled handling.
- HTTP, SDK, and MCP continue to share the same persistent control-plane semantics.
- Live CALL-E success remains unverified; no authorized real phone call was made.

## Current blockers / external prerequisites

No repository-development blocker prevents further useful work.

Live CALL-E verification still requires user-controlled prerequisites: a valid/authorized CALL-E credential, an authorized owner phone destination, and stable public HTTPS webhook ingress configured with the application-owned webhook capability token.

Actual Claude Code host acceptance still requires executing the documented `claude mcp add ...` registration in a real Claude Code environment. The repository now proves the same built stdio subprocess and protocol path using the official MCP client, but it must not be described as a real Claude Code host run.

## Highest-value next actions

1. Extend the stdio deployment acceptance across a control-plane restart: leave a steering instruction durably queued, restart the Compose service while the MCP host process remains external, then prove the host reconnects/continues at a later safe checkpoint and acknowledges the persisted instruction exactly once.
2. Add a small explicit reconnect/resume helper or documented host loop only if that acceptance exposes a real adapter ergonomics gap; do not add a second state machine.
3. When an actual Claude Code host is available, run the documented host registration and verify the same tools from the real host.
4. Continue auditing CI/deployment diagnostics for bearer/webhook secret exposure without widening credentials.
5. When the user-controlled CALL-E prerequisites are available, perform one bounded live provider acceptance and record only observed behavior.
