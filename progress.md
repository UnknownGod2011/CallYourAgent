# CallYourAgent progress

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. Agents can escalate important decisions without freezing unrelated scopes; owners can independently request callbacks for progress/questions/steering; human input is persisted as structured state and consumed only at explicit safe checkpoints rather than pretending to interrupt in-flight model generation.

The repository currently includes deterministic fake and production CALL-E providers, SQLite persistence, replayable/idempotent call attempts, polling/webhook convergence, branch-scoped blocking, owner decision persistence, durable per-run instruction queues, exact instruction acknowledgement, call policy/quiet hours/budgets, bounded lifecycle recovery, fail-closed ambiguous/stalled handling, privacy-aware audit history, scoped HTTP authentication, a typed TypeScript client, real stdio MCP, a deterministic end-to-end demo, operator console, and a single-instance persistent-volume Compose reference deployment.

This run strengthened the exactly-once reliability contract around a branch-blocking owner-decision call that survives a process-style restart. A new SQLite regression correlates the decision call by its durable `callAttemptId` and proves that restart plus repeated reconciliation still produces exactly one `call_attempt_created -> call_attempt_started -> call_attempt_completed` audit chain and exactly one owner decision, while unrelated `documentation` work remains active and only the `release-approval` scope is blocked until the decision resolves.

## Exact repo state inspected this run

The run started from `main` HEAD `157adc1ee1708c0417f56b4d098484f1f5d726dd`.

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

- `tests/mcp-stdio-deployment-acceptance.ts`, including the real built stdio MCP child, official MCP client, scoped credentials, branch-blocking owner decision, control-plane restart, durable decision consumption, callback steering, safe checkpoint, and exact acknowledgement path;
- `src/domain.ts`, especially `AuditEvent.callAttemptId`, monotonic `sequence`, and the call-attempt/decision event types;
- `tests/audit-timeline.test.ts`, for existing metadata-only audit guarantees;
- `tests/fake-provider-rehydration.test.ts`, for durable fake-provider call restoration semantics;
- `.github/workflows/compose.yml`, including existing exact callback-call audit correlation and the full Docker/SQLite/stdin MCP restart acceptance;
- `package.json`, including the available `check`, typecheck, build, and test commands;
- recent commits for CALL-E error redaction, stdio MCP restart acceptance, fake-provider restart identity, and in-flight Compose restart recovery.

The previous run had already hardened production CALL-E non-2xx failures so arbitrary provider response bodies cannot leak sensitive phone/task/webhook material into application errors. The highest-value next gap recorded there was exact durable call-attempt correlation across restart for the primary decision path; this run implemented a focused executable regression for that invariant while preserving all existing deployment behavior.

The automation environment did not provide a persistent local checkout suitable for running the Node/Docker suite directly. Repository reads/writes used the connected GitHub integration and executable verification used the repository's GitHub Actions workflows. No unsupported local execution claim is made.

## Changes made this run

### Exact decision-call audit chain is now regression-tested across restart

Implemented in commit `adc41155300840ad438d307b4c249190421216ad` (`test: correlate decision call audit across restart`).

Added `tests/decision-call-audit-restart.test.ts`. The test deliberately exercises the same architectural invariants used by the deployed MCP path while keeping the assertion focused on durable control-plane state:

1. start a SQLite-backed control plane with the deterministic fake provider;
2. register an MCP-style agent and start a run whose active/current scope is `documentation`;
3. raise a blocking owner decision for `release-approval`;
4. capture the escalation's durable `callAttemptId`;
5. before restart, prove that exact attempt has one `call_attempt_created`, one `call_attempt_started`, and no terminal event yet;
6. prove `documentation` remains the current independent scope while only `release-approval` appears in `unresolvedBlockingScopes`;
7. close the durable store and reconstruct both the SQLite store and fake provider, modeling process restart;
8. reconcile the persisted decision call through normal provider rehydration and terminal reconciliation;
9. retry reconciliation deliberately;
10. prove the exact same `callAttemptId` has exactly one created/start/completed event chain, in causal sequence order;
11. prove no ambiguous/failed event was fabricated during restart recovery;
12. prove exactly one `owner_decision_recorded` exists for the escalation;
13. prove the blocked scope releases while the independent `documentation` scope remains current.

The regression guards against a subtle class of future failures where provider reconstruction or a retry could masquerade as a second phone create/start, duplicate a terminal transition, or duplicate the owner's durable decision even though the logical call should remain one real-world side effect.

No production state machine was changed because the existing implementation already satisfied the intended invariant. This run converts that behavior into an explicit durable contract that future adapter/provider changes must preserve.

## Verification performed

The substantive implementation commit `adc41155300840ad438d307b4c249190421216ad` passed every repository verification surface:

