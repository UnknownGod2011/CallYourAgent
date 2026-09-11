# CallYourAgent progress

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. Agents can request important owner decisions without freezing unrelated scopes; owners can independently request context-aware callbacks for progress/questions/steering; human input is persisted as structured state and consumed only at explicit safe checkpoints rather than pretending to interrupt in-flight model generation.

The repository includes deterministic fake and production CALL-E providers, SQLite persistence, replayable/idempotent call attempts, polling/webhook convergence, branch-scoped blocking, durable owner decisions, durable per-run instruction queues with exact acknowledgement, quiet hours/call budgets, bounded lifecycle recovery, fail-closed ambiguous/stalled handling, privacy-aware audit history, scoped HTTP authentication, a typed TypeScript client, a real stdio MCP adapter, deterministic end-to-end/demo flows, an operator console, a Claude Code host-acceptance runbook, and a single-instance persistent-volume Compose reference deployment.

This run completed the next shared-store concurrency contract after PR #46. PR #47 makes the terminal provider outcome itself an explicit first-writer-wins persistence claim. A call attempt can now bind to one durable terminal status plus a one-way payload fingerprint, giving a future multi-worker/shared-store control plane an authoritative primitive for resolving competing completed/failed observations without storing another copy of sensitive provider result content.

## Exact repo state inspected this run

The run started from `main` HEAD `3c6f34ce9144effec88125600b432be20c77a07f`, the progress handoff after PR #46 (`9f0a3a39924b981b96dbe279700adda4fbcb036c`).

Before making any change, inspected the complete recursive repository tree and current architecture, the recent commit history, open issue state, and open pull-request state. There were no open issues and no pre-existing open pull requests.

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

Also inspected the complete source/test inventory and the relevant implementation surface, especially `src/control-plane.ts`, `src/store.ts`, `src/sqlite-store.ts`, `src/domain.ts`, `src/call-provider.ts`, and `tests/store-transaction-contract.test.ts`.

The audit confirmed that PR #46 made terminal owner-decision and callback steering side effects exactly-once, but a future stale worker could still hold a pre-terminal `CallAttempt` snapshot while another worker had already committed a terminal status. Without an explicit authoritative terminal-result claim, a shared-store implementation could reintroduce a stale-write conflict even though duplicate decisions/instructions were already prevented.

The automation environment's direct GitHub clone path remained unavailable, so GitHub Actions was used as the authoritative executable verification path.

## Changes made this run

PR #47, `Define authoritative terminal outcome claim contract`, changed `src/store.ts`, `src/sqlite-store.ts`, `src/domain.ts`, and `tests/store-transaction-contract.test.ts`.

### First-committed terminal outcome contract

`ControlPlaneStore` now exposes `claimCallTerminalOutcome(callAttemptId, claim)`.

The claim contains only:

- terminal status: `completed` or `failed`;
- a one-way payload fingerprint.

The first committed claim wins atomically. Later attempts receive the already-durable winner and `claimed: false`. The fingerprint exists only to distinguish identical replay from genuinely conflicting terminal payloads during the next control-plane integration step; it avoids persisting the owner answer, callback instructions, transcript material, or another provider result copy in the claim table.

### In-memory and SQLite implementations

The in-memory store includes terminal claims in its outer transaction snapshot, so a failed transaction releases a tentative claim together with all other domain mutations.

SQLite persists terminal claims in the new `call_terminal_outcomes` table with `key` as the call-attempt primary key. `INSERT OR IGNORE` plus a readback establishes the durable winner. The map is part of the store reload set, so rollback restores the in-memory mirror to committed SQL state.

### Executable adapter contract

`tests/store-transaction-contract.test.ts` now proves for both store adapters that:

- the first terminal claim wins;
- a later conflicting completed/failed claim returns the original winner;
- a failed outer transaction releases its tentative terminal claim;
- committed terminal claims survive SQLite close/reopen;
- two independent SQLite store connections converge on the same committed terminal winner.

These independent-connection checks remain contract probes only. The supported deployment is still one control-plane process plus SQLite; PR #47 does not claim horizontal-scale readiness.

### Conflict audit vocabulary

`AuditEventType` now reserves `call_attempt_terminal_conflict` for the next domain integration. That event is intentionally not emitted yet because `ControlPlane.applyTerminalOutcome` has not been migrated to consume the new claim in this increment. When wired, it must remain privacy-safe and report only operational conflict metadata, never owner answers or instruction content.

PR #47 was squash-merged into `main` as `f4e1016b18610254a998d73324d57cc0c17b8438`.

## Verification performed

Authoritative verification ran against PR head `55e550f2c713869b7c4142dce3431a0655e84d1f`:

- CI run `34572937799` — **success**. Node `24.20.0`, locked dependency installation, TypeScript typecheck, build, and the complete suite all succeeded: **206/206 tests passed**, 0 failed/skipped/cancelled.
- Container run `34572937827` — **success**. The production image built and the fake-provider runtime smoke test passed.
- Compose deployment run `34572937806` — **success**. Scoped credential generation, Compose validation, fake-provider boot/readiness, compiled stdio MCP, durable branch-blocking owner decision, restart while the decision call remained active, branch-specific release, context-aware owner callback, restart while callback active, exactly-once steering, another persistence restart, and explicit safe-checkpoint consumption all passed.

