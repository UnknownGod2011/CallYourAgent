# CallYourAgent progress

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. Agents can escalate important decisions without freezing unrelated scopes; owners can independently request callbacks for progress/questions/steering; human input is persisted as structured state and consumed only at explicit safe checkpoints rather than pretending to interrupt in-flight model generation.

The repository includes deterministic fake and production CALL-E providers, SQLite persistence, replayable/idempotent call attempts, polling/webhook convergence, branch-scoped blocking, owner decision persistence, durable per-run instruction queues, exact instruction acknowledgement, quiet hours/call budgets, bounded lifecycle recovery, fail-closed ambiguous/stalled handling, privacy-aware audit history, scoped HTTP authentication, a typed TypeScript client, a real stdio MCP adapter, deterministic end-to-end/demo flows, an operator console, a Claude Code host-acceptance runbook, and a single-instance persistent-volume Compose reference deployment.

This run extended the stale-recovery guarantee to the agent -> owner decision path. A terminal provider webhook can now be proven to win while an ambiguous decision-call recovery replay is still in flight: the webhook creates exactly one durable owner decision, resolves only that escalation's blocked scope, preserves unrelated active work, and a later recovery response cannot overwrite the terminal call or duplicate the decision.

## Exact repo state inspected this run

The run started from `main` HEAD `28539244b3c0a50818b0e64ae40c727386f13634`, the merge of PR #3 (`Race terminal webhook against ambiguous recovery`).

Before any change, inspected the recursive repository tree and current architecture, recent commits, and open repository issue/PR activity. There were no open issues or pull requests before this run's branch was created.

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

Also inspected the relevant implementation and verification surfaces, especially:

- `src/control-plane.ts`
- `tests/sqlite-recovery-webhook-race.test.ts`
- `tests/decision-call-audit-restart.test.ts`
- `tests/control-plane.test.ts`

The relevant control-plane behavior already re-reads durable `CallAttempt` state after an awaited ambiguous-recovery provider replay and refuses to apply the stale result when another path has already moved the attempt out of `ambiguous`. The decision and callback flows share `applyTerminalOutcome`, while checkpoint blocking is derived only from unresolved blocking escalations.

Repository mutation and executable verification used the connected GitHub integration and GitHub Actions.

## Changes made this run

### SQLite owner-decision recovery-vs-terminal-webhook regression

Added `tests/sqlite-decision-recovery-webhook-race.test.ts` in commit `3b0cc5b773150a53d62fb258815a0994857def2d` (`test: race decision recovery with terminal webhook`) on PR #4.

The deterministic test uses a real temporary `SqliteControlPlaneStore` and a gated fake provider:

1. an agent run remains active in the independent `documentation` scope;
2. the agent raises a blocking `release-approval` escalation and one durable decision-call attempt is accepted;
3. the attempt is reconciled to `ambiguous` while retaining its original provider correlation;
4. `recoverCallAttempt` begins replaying the exact persisted provider request and is deliberately held before the replay result returns;
5. while recovery is still in flight, a terminal `completed` provider webhook is applied to the same call attempt;
6. the webhook creates exactly one durable `OwnerDecision`, resolves the escalation, and releases `release-approval` while the run's unrelated current scope remains `documentation`;
7. the recovery replay returns afterward and must re-read the completed durable attempt rather than writing a stale active state;
8. the decision id, answer, and structured result remain unchanged and the decision store still contains exactly one decision;
9. duplicate delivery of the same webhook event id is rejected and cannot replace or duplicate the owner decision.

The audit assertions require exactly one `call_attempt_created`, one initial `call_attempt_started`, one `call_attempt_ambiguous`, one `call_attempt_completed`, one `owner_decision_recorded`, and one `provider_webhook_reconciled` event for the logical decision call.

No production-code rewrite was necessary: this regression proves the existing durable-state re-read protects decision semantics as well as callback steering under the same asynchronous interleaving.

## Verification performed

PR #4 substantive head `3b0cc5b773150a53d62fb258815a0994857def2d` passed every repository verification surface:

- CI run `34348633133` — **success**. Node 24 setup, locked dependency install, repository typecheck/build/test path, and the new SQLite decision webhook-vs-recovery regression passed.
- Container run `34348633137` — **success**. Production image/runtime verification passed.
- Compose deployment run `34348633141` — **success**. Generated scoped credentials, Compose validation, fake-provider deployment, SQLite persistence/restart behavior, real compiled stdio MCP verification, active decision/callback recovery paths, branch-specific resume semantics, exactly-once steering, and safe-checkpoint instruction consumption remained green.

