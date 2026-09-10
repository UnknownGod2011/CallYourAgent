# CallYourAgent progress

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. Agents can escalate important decisions without freezing unrelated scopes; owners can independently request callbacks for progress/questions/steering; human input is persisted as structured state and consumed only at explicit safe checkpoints rather than pretending to interrupt in-flight model generation.

The repository includes deterministic fake and production CALL-E providers, SQLite persistence, replayable/idempotent call attempts, polling/webhook convergence, branch-scoped blocking, owner decision persistence, durable per-run instruction queues, exact instruction acknowledgement, quiet hours/call budgets, bounded lifecycle recovery, fail-closed ambiguous/stalled handling, privacy-aware audit history, scoped HTTP authentication, a typed TypeScript client, a real stdio MCP adapter, deterministic end-to-end/demo flows, an operator console, a Claude Code host-acceptance runbook, and a single-instance persistent-volume Compose reference deployment.

This run audited the exact durable call-reservation -> provider-start concurrency boundary for both owner callbacks and owner-decision calls. The suspected duplicate-dispatch race does not reproduce in the supported single-process Node topology: the durable idempotency mapping/call-attempt linkage is committed synchronously before provider I/O begins, so retries, reconciliation, and even synchronous provider re-entry observe the existing reservation instead of dispatching a second provider create. Two adversarial tests now make that invariant executable. No unnecessary production single-flight/lock layer was added.

## Exact repo state inspected this run

The run started from `main` HEAD `6dfed4d3851706876f50c2b1a3a5a057e817625f`, immediately after PR #18 and its progress handoff made agent registration, run creation, heartbeat/status reporting, and direct owner-instruction enqueue atomic with their causal audit events.

Before changing code, inspected the complete recursive repository tree from GitHub's recursive tree API. The tree reported `truncated: false` and covered the root, `.github/workflows`, `deploy`, all `docs`, all `src`, and all `tests` files. Inspected recent commits through the PR #18 merge/handoff. There were no open issues and no open pull requests before this run.

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

Also inspected the relevant implementation and verification surfaces, especially `src/control-plane.ts`, `tests/callback-idempotency-concurrency.test.ts`, `tests/decision-idempotency-concurrency.test.ts`, and `package.json`.

The callback audit focused on `requestOwnerCallback`: the callback reservation, callback idempotency mapping, `call_attempt_created`, and `owner_callback_requested` all commit synchronously before `dispatchCallAttempt` invokes provider I/O. Once that commit exists, the method's early idempotency lookup returns the same durable attempt directly. Because there is no `await` between the local transaction commit and invocation of `dispatchCallAttempt`, another ordinary request cannot interleave inside that gap in the supported single Node process. Even a provider whose `start()` method synchronously re-enters `requestOwnerCallback` sees the already-committed mapping and does not invoke `start()` again.

The analogous owner-decision audit reached the same conclusion. `requestOwnerDecision` commits the escalation/idempotency state first; `startEscalationCallIfAllowed` then transactionally links exactly one persisted `CallAttempt` and moves the escalation to `calling` before provider I/O. A re-entrant request sees the existing escalation with a `callAttemptId`/`calling` state and returns it instead of reserving or dispatching another call. Reconciliation while provider start is in flight also remains non-dispatching when no provider id has been written yet.

This is an in-process/single-instance guarantee. It is deliberately not generalized into a multi-instance/distributed claim; the documented reference topology remains one control-plane process with SQLite.

## Changes made this run

PR #19, `Test provider re-entry dispatch invariants`, added adversarial regression coverage without changing production state-machine behavior.

### Callback provider re-entry regression

Extended `tests/callback-idempotency-concurrency.test.ts` with a provider that synchronously re-enters `requestOwnerCallback` from inside its first `start()` invocation using the exact same logical idempotency key.

The test proves:

- the re-entrant retry resolves to the exact same durable callback id;
- provider `start()` executes exactly once;
- only one local `CallAttempt` exists;
- the callback idempotency mapping points at that attempt;
- exactly one `call_attempt_created`, one `owner_callback_requested`, and one `call_attempt_started` event exist;
- no synthetic `call_attempt_ambiguous` event is introduced.

### Owner-decision provider re-entry regression

Extended `tests/decision-idempotency-concurrency.test.ts` with the analogous adversarial provider. Its first `start()` synchronously re-enters `requestOwnerDecision` for the same run/scope/idempotency key.

The test proves:

- both callers resolve to the same escalation and `callAttemptId`;
- provider `start()` executes exactly once;
- only one escalation and one call attempt exist;
- the blocking `release-approval` scope remains correctly blocked while the call is unresolved;
- the accepted call receives one provider id;
- exactly one escalation creation, call-attempt creation, and provider-start audit event exist;
- no false ambiguous transition is created.

### Production behavior intentionally unchanged

No dispatch single-flight map, extra lock, schema change, API change, or provider-specific behavior was added because the audited race could not be reproduced. Provider idempotency remains a second line of defense, while the supported single-process control-plane ordering already prevents duplicate local dispatch for these paths.

