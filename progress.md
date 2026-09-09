# CallYourAgent progress

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. Agents can escalate important decisions without freezing unrelated scopes; owners can independently request callbacks for progress/questions/steering; human input is persisted as structured state and consumed only at explicit safe checkpoints rather than pretending to interrupt in-flight model generation.

The repository currently includes deterministic fake and production CALL-E providers, SQLite persistence, replayable/idempotent call attempts, polling/webhook convergence, branch-scoped blocking, owner decision persistence, durable per-run instruction queues, exact instruction acknowledgement, call policy/quiet hours/budgets, bounded lifecycle recovery, fail-closed ambiguous/stalled handling, privacy-aware audit history, scoped HTTP authentication, a typed TypeScript client, a real stdio MCP adapter, deterministic end-to-end/demo flows, an operator console, and a single-instance persistent-volume Compose reference deployment.

This run moved exact decision-call correlation into the strongest deployment acceptance. The full Docker + scoped-credential + real built stdio MCP path now derives the durable decision `callAttemptId` from the unique `owner_decision_recorded` audit event and proves that a control-plane restart while the MCP-raised phone call is active still results in exactly one ordered `call_attempt_created -> call_attempt_started -> call_attempt_completed` chain, with no fabricated ambiguous/failed state and no duplicate owner decision. Independent `documentation` work remains active while only `release-approval` is blocked.

## Exact repo state inspected this run

The run started from `main` HEAD `44114d49b6a0e406964cc277e86b97f51c36ca20`.

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

- `tests/mcp-stdio-deployment-acceptance.ts`, including the built stdio MCP child, official MCP client, agent/owner/reconciler credential split, branch-blocking decision, control-plane restart while the decision call is active, durable decision consumption, callback steering, safe checkpoint, and exact acknowledgement path;
- `tests/mcp-stdio-call-audit-restart.test.ts`, which already established exact call-attempt correlation across a real external stdio MCP process and an HTTP/SQLite restart in normal CI;
- recent commits covering stdio MCP restart survival, fake-provider rehydration, in-flight Compose recovery, decision-call audit correlation, and CALL-E error redaction.

The automation runtime still could not clone GitHub directly because outbound DNS/network access from the local container is unavailable (`Could not resolve host: github.com`). Repository reads/writes therefore used the connected GitHub integration, and executable verification used the repository's own GitHub Actions workflows. No unsupported local execution claim is made.

## Changes made this run

### Compose stdio MCP acceptance now proves exactly one physical/logical decision-call chain

Implemented in commit `393d14d7c8f091d344f921dc36462ec17506e0b7` (`test: correlate compose stdio decision call audit`).

Updated `tests/mcp-stdio-deployment-acceptance.ts` without changing production state-machine behavior.

After the existing Dockerized flow raises a branch-blocking owner decision through the real built `dist/src/mcp-server.js` process, restarts the control plane while that phone interaction is still active, reconciles the durable attempt, and consumes the owner decision, the acceptance now:

1. reads the durable audit timeline through the same MCP session;
2. requires exactly one `owner_decision_recorded` event for the MCP-raised escalation;
3. derives the exact durable `callAttemptId` from that decision event rather than guessing from escalation/provider identity;
4. filters every audit event for that exact phone interaction;
5. requires exactly one `call_attempt_created` event;
6. requires exactly one `call_attempt_started` event, proving provider rehydration/restart did not create another physical start;
7. requires exactly one `call_attempt_completed` event;
8. requires causal sequence ordering `created < started < completed` using the durable audit sequence;
9. requires zero `call_attempt_ambiguous` and `call_attempt_failed` events for the successfully restored interaction;
10. emits the correlated `decisionCallAttemptId` in the acceptance result for easier diagnosis.

The existing deployment assertions remain intact: the agent MCP credential cannot request owner callbacks; reconciliation remains on the separate reconciler credential; `documentation` continues while only `release-approval` is blocked; the branch releases only after the durable decision; owner callback steering becomes queued state; restart does not lose steering; the agent consumes it at a safe checkpoint; and repeated exact acknowledgement does not duplicate consumption state.

## Verification performed

The substantive implementation commit `393d14d7c8f091d344f921dc36462ec17506e0b7` passed every repository verification surface:

