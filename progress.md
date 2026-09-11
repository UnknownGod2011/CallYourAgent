# CallYourAgent progress

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. Agents can request important owner decisions without freezing unrelated scopes; owners can independently request context-aware callbacks for progress/questions/steering; human input is persisted as structured state and consumed only at explicit safe checkpoints rather than pretending to interrupt in-flight model generation.

The repository includes deterministic fake and production CALL-E providers, SQLite persistence, replayable/idempotent call attempts, polling/webhook convergence, branch-scoped blocking, durable owner decisions, durable per-run instruction queues with exact acknowledgement, quiet hours/call budgets, bounded lifecycle recovery, fail-closed ambiguous/stalled handling, privacy-aware audit history, scoped HTTP authentication, a typed TypeScript client, a real stdio MCP adapter, deterministic end-to-end/demo flows, an operator console, a Claude Code host-acceptance runbook, and a single-instance persistent-volume Compose reference deployment.

This run completed the audit-sequencing hardening identified by the previous handoff. PR #49 moves canonical audit sequence assignment behind the store persistence boundary so independent durable writers cannot publish duplicate causal positions merely because their in-memory mirrors are stale. The in-memory implementation is rollback-aware, SQLite uses a transactionally updated singleton sequence allocator, and existing databases initialize that allocator above the greatest persisted sequence.

## Exact repo state inspected this run

The run started from `main` HEAD `7010ab714513f368a7acd53a4e7ac1296c4f7612`, the progress handoff after PR #48 (`f5699b9616edc2a04e3e3ce56fc109fa7689f0e0`).

Before making any change, inspected the complete recursive repository tree, current architecture/source/test inventory, recent commit history, open issue state, and open pull-request state. There were no open issues and no pre-existing open pull requests.

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

Also inspected the relevant implementation and regression surfaces, especially `src/control-plane.ts`, `src/store.ts`, `src/sqlite-store.ts`, `src/domain.ts`, `tests/audit-timeline.test.ts`, and the existing store transaction/atomic-claim tests.

The audit confirmed that `ControlPlane.audit(...)` still derived the next sequence by scanning its local `auditEvents` mirror for `max(sequence) + 1`. That is sufficient for the supported one-process SQLite deployment, but it is not a valid future multi-writer contract: two independent workers can hold stale mirrors and calculate the same causal position. This run therefore made the durable store responsible for canonical sequence assignment instead of relying on process-local observation.

The automation environment did not provide a usable direct repository clone/runtime path, so GitHub Actions remained the authoritative executable verification path.

## Changes made this run

PR #49, `Make audit sequence allocation atomic`, changed `src/store.ts`, `src/sqlite-store.ts`, and added `tests/audit-sequence-concurrency.test.ts`.

### Store-owned canonical audit ordering

`ControlPlaneStore.auditEvents` now has an explicit contract: when a new audit event id is inserted, the store assigns the canonical monotonically increasing sequence. The sequence value constructed by the control plane is therefore provisional; durable ordering is owned by the persistence adapter where cross-writer coordination belongs.

This keeps the public/domain `AuditEvent` shape unchanged while preventing a future shared store from accidentally inheriting the old local-mirror `max + 1` behavior.

### Rollback-safe in-memory allocator

`InMemoryControlPlaneStore` now uses a specialized audit-event map backed by a `nextAuditSequence` counter.

For a new event id:

1. the store allocates the next sequence;
2. the event is stored with that canonical sequence;
3. the sequence counter is included in the outer transaction snapshot;
4. rollback restores both the event map and the counter.

Rollback restoration bypasses the custom audit setter so restoring a snapshot cannot allocate fresh sequence values accidentally.

Existing event ids preserve their already-assigned sequence rather than moving in the causal timeline.

### SQLite singleton sequence allocator

SQLite now persists one allocator row in an `audit_sequence` table. New audit-event insertion obtains the next sequence through a single database update using `UPDATE ... RETURNING`, then stores the event with that canonical value.