## Verification performed

Direct repository execution in the automation container remains unavailable, so verification used the repository's GitHub Actions surfaces.

The substantive code head `d8023686d6eb7e0a84fc07182478cf86554c3b6e` passed the complete repository verification path first. CI run `34431818125` used Node `24.20.0`, completed `npm run check`, typecheck, build, and the Node test suite with **140 tests, 140 passed, 0 failed, 0 cancelled, 0 skipped, 0 todo**. Both new provider re-entry regressions passed explicitly. Container run `34431818146` and Compose deployment run `34431818145` also succeeded.

After adding this progress handoff, the final PR #19 head `0a74b1edba388c64cd877f8bc4e891553b9273c3` was reverified and every required workflow succeeded again:

- CI run `34431952294` — **success**.
- Container run `34431952290` — **success**.
- Compose deployment run `34431952296` — **success**, preserving the production-style durable SQLite + compiled stdio MCP + restart/recovery + branch-safe owner decision + owner callback steering + safe-checkpoint acceptance path.

PR #19 was squash-merged into `main` as `26cd1cd598ada72ac47872762daa9b68a3c32833`.

`package.json` still has no separate lint script and no standalone migration/schema-check command. `npm run check` covers typechecking, build, and tests; SQLite tests exercise the durable schema/transaction path; Container and Compose exercise production image/runtime/deployment behavior.

No live CALL-E phone call was attempted or claimed.

## Architecture decisions made this run

1. Do not add concurrency machinery without a demonstrated failure mode. The suspected callback dispatch race is already prevented by synchronous local reservation/idempotency before the first provider `await` boundary in the supported single-instance Node topology.
2. Provider re-entry is a useful adversarial test because `CallProvider.start()` executes user/provider adapter code before its returned promise is awaited. The new tests prove even that stronger form of interleaving cannot produce a second local dispatch for callback or decision requests.
3. Provider `Idempotency-Key` remains essential as defense in depth for transport ambiguity/retries, but ordinary same-process idempotent retries should not depend on the provider to deduplicate duplicate dispatches.
4. The result is intentionally scoped to the documented one-process SQLite deployment. A future multi-instance architecture must introduce database/distributed coordination rather than extrapolating JavaScript event-loop ordering across processes.
5. Branch/scope semantics are unchanged: only the affected blocking scope waits, unrelated work can continue, and callback steering remains durable queued state consumed only at explicit safe checkpoints.
6. Provider/CALL-E I/O remains outside SQLite transactions.

## CALL-E integration status

- **Fake provider:** deterministic, credential-free, idempotent, restart-rehydratable from durable accepted-call state, and still the primary full-flow development/acceptance provider. The new adversarial provider tests extend its role as deterministic concurrency test infrastructure.
- **Production CALL-E adapter:** remains implemented against the asynchronous Calls API with server-only `CALLE_API_KEY`, stable `Idempotency-Key`, structured result schemas, bounded create/poll requests, persisted correlation, polling/webhook convergence, duplicate prevention, restart-by-provider-id semantics, and fail-closed ambiguous/stalled handling. This run did not alter its external behavior.
- **Shared surfaces:** HTTP, TypeScript SDK, stdio MCP, lifecycle worker, operator console, and deployment flows continue to share the same persistent control-plane state machine.
- **Claude Code:** compiled stdio MCP behavior remains covered by automated and Compose acceptance. A genuine Claude Code host session has still not been observed and is not claimed.
- **Live status:** no authorized real CALL-E phone call has been performed, so live provider connectivity, owner-phone authorization, and public webhook success remain unverified.

## Current blockers / external prerequisites

No repository-development blocker prevents further useful work.

A true Claude Code host acceptance requires an actual Claude Code environment/CLI to register and exercise the compiled stdio MCP server.

Live CALL-E verification still requires user-controlled prerequisites: a valid/authorized CALL-E credential, an authorized owner phone destination, and stable public HTTPS webhook ingress configured with the application-owned webhook capability token.

## Highest-value next actions

1. Audit the remaining exact-instruction acknowledgement state/audit boundary under SQLite failure injection. `acknowledgeInstructions` already wraps the batch in one transaction, but explicitly prove that a failure while auditing one instruction cannot leave part of a multi-instruction acknowledgement consumed and part queued, and that retry remains idempotent.
2. Audit privacy of provider/result and error surfaces for accidental task context, callback prompt, decision answer, instruction text, owner phone, API credential, or webhook-token disclosure, prioritizing errors and operator-visible payloads.
3. Review shutdown/lifecycle overlap around provider polling and callback/decision reconciliation for any same-attempt concurrent observe/apply paths not already covered by webhook/poll race tests; change production logic only for a reproducible state divergence.
4. Run the documented acceptance in a genuine Claude Code host when that external prerequisite is available and record only observed host/version behavior.
5. When the user-controlled CALL-E prerequisites are available, perform one tightly bounded live provider acceptance and record only observed behavior.
