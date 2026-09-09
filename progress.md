# CallYourAgent progress

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. Agents can escalate important decisions without freezing unrelated scopes; owners can independently request callbacks for progress/questions/steering; human input is persisted as structured state and consumed only at explicit safe checkpoints rather than pretending to interrupt in-flight model generation.

The repository includes deterministic fake and production CALL-E providers, SQLite persistence, replayable/idempotent call attempts, polling/webhook convergence, branch-scoped blocking, owner decision persistence, durable per-run instruction queues, exact instruction acknowledgement, quiet hours/call budgets, bounded lifecycle recovery, fail-closed ambiguous/stalled handling, privacy-aware audit history, scoped HTTP authentication, a typed TypeScript client, a real stdio MCP adapter, deterministic end-to-end/demo flows, an operator console, a Claude Code host-acceptance runbook, and a single-instance persistent-volume Compose reference deployment.

This run strengthened the accepted-call timeout guarantee on the actual durable SQLite path. The prior run fixed lifecycle semantics so a `CallAttempt` persisted as local `queued` state before `CallProvider.start()` completes is not considered a provider-accepted call until a durable `providerCallId` exists. This run added a deterministic SQLite-backed concurrency regression proving that transactionally persisted reservation survives a lifecycle sweep past the stale threshold without being mislabeled `stalled`, and that the same durable attempt receives exactly one provider identity/start transition once provider creation completes.

## Exact repo state inspected this run

The run started from `main` HEAD `18af2d50f7acf411ce1177448492d3c5faaac225`, which recorded the accepted-call stall guard merged in PR #6.

Before any change, inspected the full recursive repository tree (`truncated: false`), current architecture, recent commits, repository issue activity, and pull-request history. There were no open repository issues. PRs #1-#6 were already merged and collectively covered call identity reservation, ambiguous-recovery single-flight, recovery-vs-webhook precedence, stale poll-vs-webhook protection, and the pre-provider-acceptance stale-timeout guard.

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

Also inspected the full source/test inventory from the recursive tree and the implementation/verification surfaces relevant to the next action, especially:

- `src/control-plane.ts`, including `persistCallAttempt`, `dispatchCallAttempt`, active/terminal reconciliation, callback reservation, and escalation call reservation;
- `tests/lifecycle-inflight-create-stall.test.ts`;
- `tests/sqlite-call-reservation-concurrency.test.ts`;
- `package.json` and the repository verification commands.

The audit explicitly revisited the previous highest-value action: `dispatchCallAttempt()` constructs its post-network write from the pre-await attempt. In the current architecture, however, there is no normal externally reachable transition that can legitimately make a just-reserved call terminal while provider creation is still unresolved: the durable attempt has no `providerCallId`, provider webhook correlation therefore cannot find it yet, ordinary reconciliation returns without polling it, and the accepted-call lifecycle timeout now ignores it. Rather than add a speculative production rewrite without a reproducible competing transition, this run chose the next concrete gap: prove the reservation-vs-provider-accepted distinction through the durable SQLite adapter itself.

Repository mutation and executable verification used the connected GitHub integration and GitHub Actions. A local container clone attempt was also made for independent execution, but the automation container could not resolve `github.com`; this did not block verification because the repository's GitHub Actions checks executed successfully against the PR merge ref.

The coherent test increment was merged as PR #7, merge commit `8f8d389c3bfda73f295de01b31762f5fb354a094`.

## Changes made this run

### Durable SQLite in-flight provider-create regression

Added `tests/sqlite-lifecycle-inflight-create-stall.test.ts`.

The test uses the real `SqliteControlPlaneStore`, a mutable clock, and a gated deterministic fake provider. It forces this exact interleaving:

1. an owner callback is requested while the run continues unrelated `documentation` work;
2. the callback identity and `CallAttempt` are durably reserved in SQLite before provider I/O completes;
3. provider `start()` is deliberately held in flight, leaving the durable attempt `queued` with no `providerCallId`;
4. the callback idempotency mapping already points to that same durable attempt;
5. the clock advances beyond `maxInProgressCallAgeMs`;
6. the lifecycle sweep runs while provider creation is still unresolved;
7. the sweep must report zero stale calls, preserve `queued` state, preserve the missing provider identity, emit no `call_attempt_stalled`, and leave the unrelated `documentation` scope active;
8. provider creation is released;
9. the exact same durable attempt receives one provider identity and remains `queued` as a genuinely provider-accepted call;
10. the audit timeline contains exactly one `call_attempt_started` and one `owner_callback_requested` transition, with only one durable call attempt in the store.

This is not a new demo-only path. It exercises the same control-plane, lifecycle manager, fake provider, SQLite transaction/store, idempotency mapping, and audit machinery used by the reference deployment.

No production API, MCP, SDK, CALL-E adapter, schema, or UI contract changed in this run.

## Verification performed

PR #7 head `8d24825fdd5887ad74d661f9c31255e265f11295` passed every repository verification surface before merge:

- CI run `34367924253` — **success**. Node `24.20.0`, locked dependency install, TypeScript typecheck, build, and **112/112 tests passed** with 0 failures. The new `SQLite lifecycle does not stall a durable callback reservation while provider create is in flight` regression passed.
- Container run `34367924075` — **success**. Production image build and deterministic fake-provider runtime smoke remained green.
- Compose deployment run `34367924491` — **success**. The full reference deployment acceptance remained green, including generated least-privilege credentials, SQLite persistence, fake-provider deployment, authenticated HTTP state, the real compiled stdio MCP process, restart during an active branch-blocking owner-decision call, branch-specific release, restart during an active owner callback, exactly-once callback steering, subsequent persistence restart, and safe-checkpoint instruction acknowledgement.

