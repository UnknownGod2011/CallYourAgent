# CallYourAgent progress

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. Agents can escalate important decisions without freezing unrelated scopes; owners can independently request callbacks for progress/questions/steering; human input is persisted as structured state and consumed only at explicit safe checkpoints rather than pretending to interrupt in-flight model generation.

The repository includes deterministic fake and production CALL-E providers, SQLite persistence, replayable/idempotent call attempts, polling/webhook convergence, branch-scoped blocking, owner decision persistence, durable per-run instruction queues with exact acknowledgement, quiet hours/call budgets, bounded lifecycle recovery, fail-closed ambiguous/stalled handling, privacy-aware audit history, scoped HTTP authentication, a typed TypeScript client, a real stdio MCP adapter, deterministic end-to-end/demo flows, an operator console, a Claude Code host-acceptance runbook, and a single-instance persistent-volume Compose reference deployment.

This run completed the domain migration started by PR #44. PR #45 moves owner-decision idempotency, owner-callback idempotency, and provider-webhook deduplication onto the explicit atomic `ControlPlaneStore` claim primitives. Retry/loser paths now converge on the store-selected durable identity instead of treating caller-side `Map.get()`/`Map.set()` or `Set.has()`/`Set.add()` as the correctness boundary.

## Exact repo state inspected this run

The run started from `main` HEAD `bd35cb5581192cdf3d17c877cb9a337d22ea43ed`, the progress handoff after PR #44 (`6c39c2d02d772da4160bf22b858eaa5a48100031`).

Before making any change, inspected the complete recursive repository tree and source/test architecture, recent commits, and current issue/PR state. There were no open issues and no pre-existing open pull requests.

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

Also inspected the relevant implementation and regression surface, especially `src/store.ts`, `src/sqlite-store.ts`, `src/control-plane.ts`, `src/call-provider.ts`, `tests/callback-idempotency-concurrency.test.ts`, `tests/sqlite-decision-creation-atomicity.test.ts`, the broader test inventory, and `package.json`.

The audit confirmed that PR #44 had already made rollback-safe atomic first-writer-wins claims part of the store contract, but `ControlPlane.requestOwnerDecision`, `requestOwnerCallback`, and `ingestProviderWebhook` still used direct map/set claim conventions. Provider/network I/O was already correctly outside SQLite transactions and had to remain there.

The automation container's direct GitHub DNS path remained unavailable for a local clone, so GitHub Actions was used as the authoritative executable verification path.

## Changes made this run

PR #45, `Use atomic store claims in control-plane flows`, changed `src/control-plane.ts`, added `tests/control-plane-atomic-claims.test.ts`, and updated `tests/sqlite-decision-creation-atomicity.test.ts`.

### Owner decisions

`requestOwnerDecision` still keeps a fast replay read for the common case, but the transaction correctness boundary now creates a candidate escalation id and calls `bindEscalationIdempotencyKey`. The store-selected winner is authoritative:

- if this request wins, the claimed candidate id becomes the persisted escalation id;
- if another request already won, the caller loads that durable escalation, verifies the payload-bound idempotency contract, and returns the winner;
- the loser does not create a second escalation, audit chain, or provider call.

The direct `escalationByIdempotencyKey.set(...)` claim was removed from the control plane.

### Owner callbacks

`requestOwnerCallback` now follows the same first-writer-wins model with `bindCallbackIdempotencyKey`. The candidate call-attempt id is claimed inside the transaction and, only for the winner, is passed into `persistCallAttempt`. Provider dispatch remains after the durable reservation transaction.

This preserves the core safety ordering: durable local callback identity and audit state first, real-world phone side effect second. A loser/retry converges on the winning `CallAttempt` after validating that the idempotency key is still bound to the same run/prompt payload.

### Provider webhook delivery

`ingestProviderWebhook` now uses `claimWebhookEventId` rather than a caller-side `has()`/`add()` pair. The provider call lookup, event claim, terminal domain transition, resulting owner decision/instruction mutation, and reconciliation audit remain inside one synchronous store transaction. If terminal application throws, the existing rollback contract releases the event claim together with the other local mutations.

### Domain regressions

`tests/control-plane-atomic-claims.test.ts` adds three focused regressions:

1. decision retries that lose the atomic claim converge on the winning durable escalation without a second provider start or duplicate creation/start audits;
2. callback retries that lose the atomic claim converge on the winning durable call attempt without a second provider start or duplicate callback/start audits;
3. duplicate provider webhooks exercise the atomic event claim and queue callback steering exactly once.

The tests deliberately simulate a stale caller-side read while the atomic store primitive still returns the durable winner. This proves the domain no longer depends on the preliminary map lookup for correctness.

### Verification-driven test repair

The first CI run correctly exposed one stale fault-injection test: `tests/sqlite-decision-creation-atomicity.test.ts` still monkey-patched `escalationByIdempotencyKey.set`, which is intentionally no longer called. That run had **203/204 tests passing** and one expected assertion failure because the obsolete seam never fired.

The test was updated to inject the failure through `bindEscalationIdempotencyKey` itself. Its original invariant is preserved: a failure at the idempotency-binding boundary leaves no escalation, no idempotency binding, no call attempt, no creation audit, and no blocked scope; a subsequent retry can create the request normally.

PR #45 was squash-merged into `main` as `73f43fdc598431636702ffd33fb677bf4d17e678`.

## Verification performed

Authoritative final verification ran against PR head `d938f1ad3622ac1d394c11bcce59b970204dd896`:

