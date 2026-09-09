# CallYourAgent progress

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. Agents can escalate important decisions without freezing unrelated scopes; owners can independently request callbacks for progress/questions/steering; human input is persisted as structured state and consumed only at explicit safe checkpoints rather than pretending to interrupt in-flight model generation.

The repository includes deterministic fake and production CALL-E providers, SQLite persistence, replayable/idempotent call attempts, polling/webhook convergence, branch-scoped blocking, owner decision persistence, durable per-run instruction queues, exact instruction acknowledgement, quiet hours/call budgets, bounded lifecycle recovery, fail-closed ambiguous/stalled handling, privacy-aware audit history, scoped HTTP authentication, a typed TypeScript client, a real stdio MCP adapter, deterministic end-to-end/demo flows, an operator console, a Claude Code host-acceptance runbook, and a single-instance persistent-volume Compose reference deployment.

This run proved the stale-recovery protection added previously under a harder asynchronous interleaving: an ambiguous callback recovery replay can be in flight while a terminal provider webhook for the same durable call attempt wins first. The late provider-create replay response now demonstrably re-reads durable state and preserves the webhook-completed attempt instead of resurrecting `queued` state or duplicating callback steering.

## Exact repo state inspected this run

The run started from `main` HEAD `ab732caa8d6b6b3eb8dda890557e8fc349e105d4`.

Before any change, inspected the complete recursive repository tree and current architecture. The recursive Git tree response was complete (`truncated: false`). Inspected recent commits plus open repository issues/PR activity; there were no open issues. The latest substantive merged work was PR #2, `Single-flight concurrent ambiguous call recovery`.

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
- `src/domain.ts`
- `src/call-provider.ts`
- `tests/sqlite-ambiguous-recovery-singleflight.test.ts`

Repository mutation and executable verification used the connected GitHub integration and GitHub Actions. A local clone was attempted only as an auxiliary execution path, but the automation container had no DNS access to GitHub; no local-execution claim is made.

## Changes made this run

### SQLite recovery-vs-terminal-webhook regression

Added `tests/sqlite-recovery-webhook-race.test.ts` in commit `78bed44b8c64f0a12a1af0a2da646a81b0c1745e` (`test: race ambiguous recovery with terminal webhook`) on PR #3.

The deterministic test uses a real temporary `SqliteControlPlaneStore` and a gated fake provider:

1. an owner callback is created normally and receives one provider call id;
2. provider observation is deliberately reconciled as `ambiguous` while retaining that provider correlation;
3. `recoverCallAttempt` begins replaying the exact persisted provider create and is held open before the replay result returns;
4. while recovery is still in flight, a terminal `completed` webhook is applied for the same provider call id;
5. the webhook transitions the durable attempt to `completed` and queues exactly one callback-originated owner instruction;
6. the recovery replay is released afterward;
7. the late recovery response must re-read durable state, observe `completed`, and return that current attempt without writing a stale `queued` transition;
8. the same queued instruction id remains the only steering item after recovery returns;
9. duplicate delivery of the same webhook event id is rejected as a duplicate and cannot queue another instruction.

The audit assertions require exactly one `call_attempt_created`, one initial `call_attempt_started`, one `call_attempt_ambiguous`, one `call_attempt_completed`, one `owner_instruction_queued`, and one `provider_webhook_reconciled` event. A stale recovery response therefore cannot fabricate a second start/completion chain.

No production-code rewrite was necessary: the regression validates the existing `recoverCallAttemptOnce` durable-state re-read introduced in the previous run.

## Verification performed

PR #3 head `78bed44b8c64f0a12a1af0a2da646a81b0c1745e` passed every repository verification surface:

- CI run `34343196226` — **success**. Node 24 setup, locked dependency install, and the repository `Typecheck and test` step completed successfully, including the new SQLite terminal-webhook-vs-recovery race regression.
- Container run `34343196162` — **success**. Production container verification passed.
- Compose deployment run `34343196253` — **success**. Generated scoped deployment credentials, Compose config validation, fake-provider deployment, health/readiness, real compiled stdio MCP verification, active owner-decision restart recovery, branch-specific release, active owner-callback restart recovery, exactly-once steering, post-steering restart, and safe-checkpoint instruction consumption all passed.

