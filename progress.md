# CallYourAgent progress

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. Agents can request important owner decisions without freezing unrelated scopes; owners can independently request context-aware callbacks for progress/questions/steering; human input is persisted as structured state and consumed only at explicit safe checkpoints rather than pretending to interrupt in-flight model generation.

The repository includes deterministic fake and production CALL-E providers, SQLite persistence, replayable/idempotent call attempts, polling/webhook convergence, branch-scoped blocking, durable owner decisions, durable per-run instruction queues with exact acknowledgement, quiet hours/call budgets, bounded lifecycle recovery, fail-closed ambiguous/stalled handling, privacy-aware audit history, scoped HTTP authentication, a typed TypeScript client, a real stdio MCP adapter, deterministic end-to-end/demo flows, an operator console, a Claude Code host-acceptance runbook, and a single-instance persistent-volume Compose reference deployment.

This run completed the domain integration that PR #47 deliberately left for the next increment. PR #48 makes the first committed terminal provider outcome authoritative before terminal call state, owner decisions, or callback steering are applied. Stale workers now converge to that durable winner rather than overwriting it, and genuinely conflicting late provider evidence produces one privacy-safe audit event without persisting owner answers, steering text, transcripts, raw provider payloads, or the terminal fingerprint itself in audit metadata.

## Exact repo state inspected this run

The run started from `main` HEAD `14a23857eacc68dcbc3946b4e99c3ab154a8ea8f`, the progress handoff after PR #47 (`f4e1016b18610254a998d73324d57cc0c17b8438`).

Before making any change, inspected the complete recursive repository tree and current architecture, recent commit history, open issue state, and open pull-request state. There were no open issues and no pre-existing open pull requests.

Read in full during the mandatory pre-implementation audit:

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

Also inspected the complete source/test inventory and the relevant implementation surfaces, especially `src/control-plane.ts`, `src/store.ts`, `src/sqlite-store.ts`, `src/domain.ts`, `src/call-provider.ts`, `src/calle-provider.ts`, `tests/sqlite-poll-webhook-race.test.ts`, `tests/terminal-effect-claims.test.ts`, and the store transaction/claim tests.

The audit confirmed that `ControlPlaneStore.claimCallTerminalOutcome(...)` already existed and was atomically tested, but `ControlPlane.applyTerminalOutcome(...)` still trusted the local `CallAttempt` snapshot. A stale worker could therefore observe terminal provider evidence from an old entity view even though another worker had already committed the terminal winner. The new persistence primitive needed to become the domain transition boundary rather than remain an unused store-level contract.

The automation environment's direct GitHub clone path remained unavailable, so GitHub Actions was used as the authoritative executable verification path.

## Changes made this run

PR #48, `Make terminal provider outcomes authoritative`, changed `src/control-plane.ts`, `src/sqlite-store.ts`, and added `tests/sqlite-terminal-outcome-authority.test.ts` plus `tests/terminal-outcome-fingerprint.test.ts`.

### Authoritative terminal application

`ControlPlane.applyTerminalOutcome(...)` now claims non-ambiguous terminal evidence before mutating terminal `CallAttempt` state or downstream owner-decision/callback effects.

For a fresh winner:

1. the control plane computes a one-way semantic fingerprint;
2. `claimCallTerminalOutcome(...)` atomically establishes the first committed terminal winner;
3. only that winner transitions the call attempt;
4. only that winner can create/resolve the owner decision or materialize the callback instruction batch.

Ambiguous provider observations remain outside this terminal-claim path and continue through the bounded ambiguous-recovery semantics.

### Business-semantic terminal fingerprints

The terminal fingerprint intentionally excludes transport-only correlation shape. It fingerprints only state the control plane actually treats as terminal business effect:

- failed calls: terminal status only;
- completed owner-decision calls: normalized answer plus structured decision payload;
- completed owner callbacks: normalized instruction list.

Provider call id, callback structured metadata that the control plane does not consume, and failed-provider diagnostic payload shape are excluded. Nested structured decision objects are canonicalized before hashing so harmless object-key ordering differences between polling and webhook delivery do not create false conflicts.

This keeps the claim useful for distinguishing a genuine competing outcome without turning it into another sensitive provider-result store.

### Stale-worker convergence

For SQLite, a losing terminal claim now refreshes all durable entity/set mirrors before returning. This is important because a second SQLite connection can legitimately have pre-winner in-memory mirrors even though the winning transaction is already committed in SQL.

After refresh, a losing worker returns the authoritative terminal call state and does not apply its losing payload.

