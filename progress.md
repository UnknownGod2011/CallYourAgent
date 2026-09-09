# CallYourAgent progress

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. Agents can escalate important decisions without freezing unrelated scopes; owners can independently request callbacks for progress/questions/steering; human input is persisted as structured state and consumed only at explicit safe checkpoints rather than pretending to interrupt in-flight model generation.

The repository currently includes deterministic fake and production CALL-E providers, SQLite persistence, replayable/idempotent call attempts, polling/webhook convergence, branch-scoped blocking, owner decision persistence, durable per-run instruction queues, exact instruction acknowledgement, call policy/quiet hours/budgets, bounded lifecycle recovery, fail-closed ambiguous/stalled handling, privacy-aware audit history, scoped HTTP authentication, a typed TypeScript client, a real stdio MCP adapter, deterministic end-to-end/demo flows, an operator console, a Claude Code real-host acceptance runbook, and a single-instance persistent-volume Compose reference deployment.

This run improved the causal audit model for the owner -> agent callback path. Callback-originated `owner_instruction_queued` events now carry the originating durable `callAttemptId`, allowing a privacy-safe timeline to prove which exact phone interaction produced which exact queued steering item without copying the instruction text or callback transcript into audit metadata. A focused regression now proves one ordered callback chain from call creation through provider acceptance, owner callback request, provider completion, and durable instruction queuing.

## Exact repo state inspected this run

The run started from `main` HEAD `e8e9ea18bfaca188a6aa81351cce5a4bfa39ed0d`.

Before making any change, inspected the complete recursive repository tree and current architecture, recent commits, repository issues, and pull requests. There were no open issues or pull requests.

Read in full before implementation:

- `AGENTS.md`
- `progress.md`
- `README.md`
- `docs/ARCHITECTURE.md`
- `docs/INTEGRATIONS.md`
- `docs/API_SECURITY.md`
- `docs/CALL_POLICY.md`
- `docs/CLAUDE_CODE_ACCEPTANCE.md`
- `docs/DEPLOYMENT.md`
- `docs/OPERATOR_CONSOLE.md`
- `deploy/README.md`

Also inspected the relevant implementation/test/deployment surfaces, especially:

- `src/control-plane.ts`, including callback creation, reconciliation, terminal outcome application, instruction queuing, and audit references;
- `tests/audit-timeline.test.ts`;
- `.github/workflows/compose.yml`, including active callback restart recovery and exactly-once steering checks;
- the existing decision-call audit restart tests and prior MCP/Compose correlation commits;
- `package.json` and the available verification commands.

The automation runtime could not execute a local repository checkout, so repository reads/writes used the connected GitHub integration and executable verification used the repository's GitHub Actions workflows. No unsupported local execution claim is made.

## Changes made this run

### 1. Correlated callback steering to its durable phone attempt

Implemented in commit `2bd0e84b331d6da41386d40ccfaec8c36485d9ce` (`feat: correlate callback steering audit to call attempt`).

`ControlPlane.enqueueInstruction` now accepts an optional `callAttemptId` solely for causal audit correlation. Normal API-originated instructions remain unchanged. When a completed owner callback produces instructions, `applyTerminalOutcome` passes the callback's durable `CallAttempt.id` into `enqueueInstruction`.

The resulting `owner_instruction_queued` audit event carries:

- `runId`;
- `agentId`;
- `callAttemptId` for callback-originated steering;
- `instructionId`;
- privacy-safe source metadata.

It still does not copy the owner instruction text, callback transcript, replayable phone task, owner phone number, provider credentials, or webhook capability material into the audit timeline.

This closes an observability gap: operators can now correlate `call_attempt_completed` to the exact instruction(s) produced by that callback rather than relying only on temporal proximity.

### 2. Added callback causal-chain regression coverage

Implemented in commit `f6a3f240abd87d3c3c2b8fb32110f922fdd395e3` (`test: prove callback steering causal audit correlation`).

The audit timeline test now filters by the callback's durable `callAttemptId` and requires exactly one each of:

1. `call_attempt_created`;
2. `call_attempt_started`;
3. `owner_callback_requested`;
4. `call_attempt_completed`;
5. `owner_instruction_queued`.

It also requires durable audit ordering:

`created < started < callback requested < completed < instruction queued`

and verifies the queued event has an `instructionId`. Existing privacy checks still prove sensitive escalation context, decision answers, and callback instruction text are absent from serialized audit output.

