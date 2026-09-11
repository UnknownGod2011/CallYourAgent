# CallYourAgent progress

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. Agents can request important owner decisions without freezing unrelated scopes; owners can independently request context-aware callbacks for progress/questions/steering; human input is persisted as structured state and consumed only at explicit safe checkpoints rather than pretending to interrupt in-flight model generation.

The repository includes deterministic fake and production CALL-E providers, SQLite persistence, replayable/idempotent call attempts, polling/webhook convergence, branch-scoped blocking, durable owner decisions, durable per-run instruction queues with exact acknowledgement, quiet hours/call budgets, bounded lifecycle recovery, fail-closed ambiguous/stalled handling, privacy-aware audit history, scoped HTTP authentication, a typed TypeScript client, a real stdio MCP adapter, deterministic end-to-end/demo flows, an operator console, a Claude Code host-acceptance runbook, and a single-instance persistent-volume Compose reference deployment.

This run completed the next concurrency/idempotency increment after PR #45. PR #46 makes terminal side-effect identity explicit in the store contract: one durable owner-decision identity per escalation and one callback-derived instruction batch per terminal callback attempt. The control plane now consumes those claims during terminal reconciliation so stale/competing terminal deliveries do not rely only on already-terminal entity status for correctness.

## Exact repo state inspected this run

The run started from `main` HEAD `28fa9463505b86bf01dd6065920e3f265061c18f`, the progress handoff after PR #45 (`73f43fdc598431636702ffd33fb677bf4d17e678`).

Before making any change, inspected the complete recursive repository tree/current architecture, recent commits, open issue state, and open PR state. There were no open issues and no pre-existing open pull requests.

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

Also inspected the relevant implementation/test surface, especially `src/control-plane.ts`, `src/store.ts`, `src/sqlite-store.ts`, `src/domain.ts`, `tests/store-transaction-contract.test.ts`, `tests/reconciliation-overlap-concurrency.test.ts`, and the complete test inventory.

The audit confirmed that PR #45 correctly moved request idempotency and webhook deduplication onto atomic store primitives, while terminal owner-decision creation and callback instruction creation still depended primarily on fresh call/escalation terminal status. That is safe in the current single-process topology, but it left an implicit contract for any future shared transactional store.

The automation container's direct GitHub DNS path remained unavailable for a local clone, so GitHub Actions was used as the authoritative executable verification path.

## Changes made this run

PR #46, `Enforce exactly-once terminal effect claims`, changed `src/control-plane.ts`, `src/store.ts`, `src/sqlite-store.ts`, extended `tests/store-transaction-contract.test.ts`, and added `tests/terminal-effect-claims.test.ts`.

### Explicit decision identity

`ControlPlaneStore` now exposes `bindDecisionToEscalation(escalationId, decisionId)`. It is an atomic first-writer-wins binding that returns the durable winning decision id.

Both the in-memory and SQLite stores implement the same contract. SQLite persists the binding in `decision_by_escalation`, and the decisions table now also has a unique index on `$.escalationId` so direct persistence cannot create two durable owner decisions for one escalation.

During a completed owner-decision terminal outcome, the control plane creates a candidate decision id and claims the escalation-to-decision identity before persisting the candidate. A losing/stale path converges on the winning decision id and releases the blocked escalation against that durable identity instead of creating a second decision or second `owner_decision_recorded` effect.

### Exactly-once callback instruction batch

`ControlPlaneStore` now also exposes `claimCallbackInstructionSet(callAttemptId)`. It atomically claims the right to materialize callback-derived steering for one terminal callback attempt.

Both stores implement the same rollback-safe contract. SQLite persists the claim in `callback_instruction_sets`.

On a completed owner callback, the control plane now claims the instruction batch before queuing any callback instructions. A repeated/stale terminal application may still converge the call-attempt status, but it cannot create a second steering batch or duplicate `owner_instruction_queued` effects.

The claim is taken even for an empty provider instruction list. This deliberately makes the first committed terminal callback result authoritative; a later conflicting terminal delivery cannot manufacture steering that was absent from the committed result.

### Rollback and cross-connection contract

The in-memory transaction snapshot now includes both new terminal-effect claim collections. SQLite transaction reload/rollback coverage includes them as well.

`tests/store-transaction-contract.test.ts` now proves for both adapters that:

- decision bindings are first-writer-wins;
- callback instruction-batch claims succeed only once;
- failed outer transactions release both kinds of claims;
- committed claims survive SQLite close/reopen;
- two independent SQLite store connections observe the same committed winner/claim.

These independent-connection assertions are contract probes only; they do not change the documented single-instance SQLite deployment topology.

### Stale terminal-state regressions

`tests/terminal-effect-claims.test.ts` adds two domain regressions that deliberately reset already-completed entity status to simulate a stale worker after the first terminal effects have committed.

For owner decisions, a second terminal delivery converges the escalation back to the already-claimed decision id without creating another decision or another owner-decision effect.

For callbacks, a second terminal delivery with the same steering cannot create another instruction batch even when the call-attempt status is artificially stale. The original instructions remain queued for explicit safe-checkpoint handling.

PR #46 was squash-merged into `main` as `9f0a3a39924b981b96dbe279700adda4fbcb036c`.

## Verification performed

Authoritative verification ran against PR head `0163727f59009c194c273661409b7aed4de86330`:

