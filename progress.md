# CallYourAgent progress

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. Agents can escalate important decisions without freezing unrelated scopes; owners can independently request callbacks for progress/questions/steering; human input is persisted as structured state and consumed only at explicit safe checkpoints rather than pretending to interrupt in-flight model generation.

The repository currently includes deterministic fake and production CALL-E providers, SQLite persistence, replayable/idempotent call attempts, polling/webhook convergence, branch-scoped blocking, owner decision persistence, durable per-run instruction queues, exact instruction acknowledgement, call policy/quiet hours/budgets, lifecycle recovery, fail-closed ambiguous/stalled handling, privacy-aware audit history, scoped HTTP authentication, a typed TypeScript client, stdio MCP, a deterministic end-to-end demo, operator console, and a single-instance persistent-volume Compose reference deployment.

This run closed the highest-value MCP/restart evidence gap left by the previous run: the **same external stdio MCP client process now remains connected while the Dockerized control plane restarts with a blocking owner-decision call raised by that MCP session still non-terminal**. After restart, that unchanged MCP session observes the same durable escalation as still calling, sees only the affected `release-approval` branch blocked while independent `documentation` work remains active, then consumes the single durable owner decision after trusted reconciliation and continues safely. The existing callback/restart/checkpoint path remains intact.

## Exact repo state inspected this run

The run started from `main` HEAD `90a255a4871df0358678021f0ed15e4e0711d384`.

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

- `.github/workflows/compose.yml` and its scoped-credential Docker/SQLite acceptance path;
- `tests/mcp-stdio-deployment-acceptance.ts`, which launches the actual built `dist/src/mcp-server.js` child through the official MCP stdio client;
- recent fake-provider restart/rehydration commits and the previous deployment-level in-flight call restart acceptance.

The previous run had already proven restart recovery for accepted non-terminal fake-provider decision and callback calls at the HTTP/Compose boundary. The remaining gap was that the stdio MCP acceptance restarted only **after** its owner decision had already resolved. Therefore it had not yet connected provider rehydration/restart behavior directly to the primary MCP agent integration path.

The automation/container environment itself could not clone GitHub directly because outbound DNS/network access to `github.com` was unavailable. Repository reads/writes and executable verification therefore used the connected GitHub integration and GitHub Actions; no unsupported local execution claim is made.

## Changes made this run

### Real stdio MCP now survives a restart while its own decision call is active

Updated `tests/mcp-stdio-deployment-acceptance.ts` in commit `22cb55a1eea793f696bd5bdbb826eb5806db5fbe` (`test: keep stdio MCP alive across active decision restart`).

The acceptance still launches the real built MCP server as an external stdio child with only the least-privilege agent bearer credential, while owner callback creation and provider reconciliation remain on separate owner/reconciler credentials.

The strengthened flow now:

1. connects one official MCP client to `dist/src/mcp-server.js`;
2. registers an agent and starts a run with independent current scope `documentation`;
3. raises a blocking `release-approval` owner decision through MCP;
4. verifies through MCP that the escalation is `calling` and its provider call is still `queued`/`in_progress`;
5. verifies through MCP checkpoint state that only `release-approval` is blocked and `documentation` remains the current independent scope;
6. restarts the Dockerized control plane **before** trusted reconciliation while leaving the same stdio MCP child/client alive;
7. after readiness returns, uses that unchanged MCP session to re-read the escalation lifecycle and checkpoint state;
8. proves the restored escalation is still active and the same single branch remains blocked;
9. reconciles the already-accepted original call using only the separate reconciler credential;
10. consumes the resulting durable structured owner decision through the same MCP agent session;
11. verifies the branch releases and the run continues;
12. verifies the audit timeline contains exactly one `owner_decision_recorded` event for that MCP-raised escalation.

The acceptance still also proves that the agent MCP credential cannot request an owner callback, that owner callback/reconciliation authority remains separate, that queued callback steering survives a later control-plane restart, and that steering is consumed and acknowledged exactly at a safe checkpoint.

No production domain/state-machine rewrite was needed for this increment. It converts existing restart-safe architecture into stronger primary-integration evidence.

## Verification performed

The substantive implementation commit `22cb55a1eea793f696bd5bdbb826eb5806db5fbe` passed every repository verification surface:

- CI run `34278228401` — **success**. Node 24 locked dependency install, TypeScript typecheck, build, and complete test suite passed: **94 tests, 94 passed, 0 failed**.
- Container run `34278228311` — **success**. Production image build and fake-provider runtime smoke passed.
- Compose deployment run `34278228408` — **success**. Every step passed, including generated least-privilege credentials, deployment boot/readiness, the strengthened external stdio MCP acceptance, the existing independent HTTP decision/callback in-flight restart scenarios, SQLite persistence, exact safe-checkpoint acknowledgement, and authorization boundaries.