## Verification performed

The final substantive state at commit `f6a3f240abd87d3c3c2b8fb32110f922fdd395e3` passed every repository verification surface:

- CI run `34305512672` / `check` job `102321261734` — **success** on Node 24.20.0. Locked dependency install, TypeScript typecheck, build, and all **99/99 tests** passed with 0 failures. The new callback causal-correlation regression passed.
- Container run `34305512719` — **success**. Production image build and deterministic fake-provider runtime smoke passed.
- Compose deployment run `34305512678` — **success**. The full Docker/SQLite/scoped-credential path passed, including generated least-privilege credentials, real built stdio MCP process, decision-call restart recovery, branch-specific release, owner callback restart recovery, exactly-once steering, SQLite restart, safe-checkpoint consumption, and exact acknowledgement.

`package.json` still has no separate lint script and no standalone migration/schema-check command. The available `npm run check` path covers TypeScript typechecking, build, and tests; Container and Compose cover production-runtime/deployment verification.

No live CALL-E phone call was attempted or claimed.

## Architecture decisions made this run

1. A callback's durable call attempt and the structured steering it produces should be causally linked in audit state by identifiers, not by timestamps or inferred event adjacency.
2. `callAttemptId` is privacy-safe operational correlation metadata; owner instruction text and callback transcript content remain excluded from audit events.
3. Instruction persistence remains independent of phone-transport lifecycle: provider completion creates durable queued state, and consumption still happens only at a later explicit safe checkpoint.
4. The optional correlation parameter belongs in the shared control-plane instruction path rather than an adapter-specific log, so HTTP, MCP, lifecycle polling, and webhook reconciliation keep one causal model.
5. Existing idempotency semantics remain unchanged: a retry of an already-terminal callback cannot queue another instruction because terminal call attempts are no-ops in `applyTerminalOutcome`.
6. Fake-provider success and deployment acceptance are not evidence of live CALL-E success.

## CALL-E integration status

- **Fake provider:** deterministic, credential-free, restart-stable provider identities, provider-local rehydration for durable accepted `queued`/`in_progress` calls, optional observation-driven completion, duplicate prevention, decision/callback restart recovery, and exact causal audit correlation from callback phone attempt to queued steering.
- **Production CALL-E adapter:** implemented against the asynchronous Calls API with server-only `CALLE_API_KEY`, stable idempotency, structured result schemas, bounded create/poll requests, persisted metadata/correlation, polling/webhook convergence, duplicate prevention, fail-closed ambiguous/stalled handling, and privacy-safe non-2xx provider error reporting.
- **Shared surfaces:** HTTP, TypeScript SDK, stdio MCP, lifecycle worker, and deployment workflows share the same persistent `ControlPlane` semantics rather than adapter-specific state machines.
- **Claude Code:** a concrete real-host acceptance procedure exists, but an actual Claude Code host run has not yet been observed and must not be claimed.
- **Live status:** no authorized real CALL-E phone call has been performed, so live provider success remains unverified.

## Current blockers / external prerequisites

No repository-development blocker prevents further useful work.

A true Claude Code host acceptance still requires an actual Claude Code environment with the CLI/host available to register and exercise the built stdio MCP server.

Live CALL-E verification still requires user-controlled prerequisites: a valid/authorized CALL-E credential, an authorized owner phone destination, and stable public HTTPS webhook ingress configured with the application-owned webhook capability token.

## Highest-value next actions

1. Strengthen the full Compose callback acceptance so the restart-recovered owner callback explicitly proves the same `callAttemptId` has exactly one ordered `created -> started -> owner_callback_requested -> completed -> owner_instruction_queued` chain, complementing this focused domain regression and the existing decision-call deployment correlation.
2. Document fake-provider `rehydrate` behavior more explicitly in `docs/ARCHITECTURE.md`, clearly separating deterministic local provider reconstruction from production CALL-E's remotely durable call identity.
3. Continue auditing model-/operator-facing diagnostics for accidental task-context, owner-phone, bearer-token, webhook-token, or instruction disclosure.
4. Run `docs/CLAUDE_CODE_ACCEPTANCE.md` in a genuine Claude Code host when that external prerequisite is available and record only observed results/version details.
5. When the user-controlled CALL-E prerequisites are available, perform one tightly bounded live provider acceptance and record only observed behavior.