`package.json` still has no separate lint script and no standalone migration/schema-check command. `npm run check` covers typechecking/build/tests; SQLite tests exercise the durable schema/transaction path; Container and Compose cover the production runtime/deployment path.

A direct local clone/check attempt from the automation container failed before checkout because DNS could not resolve `github.com`. No local test result is therefore claimed; GitHub Actions is the executable verification evidence for this run.

No live CALL-E phone call was attempted or claimed.

## Architecture decisions made this run

1. The pre-provider `queued` attempt remains an intentional durable reservation state. Persist-before-side-effect is preserved rather than moving persistence after network I/O.
2. A durable `providerCallId` remains the explicit boundary between local reservation and provider-accepted active call for stale-timeout purposes.
3. The reservation-vs-accepted invariant is now covered against both the in-memory store and the actual SQLite adapter used by the reference deployment.
4. Provider I/O remains outside SQLite transactions. The test proves correctness through durable state and lifecycle guards rather than a database lock held across network latency.
5. Branch-level non-disturbance remains part of the regression: provider creation delay does not freeze the unrelated active scope.
6. `dispatchCallAttempt()` was audited for a post-await stale-object class, but no currently reachable competing domain transition was found during the pre-acceptance window. No speculative production rewrite was introduced without a reproducible race.
7. The single-instance SQLite topology remains the supported guarantee. This test does not imply distributed multi-process coordination.
8. Deterministic fake-provider evidence remains separate from live CALL-E evidence.

## CALL-E integration status

- **Fake provider:** deterministic, credential-free, provider-idempotent, restart-rehydratable from durable accepted-call state, and now used with the SQLite adapter to prove a provider-create request may remain in flight past the accepted-call timeout without corrupting local call state or unrelated agent progress.
- **Production CALL-E adapter:** implemented against the asynchronous Calls API with server-only `CALLE_API_KEY`, stable `Idempotency-Key`, structured result schemas, bounded create/poll requests, persisted correlation, polling/webhook convergence, duplicate prevention, fail-closed ambiguous/stalled handling, and privacy-safe provider errors. This run did not alter or live-test that adapter.
- **Control-plane concurrency:** callback/decision identities are reserved before provider awaits; ambiguous recovery is single-flight per durable call attempt within the supported process; recovery and ordinary polling re-check durable state after provider I/O; terminal webhook precedence is covered against ambiguous recovery and stale polling; both memory and SQLite now prove that unresolved provider creation cannot be mislabeled as a stale accepted call.
- **Shared surfaces:** HTTP, TypeScript SDK, stdio MCP, lifecycle worker, operator/deployment paths continue to share one persistent control-plane state machine rather than adapter-specific behavior.
- **Claude Code:** the built stdio MCP process is exercised as a real external child in repository/deployment tests and the host-acceptance runbook remains aligned. An actual Claude Code host session still has not been observed and must not be claimed.
- **Live status:** no authorized real CALL-E phone call has been performed, so live provider, phone, and public-webhook success remain unverified.

## Current blockers / external prerequisites

No repository-development blocker prevents further useful work.

A true Claude Code host acceptance requires an actual Claude Code environment/CLI to register and exercise the built stdio MCP server.

Live CALL-E verification still requires user-controlled prerequisites: a valid/authorized CALL-E credential, an authorized owner phone destination, and stable public HTTPS webhook ingress configured with the application-owned webhook capability token.

The automation container's inability to resolve `github.com` prevented an additional local clone/check during this run, but the connected GitHub integration and all three GitHub Actions workflows remained available and successful, so this was not a repository-development blocker.

## Highest-value next actions

1. Audit the **accepted-call stale sweep vs terminal webhook** boundary on the durable SQLite path. Force an accepted `queued`/`in_progress` attempt to become overdue while terminal webhook evidence races the stale transition; prove terminal completion cannot be overwritten and no false `call_attempt_stalled` event survives when terminal evidence wins.
2. Continue the `dispatchCallAttempt()` audit only with a reproducible competing transition. If a future/current path can mutate the same durable attempt while provider `start()` is in flight, add a deterministic race first and then re-read durable state before applying the create result; avoid speculative state-machine complexity otherwise.
3. Add process-restart coverage specifically around the reservation/acceptance boundary if a realistic restart interleaving can be modeled without pretending an in-flight network request survives process death. Recovery must reuse the original logical identity rather than create a replacement call.
4. Document fake-provider `rehydrate` behavior more explicitly in `docs/ARCHITECTURE.md`, separating deterministic local reconstruction from production CALL-E's remotely durable provider identity.
5. Continue auditing model-/operator-facing diagnostics and read projections for accidental task-context, owner-phone, bearer-token, webhook-token, callback-prompt, or instruction disclosure.
6. Run the documented acceptance in a genuine Claude Code host when that external prerequisite is available and record only observed host/version behavior.
7. When the user-controlled CALL-E prerequisites are available, perform one tightly bounded live provider acceptance and record only observed behavior.
