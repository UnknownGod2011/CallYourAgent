# CallYourAgent progress

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. Agents can escalate important decisions without freezing unrelated scopes; owners can independently request callbacks for progress/questions/steering; human input is persisted as structured state and consumed only at explicit safe checkpoints rather than pretending to interrupt in-flight model generation.

The repository currently includes deterministic fake and production CALL-E providers, SQLite persistence, replayable/idempotent call attempts, polling/webhook convergence, branch-scoped blocking, owner decision persistence, durable per-run instruction queues, exact instruction acknowledgement, call policy/quiet hours/budgets, bounded lifecycle recovery, fail-closed ambiguous/stalled handling, privacy-aware audit history, scoped HTTP authentication, a typed TypeScript client, a real stdio MCP adapter, deterministic end-to-end/demo flows, an operator console, a Claude Code real-host acceptance runbook, and a single-instance persistent-volume Compose reference deployment.

This run strengthened restart safety for the owner -> agent callback path. A new focused SQLite regression now reconstructs both the durable store and the deterministic fake CALL-E provider while an owner callback is still non-terminal, then proves that reconciliation after restart and a deliberate reconciliation retry produce exactly one causal `call_attempt_created -> call_attempt_started -> owner_callback_requested -> call_attempt_completed -> owner_instruction_queued` chain and exactly one queued steering item.

## Exact repo state inspected this run

The run started from `main` HEAD `de7e794741c713174e3f7a836e9ab0ba0d0781de`.

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

- `tests/audit-timeline.test.ts`, including callback causal correlation;
- `tests/fake-provider-rehydration.test.ts`, including process-style provider reconstruction semantics;
- `tests/sqlite-owner-callback-http-restart.test.ts`;
- `tests/mcp-stdio-deployment-acceptance.ts`, including the existing exact decision-call audit chain and owner steering flow;
- the current Compose deployment acceptance and recent callback correlation commits.

The automation runtime could not clone the public repository because outbound DNS/network access from the local container was unavailable. Repository reads/writes therefore used the connected GitHub integration, and executable verification used the repository's GitHub Actions workflows. No unsupported local execution claim is made.

## Changes made this run

### Added restart-recovered callback call-attempt audit regression

Implemented in commit `72b712c289678077d4aa43bcd45c8e253e3d1d03` (`test: prove callback call audit correlation across restart`).

Added `tests/callback-call-audit-restart.test.ts`.

The test:

1. creates an owner callback against SQLite while the fake provider reports a non-terminal accepted call;
2. verifies only one create/start/request audit chain exists before restart and no completion/steering has yet been fabricated;
3. closes the SQLite store and constructs a fresh store plus a fresh fake provider, modeling a process restart rather than reusing provider-local state;
4. reconciles the original durable callback so provider rehydration uses the existing persisted provider identity and idempotency state;
5. intentionally reconciles the already-terminal callback a second time;
6. verifies exactly one queued owner instruction exists at the agent checkpoint;
7. correlates the entire callback by its durable `callAttemptId` and requires exactly one each of `call_attempt_created`, `call_attempt_started`, `owner_callback_requested`, `call_attempt_completed`, and `owner_instruction_queued`;
8. requires strict durable sequence ordering across those events;
9. verifies successful restart recovery did not fabricate `call_attempt_ambiguous` or `call_attempt_failed` state;
10. verifies callback prompt text and generated steering text are absent from serialized audit metadata.

This complements the existing decision-call restart correlation and callback causal-correlation tests by combining callback causal auditability with actual provider/store reconstruction and terminal retry idempotency.

## Verification performed

The substantive commit `72b712c289678077d4aa43bcd45c8e253e3d1d03` passed every repository verification surface:

- CI run `34309465667` — **success**. The standard Node 24 CI path completed successfully, covering locked dependency install, TypeScript typecheck, build, and the full test suite including the new callback restart regression.
- Container run `34309465681` — **success**. Production image build and deterministic fake-provider runtime smoke passed.
- Compose deployment run `34309465650` — **success**. The full Docker/SQLite/scoped-credential deployment acceptance passed, preserving the existing real built stdio MCP path, active decision restart recovery, branch-specific release, owner callback/steering flow, persistent restart behavior, safe-checkpoint consumption, and exact acknowledgement.

`package.json` still has no separate lint script and no standalone migration/schema-check command. The available CI `check` path covers TypeScript typechecking, build, and tests; Container and Compose cover production-runtime/deployment verification.

No live CALL-E phone call was attempted or claimed.

## Architecture decisions made this run

1. Callback restart correctness must be proven by reconstructing both the durable store and provider-local fake state, not merely by closing/reopening SQLite while retaining the same provider object.
2. Provider rehydration is recovery of the same logical phone interaction, not another provider create. Therefore exactly one `call_attempt_started` event is a key invariant.
3. Terminal callback reconciliation is idempotent: retrying an already-terminal attempt must not emit another completion or enqueue another owner instruction.
4. Callback steering remains asynchronous durable state. Recovery completes the phone interaction and queues steering; the agent still observes it only at a later explicit checkpoint.
5. `callAttemptId` is the causal join key for operational auditability; sensitive callback prompt/instruction content remains excluded from audit metadata.
6. Deterministic fake-provider recovery evidence is not evidence of live CALL-E success.

## CALL-E integration status

- **Fake provider:** deterministic, credential-free, restart-stable provider identities, provider-local rehydration for durable accepted `queued`/`in_progress` calls, optional observation-driven completion, duplicate prevention, decision/callback restart recovery, callback causal audit correlation, and now explicit callback restart + terminal retry exactly-once regression coverage.
- **Production CALL-E adapter:** implemented against the asynchronous Calls API with server-only `CALLE_API_KEY`, stable idempotency, structured result schemas, bounded create/poll requests, persisted metadata/correlation, polling/webhook convergence, duplicate prevention, fail-closed ambiguous/stalled handling, and privacy-safe non-2xx provider error reporting.
- **Shared surfaces:** HTTP, TypeScript SDK, stdio MCP, lifecycle worker, and deployment workflows share the same persistent `ControlPlane` semantics rather than adapter-specific state machines.
- **Claude Code:** a concrete real-host acceptance procedure exists, but an actual Claude Code host run has not yet been observed and must not be claimed.
- **Live status:** no authorized real CALL-E phone call has been performed, so live provider success remains unverified.

## Current blockers / external prerequisites

No repository-development blocker prevents further useful work.

A true Claude Code host acceptance still requires an actual Claude Code environment with the CLI/host available to register and exercise the built stdio MCP server.

Live CALL-E verification still requires user-controlled prerequisites: a valid/authorized CALL-E credential, an authorized owner phone destination, and stable public HTTPS webhook ingress configured with the application-owned webhook capability token.

## Highest-value next actions

1. Move this exact callback `callAttemptId` chain assertion into `tests/mcp-stdio-deployment-acceptance.ts` so the full Docker + SQLite + scoped-credential + real stdio MCP path itself proves callback restart recovery and exactly-once steering correlation end-to-end.
2. In that deployment acceptance, restart the control plane while the owner callback is still non-terminal, then reconcile the restored original callback rather than restarting only after callback completion.
3. Document fake-provider `rehydrate` behavior more explicitly in `docs/ARCHITECTURE.md`, clearly separating deterministic local provider reconstruction from production CALL-E's remotely durable call identity.
4. Continue auditing model-/operator-facing diagnostics for accidental task-context, owner-phone, bearer-token, webhook-token, or instruction disclosure.
5. Run `docs/CLAUDE_CODE_ACCEPTANCE.md` in a genuine Claude Code host when that external prerequisite is available and record only observed results/version details.
6. When the user-controlled CALL-E prerequisites are available, perform one tightly bounded live provider acceptance and record only observed behavior.
