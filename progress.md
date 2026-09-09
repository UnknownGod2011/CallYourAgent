# CallYourAgent progress

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. Agents can escalate important decisions without freezing unrelated scopes; owners can independently request callbacks for progress/questions/steering; human input is persisted as structured state and consumed only at explicit safe checkpoints rather than pretending to interrupt in-flight model generation.

The repository includes deterministic fake and production CALL-E providers, SQLite persistence, replayable/idempotent call attempts, polling/webhook convergence, branch-scoped blocking, owner decision persistence, durable per-run instruction queues, exact instruction acknowledgement, quiet hours/call budgets, bounded lifecycle recovery, fail-closed ambiguous/stalled handling, privacy-aware audit history, scoped HTTP authentication, a typed TypeScript client, a real stdio MCP adapter, deterministic end-to-end/demo flows, an operator console, a Claude Code host-acceptance runbook, and a single-instance persistent-volume Compose reference deployment.

This run hardened escalation lifecycle durability. Expiry, policy deferral, and policy release/call reservation are now local atomic durability units: the escalation state and its causal audit history cannot diverge if a SQLite write fails. Provider/CALL-E network I/O remains outside database transactions.

## Exact repo state inspected this run

The run started from `main` HEAD `56ace72e03f65d92274ba31933ef32f13d52a378`, immediately after PR #14 verified that production CALL-E restart reconciliation resumes an already accepted remote call by persisted provider id instead of replaying provider creation.

Before making changes, inspected the complete recursive repository tree (`truncated: false`) and current architecture, recent commits, open issues, and open pull requests. There were no open issues or PRs at the start of the run. Recent work covered call reservation/idempotency, ambiguous recovery single-flight, webhook/poll races, accepted-call stale handling, lifecycle state/audit atomicity, restart guarantees, accepted-provider identity preservation, atomic terminal polling, atomic active-provider progress, and production-style CALL-E restart semantics.

Read in full before changing code:

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
- `docs/PROVIDER_RESTART_SEMANTICS.md`
- `deploy/README.md`

Also inspected the relevant implementation and reliability surfaces, especially `src/control-plane.ts`, `src/call-policy.ts`, `src/lifecycle.ts`, `src/sqlite-store.ts`, and existing SQLite failure-injection/atomicity tests.

The audit reproduced three real local consistency hazards in `ControlPlane`: escalation expiry and policy deferral persisted state before their matching audit events, while `call_policy_released` was emitted before the transaction that reserved the new decision call and changed the escalation from `pending` to `calling`. A SQLite write failure could therefore leave durable state without causal history or, worse, a false release event while the escalation was still deferred and no call existed.

## Changes made this run

PR #15, `Make escalation policy transitions atomic`, changed only `src/control-plane.ts` plus one focused new test file.

### Escalation expiry atomicity

`reconcileEscalation` now applies expiry inside `store.transaction(...)`. It re-reads the current escalation inside the transaction, rechecks terminal/expiry state, then persists `status=expired` and `escalation_expired` together. If the audit write fails, SQLite rolls back the expiry and reloads the in-memory mirrors, so a blocking scope remains blocked until a later successful expiry transition.

### Policy deferral atomicity

`startEscalationCallIfAllowed` now persists a changed `deferredReason` and `call_policy_deferred` inside one store transaction. It re-reads current escalation state before mutation, avoids overwriting an escalation whose call/status changed, and still suppresses duplicate same-reason deferral events.

### Policy release + call reservation atomicity

`call_policy_released` is no longer emitted before call reservation. When a deferred escalation becomes eligible, the release event is now inside the existing reservation transaction together with:

- `call_attempt_created` and the durable local `CallAttempt` reservation;
- escalation `pending -> calling`;
- linking `callAttemptId`;
- clearing `deferredReason`.

If any one of those local writes fails, all of them roll back. Only after that transaction commits does `dispatchCallAttempt` perform provider network I/O, preserving the rule that no CALL-E/provider request is made while a SQLite transaction is open.

### SQLite failure-injection regressions

Added `tests/sqlite-escalation-policy-atomicity.test.ts` with three deterministic regressions:

1. injected `escalation_expired` audit failure rolls expiry back to the original pending/deferred state and leaves the blocking scope unresolved; retry expires exactly once and releases that scope;
2. injected `call_policy_deferred` audit failure leaves the escalation pending with no phantom `deferredReason`; retry records the deferral exactly once;
3. injected `call_attempt_created` failure while a quiet-hours deferral is being released rolls back the release event, call reservation, escalation link/status change, and deferral clearing together; retry produces one release event, one call reservation, and the expected still-blocked decision scope.