`package.json` has no separate lint script and no standalone migration/schema-check command. The available `check` path covers typechecking/build/tests, SQLite tests exercise durable schema/transaction behavior, and Container/Compose cover production runtime/deployment behavior.

No live CALL-E phone call was attempted or claimed.

## Architecture decisions made this run

1. Terminal provider evidence must win over a stale in-flight recovery result. Recovery provider I/O is advisory until the control plane re-reads current durable state immediately before applying it.
2. The same rule protects callback semantics, not only call-attempt status: once a terminal webhook has queued owner steering, a late recovery replay must not create another local call transition or duplicate the instruction.
3. Webhook event-id deduplication remains a separate exactly-once defense. Stale-recovery protection prevents state resurrection; webhook dedup prevents repeated terminal delivery from duplicating business effects.
4. Provider I/O remains outside SQLite transactions. Correctness is obtained through persisted identity/idempotency plus state re-validation rather than holding a database lock across network waits.
5. The proven guarantee is for the documented single-process SQLite topology. The process-local recovery single-flight is not represented as a distributed lease.
6. Branch-specific blocking and safe-checkpoint steering semantics are unchanged: unrelated work continues, and callback instructions become durable queued state rather than mid-generation interruption.
7. Deterministic fake-provider evidence remains separate from live CALL-E evidence.

## CALL-E integration status

- **Fake provider:** deterministic, credential-free, provider-idempotent, restart-rehydratable from durable accepted-call state, and now used with SQLite to prove terminal webhook state wins over a late ambiguous-recovery replay.
- **Production CALL-E adapter:** implemented against the asynchronous Calls API with server-only `CALLE_API_KEY`, stable `Idempotency-Key`, structured result schemas, bounded create/poll requests, persisted correlation, polling/webhook convergence, duplicate prevention, fail-closed ambiguous/stalled handling, and privacy-safe provider errors. This run did not alter or live-test the adapter.
- **Control-plane concurrency:** initial callback/decision call identities are reserved before provider awaits; ambiguous recovery is single-flight per durable call attempt within the supported process; recovery completion re-checks durable state; this run now proves a terminal webhook that wins during replay cannot be overwritten afterward.
- **Shared surfaces:** HTTP, TypeScript SDK, stdio MCP, lifecycle worker, and deployment verification continue to share the same persistent control-plane semantics rather than adapter-specific state machines.
- **Claude Code:** the built stdio MCP process is exercised as a real external child and the documented host acceptance matches the tested lifecycle. An actual Claude Code host session still has not been observed and must not be claimed.
- **Live status:** no authorized real CALL-E phone call has been performed, so live provider/phone/webhook success remains unverified.

## Current blockers / external prerequisites

No repository-development blocker prevents further useful work.

A true Claude Code host acceptance requires an actual Claude Code environment/CLI to register and exercise the built stdio MCP server.

Live CALL-E verification still requires user-controlled prerequisites: a valid/authorized CALL-E credential, an authorized owner phone destination, and stable public HTTPS webhook ingress configured with the application-owned webhook capability token.

## Highest-value next actions

1. Add the equivalent deterministic decision-call race: an in-flight ambiguous owner-decision recovery versus a terminal webhook must produce exactly one durable owner decision and release only its blocked scope, never duplicate decisions or overwrite terminal state.
2. Audit polling/webhook terminal convergence for stale-object interleavings where a provider `observe()` call begins from `queued`/`in_progress`, a webhook completes the attempt while polling is in flight, and the late poll returns stale active or terminal evidence. Add regression coverage before changing production code.
3. Audit lifecycle stale marking against concurrent terminal webhook application so a call that completes while a stale-age sweep is evaluating cannot be incorrectly left `stalled` afterward.
4. Document fake-provider `rehydrate` behavior more explicitly in `docs/ARCHITECTURE.md`, clearly separating deterministic process-local reconstruction from production CALL-E's remotely durable provider identity.
5. Continue auditing model-/operator-facing diagnostics and read projections for accidental task-context, owner-phone, bearer-token, webhook-token, callback-prompt, or instruction disclosure.
6. Run the documented acceptance in a genuine Claude Code host when that external prerequisite is available and record only observed host/version behavior.
7. When the user-controlled CALL-E prerequisites are available, perform one tightly bounded live provider acceptance and record only observed behavior.