The first CI run also exposed an older intentional regression test that manually made the in-memory entity mirrors stale after a successful terminal commit. The initial PR implementation failed closed when it saw a durable terminal claim but a non-terminal local entity. That was too strict for the existing stale-worker contract.

The repair now allows local entity convergence from the terminal winner only when the already-durable effect identity proves the winner's downstream effects committed:

- completed owner decision requires the durable `decisionByEscalationId` winner and decision record, then restores the escalation to `resolved` with that exact decision id;
- failed owner decision restores the escalation to `failed`;
- completed owner callback requires the durable callback instruction-set claim before terminal call state is repaired;
- no losing payload is used to reconstruct owner content.

If the terminal claim says a completed effect won but the corresponding durable effect identity is absent, the control plane still fails closed instead of fabricating a decision or callback steering batch.

### Privacy-safe terminal conflict audit

A genuinely different losing terminal observation now emits at most one `call_attempt_terminal_conflict` event for that call attempt.

The event records only:

- winning terminal status;
- observed losing terminal status;
- a boolean indicating whether the semantic payload fingerprint differed.

It does not record either fingerprint, owner answer, instruction text, transcript, raw CALL-E body, phone data, credentials, or provider diagnostics.

Repeated conflicting deliveries remain converged and do not spam duplicate terminal-conflict audit events.

### Independent-store and semantic regressions

`tests/sqlite-terminal-outcome-authority.test.ts` proves with two independent SQLite connections that:

- one worker can commit a completed owner decision while another still sees the call as queued;
- a later failed observation on the stale worker cannot change the call from completed to failed;
- the escalation remains resolved to the original durable decision;
- the blocked scope stays released;
- only one decision exists;
- one privacy-safe conflict event is emitted;
- repeated conflicting events stay converged;
- two different completed callback payloads cannot replace the first committed steering batch.

`tests/terminal-outcome-fingerprint.test.ts` proves that semantically equivalent terminal evidence does not create false conflict events when:

- provider correlation is present in one delivery and absent in another;
- structured decision object keys arrive in a different order;
- callback-only provider metadata differs but the instructions are identical;
- failed-provider diagnostic structure differs while the control-plane terminal effect is still the same failure.

PR #48 was squash-merged into `main` as `f5699b9616edc2a04e3e3ce56fc109fa7689f0e0`.

## Verification performed

The first CI attempt on the initial PR implementation (`34577532099`) correctly failed two existing stale-mirror regression tests: **206/208 passed**. Both failures were `tests/terminal-effect-claims.test.ts`, revealing that the first implementation treated a winning terminal claim plus intentionally stale in-memory entity mirrors as an impossible state. The implementation was repaired rather than weakening or deleting those tests.

A subsequent CI run after the convergence repair passed the complete existing suite, and the final authoritative verification ran against PR head `81f53be43a771fb45394b08a844e20fe6bce82e3` after adding semantic-fingerprint coverage:

- CI run `34577920128` — **success**. Node `24.20.0`, locked dependency installation, TypeScript typecheck, build, and the complete suite all succeeded: **210/210 tests passed**, 0 failed/skipped/cancelled.
- Container run `34577920168` — **success**. The production image built and the fake-provider runtime smoke test passed.
- Compose deployment run `34577920104` — **success**. The full deployed path remained green, including scoped credentials, Compose validation, fake-provider readiness, compiled stdio MCP, durable branch-blocking decision behavior, restart recovery, branch-specific release, owner callback recovery, exactly-once steering, persistence restart, and explicit safe-checkpoint consumption.

`package.json` still has no separate lint script and no standalone migration/schema-check command. The normal CI path covers the available typecheck/build/test checks; the SQLite tests exercise schema creation, transaction semantics, independent connections, and durable state convergence; Container and Compose verify packaged/deployed behavior.

CodeRabbit did not perform an automatic review on PR #48 because the repository currently falls below its automatic-review star threshold; there were no human review submissions or inline review threads.

No live CALL-E phone call was attempted or claimed.

## Architecture decisions made this run