- CI run `34288656547` — **success**. Node `24.20.0`, locked dependency install, TypeScript typecheck, build, and complete Node test suite passed: **97 tests, 97 passed, 0 failed**. The log explicitly includes the new `decision call keeps one exact created-started-completed audit chain across restart and reconciliation retry` regression as passing.
- Container run `34288656591` — **success**. Production image build and deterministic fake-provider runtime smoke both passed.
- Compose deployment run `34288656546` — **success**. The complete Docker/SQLite/scoped-credential acceptance passed, including credential generation/capabilities, the actual built stdio MCP process against the deployed control plane, restart while an MCP-raised owner decision is still active, branch-specific release after reconciliation, owner-requested context-aware callback, restart while that callback remains active, exactly-once restored callback reconciliation, another restart after steering is durable, and exact safe-checkpoint acknowledgement after restart.

`package.json` still has no separate lint script and no standalone migration/schema-check command. The available `npm run check` path covers TypeScript typechecking, build, and the Node test suite; Container and Compose provide runtime/deployment verification.

No live CALL-E phone call was attempted or claimed.

## Architecture decisions made this run

1. `callAttemptId` is the correct durable correlation key for proving one logical real-world phone interaction across provider/process restart. Provider-local object identity must never be treated as the source of truth.
2. Fake-provider rehydration is reconstruction of already-accepted local provider state, not another provider create. Therefore restart must never emit a second `call_attempt_started` event for the same durable attempt.
3. Reconciliation is intentionally retryable. Repeating reconciliation after terminal evidence has already been applied must not create another terminal audit transition or another owner decision.
4. Audit history is part of the reliability contract, not merely presentation data. The causal sequence `created < started < completed` should remain stable enough to catch duplicate-side-effect regressions.
5. Branch-scoped blocking remains independent from provider recovery: `release-approval` can stay blocked while `documentation` continues, and restart/reconciliation must not broaden the block to the whole run.
6. This focused SQLite/domain regression complements, rather than replaces, the real stdio MCP + authenticated HTTP + Docker + persistent SQLite Compose acceptance. The deployment path remains the integration-level proof that those surfaces compose correctly.
7. No successful fake-provider, CI, container, or Compose acceptance is evidence that a real CALL-E phone call has succeeded.

## CALL-E integration status

- **Fake provider:** deterministic, credential-free, restart-stable provider identities, provider-local rehydration for durable accepted `queued`/`in_progress` calls, optional observation-driven completion, duplicate prevention, exact call-attempt audit-chain coverage across restart, and deployment-proven through both external stdio MCP and HTTP/Compose flows.
- **Production CALL-E adapter:** implemented against the asynchronous Calls API with server-only `CALLE_API_KEY`, stable idempotency, structured result schemas, bounded create/poll requests, persisted metadata/correlation, polling/webhook convergence, duplicate prevention, fail-closed ambiguous/stalled handling, and privacy-safe non-2xx error reporting that never copies arbitrary provider bodies.
- **Shared surfaces:** HTTP, TypeScript SDK, stdio MCP, lifecycle worker, and deployment workflows continue to share the same persistent `ControlPlane` state-machine semantics.
- **Live status:** no authorized real CALL-E phone call has been performed, so live provider success remains unverified.

## Current blockers / external prerequisites

No repository-development blocker prevents further useful work.

Live CALL-E verification still requires user-controlled prerequisites: a valid/authorized CALL-E credential, an authorized owner phone destination, and stable public HTTPS webhook ingress configured with the application-owned webhook capability token.

A true Claude Code host acceptance still requires running the documented MCP registration in a real Claude Code environment. The repository proves the actual built stdio MCP process, official MCP client protocol, least-privilege authenticated HTTP boundary, SQLite durability, control-plane restart while an MCP-raised decision remains active, durable decision consumption, callbacks, and safe-checkpoint steering. This must not be described as evidence of an actual Claude Code host run.

## Highest-value next actions

1. Extend `tests/mcp-stdio-deployment-acceptance.ts` itself with exact `callAttemptId` correlation for the MCP-raised blocking decision, proving the real stdio MCP -> SDK -> authenticated HTTP -> SQLite deployment path has one and only one `call_attempt_created`, `call_attempt_started`, and `call_attempt_completed` chain across restart. The focused regression added this run establishes the expected durable semantics and reduces risk for that deployment-level assertion.
2. Add a compact executable Claude Code real-host acceptance/runbook fixture using the standard agent credential, existing stdio MCP command, expected tool sequence, branch-safe semantics, and explicit checkpoint/acknowledgement behavior. Keep the remaining real-host prerequisite explicit.
3. Audit MCP child stderr and normal deployment/lifecycle diagnostic paths for accidental bearer/webhook/phone/task disclosure and add focused regression assertions where useful.
4. Document the provider-local fake `rehydrate` port more explicitly in `docs/ARCHITECTURE.md`, separating local fake-provider reconstruction from remote CALL-E's durable provider-side call identity.
5. When the user-controlled CALL-E prerequisites are available, perform one tightly bounded live provider acceptance and record only observed behavior.