Because normal SQLite domain transactions use `BEGIN IMMEDIATE`, sequence allocation made inside a domain transaction participates in the same commit/rollback unit as the audited mutation. A failed transaction therefore does not permanently burn or publish the rolled-back sequence allocation.

The migration is backward-compatible with existing databases. On startup it creates the singleton allocator if absent and advances it to at least one greater than the largest sequence already present in `audit_events`. An upgraded database therefore continues ordering after its existing durable history rather than restarting at one.

The allocator guarantees unique monotonically increasing durable positions; the architecture does not require a gap-free sequence in the face of every possible process failure outside a broader transaction.

### Independent-writer regressions

`tests/audit-sequence-concurrency.test.ts` adds two focused contracts:

- the in-memory allocator rolls back with its enclosing transaction, and the next committed event receives sequence `1` rather than leaking the rolled-back allocation;
- two independently opened SQLite stores can write audit events while holding different local mirrors and still receive one durable sequence stream. The test exercises alternating writers, a rolled-back allocation, close/reopen, and verifies the final committed order is exactly `[1, 2, 3, 4]` with no duplicate positions.

This is an executable shared-store requirement, not a claim that the current SQLite reference topology should be horizontally scaled.

PR #49 was squash-merged into `main` as `10337d02129d761c930fa9c97c11046e915c6f55`.

## Verification performed

Final authoritative verification ran against PR head `1cb82cf11fa350f03ba15fa3ed2835dcbb828d82`:

- CI run `34582157458` — **success**. GitHub Actions used Node `24.20.0`, installed locked dependencies, ran TypeScript typecheck, built the repository, and executed the complete test suite: **212/212 tests passed**, 0 failed/cancelled/skipped.
- The new regressions passed explicitly: `in-memory audit sequence allocation rolls back with the transaction` and `independent SQLite writers allocate one durable monotonic audit sequence`.
- Container run `34582157502` — **success**. The production container path remained green.
- Compose deployment run `34582157515` — **success**. It validated scoped deployment credentials and Compose config, booted the fake-provider deployment, verified readiness and the compiled stdio MCP path, created a durable branch-blocking decision, restarted while the decision call remained active, reconciled it and released only the blocked branch, requested a context-aware callback, restarted while that callback remained active, completed restored callback steering exactly once, restarted again after steering became durable, and consumed it only at an explicit safe checkpoint.
- There were no PR review submissions or inline review threads requiring changes.

`package.json` still has no separate lint script and no standalone migration/schema-check command. The normal `npm run check` path covers available typecheck/build/test verification; SQLite tests exercise migration/schema creation, rollback semantics, reopen durability, and independent connections; Container and Compose verify packaged/deployed behavior.

No live CALL-E phone call was attempted or claimed.

## Architecture decisions made this run

1. Canonical audit-event sequence allocation belongs to the persistence layer, not to a control-plane process's local entity mirror.
2. Every future `ControlPlaneStore` adapter must provide one globally serialized durable audit ordering for the writers it supports; local `max(sequence) + 1` is not sufficient for a shared store.
3. Audit sequence allocation must participate in store transaction rollback whenever the audited domain mutation is transactional.
4. Existing audit-event identity remains append-oriented: rewriting an existing event id must not assign it a different causal position.
5. SQLite upgrades derive the allocator floor from persisted audit history so schema evolution cannot reset or collide with old sequences.
6. Independent SQLite connection tests are used to define concurrency semantics, but the supported deployment remains one Node process + one SQLite volume + process-local rate limiting. This PR does not claim multi-instance production readiness.
7. Provider/network I/O behavior is unchanged. CALL-E calls remain outside database transactions, while durable local mutations/audit units use the store boundary where required.
8. Existing branch-scoped blocking semantics are unchanged: only the affected scope waits and unrelated work can continue.
9. Callback steering remains durable queued state consumed only at safe checkpoints; no mid-token/model interruption is claimed.
10. The next shared-store hardening work should focus on stale entity read-modify-write transitions rather than widening the current SQLite deployment topology.