Most importantly, the Compose step `Verify stdio MCP against deployed control plane` passed with `CYA_RESTART_CONTROL_PLANE=true`, so the real MCP child/client remained alive while its MCP-raised owner-decision call was still active across the Docker control-plane restart and continued using the same persistent run/escalation afterward.

`package.json` still has no separate lint script and no standalone migration/schema-check command. The available `npm run check` path covers TypeScript typechecking, build, and the Node test suite, while Container and Compose provide runtime/deployment verification.

No live CALL-E phone call was attempted or claimed.

## Architecture decisions made this run

1. The primary MCP integration should prove restart continuity while **its own external side effect remains non-terminal**, not merely reconnect to already-terminal durable state afterward.
2. The MCP adapter remains thin and stateless with respect to domain truth. Keeping the same MCP child alive across a backend restart works because it communicates through the stable HTTP/SDK boundary and durable SQLite control-plane state rather than owning run/escalation state itself.
3. Restart does not imply agent-wide blocking. The post-restart MCP checkpoint must still show `documentation` active while only `release-approval` is blocked.
4. Provider reconciliation authority remains separate from the agent MCP credential. The MCP process can request/consume owner decisions but does not gain `calls:reconcile` merely to make the deployment test convenient.
5. A provider/control-plane restart is not modeled as a fresh decision request. The original persisted escalation/call identity is restored and only one owner decision may be recorded.
6. Human decision consumption and owner steering remain checkpoint-safe semantics. Nothing in the restart acceptance claims interruption of an in-flight model/token generation.
7. The deterministic fake provider remains the correct transport for exhaustive restart acceptance. Production CALL-E behavior is not inferred from fake-provider success beyond the shared control-plane/idempotency contracts.

## CALL-E integration status

- **Fake provider:** deterministic, credential-free, restart-stable provider identities, provider-local rehydration for durable accepted `queued`/`in_progress` calls, optional observation-driven completion, duplicate prevention, and now deployment-proven directly through a long-lived external stdio MCP integration as well as HTTP/Compose flows.
- **Production CALL-E adapter:** implemented against the documented asynchronous Calls API with server-only `CALLE_API_KEY`, idempotent create, structured result schemas, persisted metadata/correlation, bounded requests, active observation, polling/webhook terminal convergence, exact-key ambiguous recovery, duplicate prevention, and fail-closed stalled handling. Fake-provider rehydration is not used for remote CALL-E calls.
- **Shared surfaces:** HTTP, TypeScript SDK, stdio MCP, lifecycle worker, and deployment workflows continue to share the same persistent `ControlPlane` state-machine semantics.
- **Live status:** no authorized real CALL-E phone call has been performed, so live provider success remains unverified.

## Current blockers / external prerequisites

No repository-development blocker prevents further useful work.

Live CALL-E verification still requires user-controlled prerequisites: a valid/authorized CALL-E credential, an authorized owner phone destination, and stable public HTTPS webhook ingress configured with the application-owned webhook capability token.

A true Claude Code host acceptance still requires running the documented MCP registration in a real Claude Code environment. The repository now proves the actual built stdio MCP process, official MCP client protocol, least-privilege authenticated HTTP boundary, SQLite durability, provider-call rehydration, control-plane restart while an MCP-raised decision remains active, durable decision consumption, callbacks, and safe-checkpoint steering. This must still not be described as evidence of an actual Claude Code host run.

## Highest-value next actions

1. Add a compact, executable Claude Code real-host acceptance/runbook fixture that uses the standard agent credential and existing stdio MCP tools, with exact expected tool sequence and explicit checkpoint semantics. Keep it honest about the remaining need for a real Claude Code host environment.
2. Strengthen the stdio restart acceptance with exact call-attempt audit correlation for its MCP-raised decision, proving one create/start/completion chain across restart in the same way the HTTP deployment acceptance already does.
3. Audit MCP child stderr, deployment logs, and restart diagnostics specifically for accidental bearer/webhook secret disclosure; add a regression assertion if any sensitive material could reach normal logs.
4. Consider documenting the provider-local `rehydrate` port explicitly in `docs/ARCHITECTURE.md`, clearly separating fake/local provider process reconstruction from remote CALL-E's durable provider-side call identity.
5. When the user-controlled CALL-E prerequisites are available, perform one tightly bounded live provider acceptance and record only observed behavior.