- CI run `34297526027` / check `102297260728` — **success**. The repository `check` job completed successfully, covering the locked dependency install, TypeScript typecheck, build, and Node test suite.
- Container run `34297526036` / `build-container` check `102297260574` — **success**. Production image build and deterministic fake-provider runtime smoke passed.
- Compose deployment run `34297526068` / `compose-smoke` check `102297260904` — **success**. The complete Docker/SQLite/scoped-credential acceptance passed with the new exact `callAttemptId` correlation assertions in the real stdio MCP deployment path.

`package.json` still has no separate lint script and no standalone migration/schema-check command. The repository's available `npm run check` path covers TypeScript typechecking, build, and Node tests; Container and Compose cover runtime/deployment verification.

No live CALL-E phone call was attempted or claimed.

## Architecture decisions made this run

1. The strongest deployment proof should correlate one logical phone interaction by durable `callAttemptId`, not by provider-local identity or escalation id alone.
2. A control-plane/provider restart may rehydrate an already-accepted fake call, but that reconstruction must never generate another durable `call_attempt_started` event.
3. Terminal reconciliation is retry-safe only if both the call completion and the resulting owner decision remain exactly-once; the Compose acceptance now checks both layers together.
4. Durable audit `sequence` is the correct causal-order primitive; timestamps alone are insufficient when multiple transitions can occur within one millisecond.
5. The stdio MCP adapter remains intentionally thin. The MCP child can stay alive while the persistent control plane restarts because authoritative run/call state remains in SQLite/control-plane storage.
6. Branch-scoped blocking remains orthogonal to transport/process restart: unrelated `documentation` work can continue while `release-approval` waits for owner judgment.
7. Deployment acceptance should fail if successful recovery silently passes through `ambiguous` or `failed`; those states represent materially different operational semantics.
8. Fake-provider/CI success is not evidence of live CALL-E success.

## CALL-E integration status

- **Fake provider:** deterministic, credential-free, restart-stable provider identities, provider-local rehydration for durable accepted `queued`/`in_progress` calls, optional observation-driven completion, duplicate prevention, and exact call-attempt audit-chain coverage across direct SQLite tests, external stdio MCP restart tests, and the full Compose deployment acceptance.
- **Production CALL-E adapter:** implemented against the asynchronous Calls API with server-only `CALLE_API_KEY`, stable idempotency, structured result schemas, bounded create/poll requests, persisted metadata/correlation, polling/webhook convergence, duplicate prevention, fail-closed ambiguous/stalled handling, and privacy-safe non-2xx error reporting.
- **Shared surfaces:** HTTP, TypeScript SDK, stdio MCP, lifecycle worker, and deployment workflows share the same persistent `ControlPlane` semantics rather than separate adapter-specific state machines.
- **Live status:** no authorized real CALL-E phone call has been performed, so live provider success remains unverified.

## Current blockers / external prerequisites

No repository-development blocker prevents further useful work.

Live CALL-E verification still requires user-controlled prerequisites: a valid/authorized CALL-E credential, an authorized owner phone destination, and stable public HTTPS webhook ingress configured with the application-owned webhook capability token.

A true Claude Code host acceptance still requires running the documented MCP registration in an actual Claude Code environment. The repository proves the actual built stdio MCP process with the official MCP client, scoped HTTP credentials, Docker/SQLite persistence, active-call restart recovery, exact call-attempt correlation, decision consumption, callback steering, and safe checkpoints; that must still not be described as evidence of an actual Claude Code host run.

## Highest-value next actions

1. Add a compact executable Claude Code real-host acceptance/runbook fixture that uses the standard agent credential and existing stdio command, defines the expected tool sequence and branch-safe semantics, and gives an operator an unambiguous pass/fail checklist without claiming it has already been run in Claude Code.
2. Audit MCP child stderr plus lifecycle/deployment diagnostics for accidental bearer-token, webhook-token, owner-phone, task-context, or instruction disclosure and add focused redaction regressions where useful.
3. Document fake-provider `rehydrate` behavior more explicitly in `docs/ARCHITECTURE.md`, clearly separating local deterministic provider reconstruction from production CALL-E's remote durable call identity.
4. Consider adding exact callback `callAttemptId` create/start/completion correlation to the same Compose stdio path, complementing the decision-call guarantee without conflating callback steering consumption with provider completion.
5. When the user-controlled CALL-E prerequisites are available, perform one tightly bounded live provider acceptance and record only observed behavior.