The branch contained only 32 changed lines in `src/control-plane.ts` plus the focused regression file; no speculative rewrite or provider-contract change was introduced.

## Verification performed

Direct repository execution in the automation container remains unavailable because that network namespace cannot resolve `github.com`, so verification used the repository's GitHub Actions execution surfaces.

The substantive PR #15 head `a6ea0cb9455d8a138c1dcf8dd3d72662e6dda9b1` passed every repository verification surface before merge:

- CI run `34415223336` — **success**. Node `24.20.0`; locked dependencies installed; TypeScript no-emit typecheck succeeded; build succeeded; Node test suite finished with **131 tests, 131 passed, 0 failed**. All three new SQLite rollback/retry tests passed explicitly.
- Container run `34415223196` — **success**.
- Compose deployment run `34415223259` — **success**, preserving the full reference acceptance around generated least-privilege credentials, durable SQLite, compiled stdio MCP, decision/callback restart recovery, branch-specific release, exactly-once steering, persistence restart, and safe-checkpoint consumption.

`package.json` still has no separate lint script and no standalone migration/schema-check command. The normal `npm run check` path covers typechecking/build/tests; SQLite tests execute the durable schema/transaction path; Container and Compose cover production image/runtime/deployment behavior.

PR #15 was squash-merged as `ff72e010081fdaa762b9f083baeb95d103851a0a`.

No live CALL-E phone call was attempted or claimed.

## Architecture decisions made this run

1. When an escalation state transition and its audit event describe one local causal fact, they should commit or roll back together.
2. Policy release is not complete merely because policy evaluation says `allowed`; it is complete when the deferred escalation has atomically transitioned into a durable call reservation/calling state. The release audit therefore belongs in that same durability unit.
3. Re-read escalation state inside transactional mutations rather than building a transition solely from a pre-transaction snapshot.
4. Provider/CALL-E network I/O remains outside SQLite transactions; only resulting or preparatory local state is transactionally coupled.
5. A failed local transaction must not falsely release a blocked branch. Existing branch/scope semantics remain unchanged: unrelated work can continue while only the affected scope waits.
6. No new distributed/multi-instance claim is introduced; the supported durable topology remains one control-plane process with SQLite.

## CALL-E integration status

- **Fake provider:** deterministic, credential-free, idempotent, restart-rehydratable from durable accepted-call state, and still the primary full-flow development/acceptance provider.
- **Production CALL-E adapter:** implemented against the asynchronous Calls API with server-only `CALLE_API_KEY`, stable `Idempotency-Key`, structured result schemas, bounded create/poll requests, persisted correlation, polling/webhook convergence, duplicate prevention, restart-by-provider-id semantics, and fail-closed ambiguous/stalled handling. This run did not change the provider contract.
- **Shared surfaces:** HTTP, TypeScript SDK, stdio MCP, lifecycle worker, operator console, and deployment flows continue to share the same persistent control-plane state machine.
- **Claude Code:** compiled stdio MCP behavior is exercised in repository/deployment tests and the host-acceptance runbook remains valid. A genuine Claude Code host session has not yet been observed and is not claimed.
- **Live status:** no authorized real CALL-E phone call has been performed, so live provider connectivity, owner-phone authorization, and public webhook success remain unverified.

## Current blockers / external prerequisites

No repository-development blocker prevents further useful work.

A true Claude Code host acceptance requires an actual Claude Code environment/CLI to register and exercise the compiled stdio MCP server.

Live CALL-E verification still requires user-controlled prerequisites: a valid/authorized CALL-E credential, an authorized owner phone destination, and stable public HTTPS webhook ingress configured with the application-owned webhook capability token.

## Highest-value next actions

1. Failure-inject the initial owner-decision creation boundary: `requestOwnerDecision` currently persists the escalation, idempotency mapping, and `escalation_created` audit across separate local writes before policy evaluation. Determine whether a SQLite failure can leave a durable/idempotent escalation with missing causal history and transactionally couple it if reproduced.
2. Audit owner-callback request/start causal bookkeeping for local audit failures after provider acceptance. Preserve the already-established rule that a concrete provider identity must never be erased or reclassified as ambiguous merely because a local audit write failed.
3. Continue provider/result privacy audits for accidental task context, callback prompt, decision answer, instruction text, owner phone, API credential, or webhook-token disclosure.
4. Run the documented acceptance in a genuine Claude Code host when that external prerequisite is available and record only observed host/version behavior.
5. When the user-controlled CALL-E prerequisites are available, perform one tightly bounded live provider acceptance and record only observed behavior.