- CI run `34564452065` — **success** on Node 24.20.0. Locked dependency installation succeeded, TypeScript typecheck succeeded, build succeeded, and **204/204 tests passed**, 0 failures.
- Container run `34564452138` — **success**. The packaged production image/runtime path remained green.
- Compose deployment run `34564452110` — **success**. The full durable fake-provider deployment/restart path remained green, including scoped credential generation/capabilities, compiled stdio MCP, branch-scoped owner-decision persistence across restart, branch-specific release after reconciliation, context-aware owner callback persistence across another restart, exactly-once steering, another restart after steering durability, and explicit safe-checkpoint consumption.

The earlier superseded CI run `34564364879` failed only because the old rollback test injected through the raw map implementation instead of the new store primitive; Container `34564364877` and Compose `34564364881` were already green on that earlier head. The test seam was corrected before merge, and the complete final verification was green.

`package.json` still has no separate lint script and no standalone migration/schema-check command. `npm run check` covers typecheck, build, and tests; SQLite regressions exercise schema/transaction durability, while Container/Compose cover packaged runtime and deployment behavior.

No live CALL-E phone call was attempted or claimed.

## Architecture decisions made this run

1. The preliminary idempotency-map lookup is now only a fast replay path; atomic store binding is the correctness boundary for selecting the durable decision/callback winner.
2. The candidate durable entity id is selected before the atomic bind and, for the winning transaction, reused as the actual persisted entity id. This avoids a bind-to-one-id/persist-another-id split.
3. Atomic claims and creation/audit mutations stay in the same transaction so rollback releases a failed claim. Provider/network I/O remains outside that transaction.
4. Losing requests validate the original payload against the persisted winner before returning it. First-writer-wins never weakens the existing payload-bound idempotency conflict semantics.
5. Provider webhook deduplication is now a true store claim inside the same terminal-application transaction; duplicate delivery cannot independently apply callback instructions or owner decisions.
6. The current SQLite topology remains intentionally single-instance. Independent-store claim tests are contract probes, not a claim of horizontally scalable application execution. A future shared store must also provide authoritative/fresh access to the returned winning entity and preserve all current transaction/uniqueness/rate-limit semantics.
7. Public HTTP, TypeScript SDK, MCP, checkpoint, and privacy contracts are unchanged by this increment.

## CALL-E integration status

- **Fake provider:** deterministic, credential-free, idempotent, restart-rehydratable, and still the primary full-flow development/acceptance provider.
- **Production CALL-E adapter:** implemented against the asynchronous Calls API with server-only `CALLE_API_KEY`, stable provider `Idempotency-Key`, structured result schemas, bounded create/poll requests, persisted correlation, polling/webhook convergence, duplicate prevention, restart-by-provider-id semantics, privacy-safe diagnostics, fail-closed ambiguous/stalled handling, and a strict authenticated base-URL trust boundary.
- **Control-plane persistence:** in-memory and SQLite adapters share rollback plus atomic idempotency/webhook-claim semantics, and the control plane now consumes those primitives directly. SQLite remains the durable single-instance reference store.
- **Control-plane idempotency:** decision and callback keys remain payload-bound; exact retries remain no-op replays; changed-payload reuse is rejected; atomic store winner selection now controls concurrent/stale-read creation paths.
- **Webhook deduplication:** the control plane now consumes the atomic first-claim primitive directly and applies the webhook claim plus terminal local effects in one rollback-safe transaction.
- **Shared integration surfaces:** HTTP, TypeScript SDK, stdio MCP, lifecycle worker, operator console, and deployment acceptance continue sharing the same persistent control-plane state machine.
- **Checkpoint semantics:** human steering remains durable queued state consumed only at explicit safe work boundaries; non-consuming pull plus exact acknowledgement remains the recommended integration model.
- **Claude Code:** compiled stdio MCP behavior remains covered automatically and through Compose acceptance. A genuine Claude Code host session has still not been observed and is not claimed.
- **Live status:** no authorized real CALL-E phone call has been performed, so live provider connectivity, owner-phone authorization, and externally reachable webhook delivery remain unverified.

## Current blockers / external prerequisites

No repository-development blocker prevents further useful work.

A true Claude Code host acceptance still requires an actual Claude Code environment/CLI to register and exercise the compiled stdio MCP server.

Live CALL-E verification still requires user-controlled prerequisites: a valid/authorized CALL-E credential, an authorized owner phone destination, and a stable externally reachable HTTPS origin whose ingress does not log the webhook capability query string.

The SQLite reference topology remains intentionally single-instance. Multi-instance deployment still requires a future shared transactional store plus shared rate limiter preserving the current state-machine, transaction, uniqueness, idempotency, and rate-limit semantics.

## Highest-value next actions

1. Extend the reusable store/domain contract to exactly-once terminal application, especially owner-decision creation and callback instruction creation under competing poll/webhook/reconciliation paths, while keeping provider/network I/O outside database transactions.
2. Audit terminal mutation identity so future shared-store adapters have an executable uniqueness contract for one decision per escalation and one callback-derived instruction set per terminal call attempt, rather than relying only on already-terminal status checks.
3. Continue runtime string-configuration hardening where ambiguity can change operational behavior: provider/store selectors, priority settings, IANA timezone text, and secret/phone whitespace handling should be explicitly canonical or explicitly rejected.
4. Continue the HTTP request-body semantic audit for required identity/text fields and exact instruction acknowledgement boundaries while preserving harmless forward compatibility.
5. Continue least-privilege review of owner/operator/reconciler surfaces without widening browser or normal-agent credentials.
6. Run the documented acceptance in a genuine Claude Code host when that external prerequisite is available and record only observed host/version behavior.
7. When the user-controlled CALL-E prerequisites are available, perform one tightly bounded live provider acceptance and record only observed behavior.