`package.json` has no separate lint script and no standalone migration/schema-check command. The available repository check path covers typechecking/build/tests; SQLite tests exercise durable schema/transaction behavior; Container and Compose exercise the production runtime/deployment path.

No live CALL-E phone call was attempted or claimed.

## Architecture decisions made this run

1. Terminal provider evidence wins over a stale in-flight ambiguous-recovery replay for owner-decision calls just as it does for owner callbacks.
2. Call-attempt terminality and business effects must converge together: when the winning webhook resolves a decision call, exactly one `OwnerDecision` is durable before the late recovery result is allowed to observe state.
3. Branch-level semantics remain explicit. Resolving `release-approval` removes only that blocked scope; the independent `documentation` scope is never presented as paused or restarted by the phone flow.
4. Provider replay remains outside the SQLite transaction. Correctness comes from persisted call identity/idempotency plus durable state re-validation after provider I/O, not from holding a database transaction across a network wait.
5. Webhook event-id deduplication remains an independent exactly-once layer. State re-validation prevents resurrection; event dedup prevents repeated terminal delivery from replacing or duplicating the decision.
6. The proven concurrency guarantee remains for the documented single-process SQLite topology; process-local recovery single-flight is not represented as a distributed lease.
7. Deterministic fake-provider evidence remains separate from live CALL-E evidence.

## CALL-E integration status

- **Fake provider:** deterministic, credential-free, provider-idempotent, restart-rehydratable from durable accepted-call state, and now used with SQLite to prove terminal webhook precedence during ambiguous recovery for both callback and decision-call business effects.
- **Production CALL-E adapter:** implemented against the asynchronous Calls API with server-only `CALLE_API_KEY`, stable `Idempotency-Key`, structured result schemas, bounded create/poll requests, persisted correlation, polling/webhook convergence, duplicate prevention, fail-closed ambiguous/stalled handling, and privacy-safe provider errors. This run did not alter or live-test the adapter.
- **Control-plane concurrency:** initial callback/decision identities are reserved before provider awaits; ambiguous recovery is single-flight per durable call attempt within the supported process; recovery completion re-checks durable state; terminal webhook precedence is now regression-tested for both queued callback steering and durable owner decisions.
- **Shared surfaces:** HTTP, TypeScript SDK, stdio MCP, lifecycle worker, and deployment verification continue to share the same persistent control-plane semantics rather than adapter-specific state machines.
- **Claude Code:** the built stdio MCP process is exercised as a real external child and the documented host acceptance matches the tested lifecycle. An actual Claude Code host session still has not been observed and must not be claimed.
- **Live status:** no authorized real CALL-E phone call has been performed, so live provider/phone/webhook success remains unverified.

## Current blockers / external prerequisites

No repository-development blocker prevents further useful work.

A true Claude Code host acceptance requires an actual Claude Code environment/CLI to register and exercise the built stdio MCP server.

Live CALL-E verification still requires user-controlled prerequisites: a valid/authorized CALL-E credential, an authorized owner phone destination, and stable public HTTPS webhook ingress configured with the application-owned webhook capability token.

## Highest-value next actions

1. Audit polling/webhook convergence for stale-object interleavings: begin a provider `observe()` from `queued`/`in_progress`, let a terminal webhook complete the durable attempt while the poll is in flight, then return stale active or terminal poll evidence. Add deterministic SQLite regressions before changing production code.
2. Audit lifecycle stale marking against concurrent terminal webhook application so a call that completes while a stale-age sweep is evaluating cannot be incorrectly left `stalled` afterward.
3. Document fake-provider `rehydrate` behavior more explicitly in `docs/ARCHITECTURE.md`, separating deterministic local reconstruction from production CALL-E's remotely durable provider identity.
4. Continue auditing model-/operator-facing diagnostics and read projections for accidental task-context, owner-phone, bearer-token, webhook-token, callback-prompt, or instruction disclosure.
5. Run the documented acceptance in a genuine Claude Code host when that external prerequisite is available and record only observed host/version behavior.
6. When the user-controlled CALL-E prerequisites are available, perform one tightly bounded live provider acceptance and record only observed behavior.