1. `claimCallTerminalOutcome(...)` is now the authoritative boundary for applying non-ambiguous terminal provider evidence, not merely a future store primitive.
2. First committed terminal evidence wins. A losing worker must converge to the winner and must never apply its losing owner answer or steering payload.
3. Terminal identity is based on the business effect CallYourAgent actually consumes, not transport representation. Transport-only provider correlation and ignored metadata cannot create false conflict alarms.
4. A stale entity mirror may be repaired from the terminal winner only when durable downstream effect identity proves the winning transaction's effect already exists. Missing proof fails closed.
5. SQLite losing claims refresh all local mirrors so a second connection observes the winning committed state before the control plane returns.
6. Terminal conflict audit is metadata-only and deduplicated per call attempt. Fingerprints are comparison material, not audit material.
7. Provider/network I/O remains outside database transactions. Terminal claim plus local state/effect application remains inside the store transaction boundary.
8. Existing branch-scoped blocking semantics are unchanged: only the affected scope waits, unrelated work can continue, and a winning owner decision releases only its associated blocked scope.
9. Callback steering remains durable queued state and is still consumed only at explicit safe checkpoints; no mid-token/model interruption is claimed.
10. The current SQLite reference deployment remains intentionally single-instance. Independent-connection tests define required shared-store semantics; they do not advertise horizontal-scale readiness.

## CALL-E integration status

- **Fake provider:** deterministic, credential-free, idempotent, restart-rehydratable, and still the complete acceptance provider. The full fake end-to-end path remains green after the terminal-authority changes.
- **Production CALL-E adapter:** implemented against the asynchronous Calls API with server-only `CALLE_API_KEY`, stable provider `Idempotency-Key`, structured result schemas, bounded create/poll requests, persisted correlation, polling/webhook convergence, duplicate-call prevention, restart-by-provider-id semantics, privacy-safe diagnostics, fail-closed ambiguous/stalled handling, and strict authenticated base-URL validation.
- **Terminal reconciliation:** polling and webhook terminal evidence now share the same first-committed-winner domain boundary. Conflicting late evidence cannot replace the winning call status, owner decision, or callback steering.
- **Control-plane persistence:** request idempotency, webhook deduplication, owner-decision identity, callback instruction-set identity, and terminal provider-outcome identity are all durable and rollback-safe.
- **Owner decisions:** branch-scoped blocking remains intact; one durable decision identity survives duplicate/stale terminal application; a conflicting failed observation cannot re-block or fail a scope after a completed decision won.
- **Owner callbacks:** callbacks snapshot current run context; steering becomes durable queued state; one terminal callback can materialize at most one steering batch; a conflicting completed payload cannot replace the first batch.
- **Shared surfaces:** HTTP, typed SDK, stdio MCP, lifecycle worker, operator console, and Compose deployment still exercise the same control-plane state machine.
- **Checkpoint semantics:** human steering is incorporated only at explicit safe work boundaries; no mid-token interruption is claimed.
- **Claude Code:** compiled stdio MCP behavior is exercised automatically, but a genuine Claude Code host session has still not been observed and is not claimed.
- **Live status:** no authorized real CALL-E phone call has been performed, so live provider connectivity, owner-phone authorization, and public webhook reachability remain unverified.

## Current blockers / external prerequisites

No repository-development blocker prevents further useful work.

A true Claude Code host acceptance still requires an actual Claude Code environment/CLI to register and exercise the compiled stdio MCP server.

Live CALL-E verification still requires user-controlled prerequisites: a valid/authorized CALL-E credential, an authorized owner phone destination, and a stable externally reachable HTTPS origin whose ingress does not log the webhook capability query string.

The SQLite reference topology remains intentionally single-instance. Multi-instance deployment still requires a future shared transactional store plus shared rate limiter preserving all current transaction, uniqueness, idempotency, freshness, terminal-winner, audit, and rate-limit semantics.

## Highest-value next actions

1. Continue the shared-store freshness/CAS audit beyond terminal application. In particular, identify call/escalation/run transitions that still perform read-modify-write against potentially stale entity snapshots and turn the required winner/freshness behavior into explicit store contracts and race tests.
2. Audit audit-event sequencing for a future shared store. The current `max(sequence) + 1` calculation is safe for the supported single-process topology but is not itself a multi-writer allocation primitive; define the shared-store requirement without pretending current SQLite deployment is distributed.
3. Continue runtime string-configuration hardening for provider/store selectors, priority settings, IANA timezone text, and secret/phone whitespace handling where ambiguity can change behavior.
4. Continue HTTP body semantic auditing and least-privilege review without widening normal agent, owner, or browser credentials.
5. Extend provider-specific reconciliation regressions where useful so CALL-E polling/webhook representations continue to normalize to the same business-terminal identity while real conflicts remain observable.
6. Preserve the deterministic fake-provider acceptance path while improving operator/demo presentation only after correctness changes remain green.
7. Run the documented acceptance in a genuine Claude Code host when that external prerequisite is available.
8. When the user-controlled CALL-E prerequisites are available, perform one tightly bounded live provider acceptance and record only observed behavior.