`package.json` still has no separate lint script and no standalone migration/schema-check command. The normal CI path covers the available typecheck/build/test checks; the SQLite contract test exercised the new schema/table and rollback/reopen behavior; Container and Compose verified packaged/deployed behavior.

No live CALL-E phone call was attempted or claimed.

## Architecture decisions made this run

1. Terminal provider state needs its own authoritative durable identity, separate from exactly-once downstream decision/instruction effects.
2. The first committed terminal outcome will be authoritative for a call attempt. A stale worker must converge to that winner rather than overwrite it.
3. The terminal claim stores status plus a one-way fingerprint only. It must not become a second transcript/result store.
4. Terminal claims participate in the same transaction/rollback semantics as the rest of the control-plane state.
5. A future shared-store/Postgres adapter must implement this first-writer-wins behavior atomically across workers, not emulate it with a read-then-write sequence.
6. Provider/network I/O remains outside database transactions. The claim is for applying already-observed terminal evidence safely inside the durable local state transition.
7. The current SQLite reference deployment remains intentionally single-instance; independent-connection tests define semantics rather than advertising distributed deployment support.
8. HTTP, TypeScript SDK, MCP, branch-scoped blocking, owner-callback flow, privacy boundaries, and safe-checkpoint instruction handling are unchanged.

## CALL-E integration status

- **Fake provider:** deterministic, credential-free, idempotent, restart-rehydratable, and still the complete acceptance provider.
- **Production CALL-E adapter:** implemented against the asynchronous Calls API with server-only `CALLE_API_KEY`, stable provider `Idempotency-Key`, structured result schemas, bounded create/poll requests, persisted correlation, polling/webhook convergence, duplicate-call prevention, restart-by-provider-id semantics, privacy-safe diagnostics, fail-closed ambiguous/stalled handling, and strict authenticated base-URL validation.
- **Control-plane persistence:** both adapters now share rollback-safe request-idempotency claims, webhook claims, owner-decision identity claims, callback instruction-set claims, and terminal provider-outcome claims.
- **Owner decisions:** branch-scoped blocking remains intact and one durable decision identity survives duplicate/stale terminal application.
- **Owner callbacks:** callbacks snapshot current run context; steering becomes durable queued state; one terminal callback can materialize at most one steering batch.
- **Shared surfaces:** HTTP, typed SDK, stdio MCP, lifecycle worker, operator console, and Compose deployment still exercise the same control-plane state machine.
- **Checkpoint semantics:** human steering is incorporated only at explicit safe work boundaries; no mid-token interruption is claimed.
- **Claude Code:** compiled stdio MCP behavior is exercised automatically, but a genuine Claude Code host session has still not been observed and is not claimed.
- **Live status:** no authorized real CALL-E phone call has been performed, so live provider connectivity, owner-phone authorization, and public webhook reachability remain unverified.

## Current blockers / external prerequisites

No repository-development blocker prevents further useful work.

A true Claude Code host acceptance still requires an actual Claude Code environment/CLI to register and exercise the compiled stdio MCP server.

Live CALL-E verification still requires user-controlled prerequisites: a valid/authorized CALL-E credential, an authorized owner phone destination, and a stable externally reachable HTTPS origin whose ingress does not log the webhook capability query string.

The SQLite reference topology remains intentionally single-instance. Multi-instance deployment still requires a future shared transactional store plus shared rate limiter preserving all current transaction, uniqueness, idempotency, freshness, terminal-winner, and rate-limit semantics.

## Highest-value next actions

1. Migrate `ControlPlane.applyTerminalOutcome` to claim the terminal result before writing terminal call-attempt/domain state. A stale losing worker must converge the `CallAttempt` to the durable winner instead of overwriting it.
2. Add domain-level independent-SQLite-connection race regressions for genuinely conflicting terminal observations: completed-vs-failed owner decisions and same-status/different-payload callback steering. Prove first committed state/decision/instruction content remains authoritative.
3. Emit one privacy-safe `call_attempt_terminal_conflict` audit event for genuinely different losing terminal evidence without copying fingerprints, answers, transcripts, or steering text into audit metadata.
4. Continue the shared-store contract audit for authoritative refresh/CAS semantics on escalation/call-attempt transitions beyond terminal application so a future Postgres adapter cannot reintroduce stale-read lost updates.
5. Continue runtime string-configuration hardening for provider/store selectors, priority settings, IANA timezone text, and secret/phone whitespace handling where ambiguity changes behavior.
6. Continue HTTP body semantic auditing and least-privilege review without widening normal agent or browser credentials.
7. Run the documented acceptance in a genuine Claude Code host when that external prerequisite is available.
8. When the user-controlled CALL-E prerequisites are available, perform one tightly bounded live provider acceptance and record only observed behavior.