- CI run `34568457958` — **success**. Node 24 setup and locked dependency installation succeeded; the repository `Typecheck and test` step completed successfully, covering TypeScript typechecking, build, and the complete test suite including the new terminal-effect regressions.
- Container run `34568457989` — **success**. The production image built successfully and the fake-provider runtime smoke test passed.
- Compose deployment run `34568457966` — **success**. The full durable acceptance path remained green: scoped deployment credentials, Compose validation, fake-provider deployment, health check, compiled stdio MCP against the deployed control plane, branch-blocking owner decision, restart while the decision call was active, branch-specific release after reconciliation, context-aware owner callback, restart while the callback was active, exactly-once steering, another persistence restart, and explicit safe-checkpoint consumption.

`package.json` still has no separate lint script and no standalone migration/schema-check command. The CI check covers the available typecheck/build/test path, SQLite regressions exercise schema and transaction behavior, and Container/Compose cover packaged runtime/deployment behavior.

No live CALL-E phone call was attempted or claimed.

## Architecture decisions made this run

1. Terminal mutation identity is now a persistence contract, not merely a consequence of reading an already-terminal entity status.
2. One escalation can bind to only one durable owner-decision id. The SQLite schema independently enforces one decision row per escalation as defense in depth.
3. One owner-callback call attempt can materialize at most one callback-derived instruction batch. The batch claim and queued instructions execute within the same outer store transaction, so rollback releases the claim together with any partial local effects.
4. Provider/network I/O remains outside database transactions. These new claims only protect durable local terminal application after a provider observation/webhook has already been obtained.
5. The first committed terminal effect remains authoritative. Later duplicate/conflicting terminal deliveries converge rather than replacing the committed owner decision or steering batch.
6. The current SQLite deployment remains intentionally single-instance. A future Postgres/shared-store adapter must preserve atomic claim/transaction semantics and also provide authoritative/fresh reads across workers; this PR does not claim horizontal-scale readiness by itself.
7. HTTP, TypeScript SDK, MCP, privacy, branch-blocking, and explicit safe-checkpoint contracts are unchanged.

## CALL-E integration status

- **Fake provider:** deterministic, credential-free, idempotent, restart-rehydratable, and still the primary complete acceptance provider.
- **Production CALL-E adapter:** implemented against the asynchronous Calls API with server-only `CALLE_API_KEY`, stable provider `Idempotency-Key`, structured result schemas, bounded create/poll requests, persisted correlation, polling/webhook convergence, duplicate-call prevention, restart-by-provider-id semantics, privacy-safe diagnostics, fail-closed ambiguous/stalled handling, and the strict authenticated CALL-E base-URL trust boundary.
- **Control-plane persistence:** in-memory and SQLite adapters share rollback-safe request claims, webhook-event claims, owner-decision identity claims, and callback instruction-batch claims. SQLite remains the durable single-instance reference store.
- **Owner decisions:** branch-scoped blocking remains intact; non-blocked work continues while an escalation is pending; one durable decision identity now survives duplicate/stale terminal application.
- **Owner callbacks:** callbacks still receive current run context; owner steering is durable queued state; one terminal callback can materialize only one steering batch.
- **Shared surfaces:** HTTP, TypeScript SDK, stdio MCP, lifecycle worker, operator console, and Compose acceptance still share the same persistent control-plane state machine.
- **Checkpoint semantics:** steering is consumed only at explicit safe work boundaries; the system never claims to interrupt in-flight token generation.
- **Claude Code:** compiled stdio MCP behavior remains covered automatically and through Compose acceptance. A genuine Claude Code host session has still not been observed and is not claimed.
- **Live status:** no authorized real CALL-E phone call has been performed, so real provider connectivity, owner-phone authorization, and externally reachable webhook delivery remain unverified.

## Current blockers / external prerequisites

No repository-development blocker prevents further useful work.

A true Claude Code host acceptance still requires an actual Claude Code environment/CLI to register and exercise the compiled stdio MCP server.

Live CALL-E verification still requires user-controlled prerequisites: a valid/authorized CALL-E credential, an authorized owner phone destination, and a stable externally reachable HTTPS origin whose ingress does not log the webhook capability query string.

The SQLite reference topology remains intentionally single-instance. Multi-instance deployment still requires a future shared transactional store plus shared rate limiter preserving the current state-machine, transaction, uniqueness, idempotency, freshness, and rate-limit semantics.

## Highest-value next actions

1. Add executable terminal-effect conflict semantics for genuinely conflicting completed outcomes (for example two completed owner-decision payloads racing) so the first durable winner is explicit and later conflicting data is safely ignored/audited rather than merely relying on normal single-process freshness.
2. Continue the shared-store contract audit around authoritative refresh/CAS semantics for call-attempt and escalation terminal state so a future Postgres adapter cannot reintroduce stale-read lost updates even though terminal side effects are now unique.
3. Continue runtime string-configuration hardening where ambiguity can change operational behavior: provider/store selectors, priority settings, IANA timezone text, and secret/phone whitespace handling should be explicitly canonical or explicitly rejected.
4. Continue the HTTP request-body semantic audit for required identity/text fields and exact instruction acknowledgement boundaries while preserving harmless forward compatibility.
5. Continue least-privilege review of owner/operator/reconciler surfaces without widening browser or normal-agent credentials.
6. Run the documented acceptance in a genuine Claude Code host when that external prerequisite is available and record only observed host/version behavior.
7. When the user-controlled CALL-E prerequisites are available, perform one tightly bounded live provider acceptance and record only observed behavior.