## CALL-E integration status

- **Fake provider:** deterministic, credential-free, idempotent, restart-rehydratable, and still the complete acceptance provider. The full fake end-to-end deployment path remains green after the audit-ordering change.
- **Production CALL-E adapter:** implemented against the asynchronous Calls API with server-only `CALLE_API_KEY`, stable provider `Idempotency-Key`, structured result schemas, bounded create/poll requests, persisted correlation, polling/webhook convergence, duplicate-call prevention, restart-by-provider-id semantics, privacy-safe diagnostics, fail-closed ambiguous/stalled handling, and strict authenticated base-URL validation.
- **Terminal reconciliation:** polling and webhook terminal evidence share the same first-committed-winner boundary. Conflicting late evidence cannot replace the winning call status, owner decision, or callback steering.
- **Control-plane persistence:** request idempotency, webhook deduplication, owner-decision identity, callback instruction-set identity, terminal provider-outcome identity, transaction rollback, and now canonical durable audit ordering have explicit tested store semantics.
- **Owner decisions:** branch-scoped blocking remains intact and only the affected scope releases when its durable decision arrives.
- **Owner callbacks:** callbacks snapshot current run context; steering becomes durable queued state and one terminal callback materializes at most one steering batch.
- **Shared surfaces:** HTTP, typed SDK, stdio MCP, lifecycle worker, operator console, and Compose deployment continue to exercise the same control-plane state machine.
- **Checkpoint semantics:** human steering is incorporated only at explicit safe work boundaries; no mid-token interruption is claimed.
- **Claude Code:** the compiled stdio MCP behavior is exercised automatically, including restart behavior, but a genuine Claude Code host session has still not been observed and is not claimed.
- **Live status:** no authorized real CALL-E phone call has been performed, so live provider connectivity, owner-phone authorization, and public webhook reachability remain unverified.

## Current blockers / external prerequisites

No repository-development blocker prevents further useful work.

A true Claude Code host acceptance still requires an actual Claude Code environment/CLI to register and exercise the compiled stdio MCP server.

Live CALL-E verification still requires user-controlled prerequisites: a valid/authorized CALL-E credential, an authorized owner phone destination, and a stable externally reachable HTTPS origin whose ingress does not log the webhook capability query string.

The SQLite reference topology remains intentionally single-instance. Multi-instance deployment still requires a future shared transactional store plus shared rate limiter preserving the tested uniqueness, transaction, idempotency, freshness, terminal-winner, audit-sequence, and rate-limit semantics.

## Highest-value next actions

1. Continue the shared-store freshness/CAS audit beyond terminal outcomes and audit ordering. Prioritize transitions that read a run/escalation/call/instruction snapshot and later overwrite the whole entity, especially heartbeat/report-status, exact instruction acknowledgement, escalation call reservation/deferral/expiry, active-call progress, and ambiguous recovery bookkeeping.
2. Turn the highest-risk stale entity transition into an explicit conditional/CAS-style store contract with independent-connection race tests instead of relying on local mirror freshness.
3. Continue runtime string-configuration hardening for provider/store selectors, priority settings, IANA timezone text, and secret/phone whitespace handling where ambiguity can change behavior.
4. Continue HTTP body semantic auditing and least-privilege review without widening normal agent, owner, or browser credentials.
5. Extend provider-specific reconciliation regressions where useful so CALL-E polling/webhook representations continue to normalize to the same business-terminal identity while genuine conflicts remain observable.
6. Preserve the deterministic fake-provider acceptance path while improving operator/demo presentation only after correctness changes remain green.
7. Run the documented acceptance in a genuine Claude Code host when that external prerequisite is available.
8. When the user-controlled CALL-E prerequisites are available, perform one tightly bounded live provider acceptance and record only observed behavior.
