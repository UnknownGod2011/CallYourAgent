# CallYourAgent progress

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. Agents can escalate important decisions without freezing unrelated scopes; owners can independently request callbacks for progress/questions/steering; human input is persisted as structured state and consumed only at explicit safe checkpoints rather than pretending to interrupt in-flight model generation.

The repository includes deterministic fake and production CALL-E providers, SQLite persistence, replayable/idempotent call attempts, polling/webhook convergence, branch-scoped blocking, owner decision persistence, durable per-run instruction queues with exact acknowledgement, quiet hours/call budgets, bounded lifecycle recovery, fail-closed ambiguous/stalled handling, privacy-aware audit history, scoped HTTP authentication, a typed TypeScript client, a real stdio MCP adapter, deterministic end-to-end/demo flows, an operator console, a Claude Code host-acceptance runbook, and a single-instance persistent-volume Compose reference deployment.

This run extended the persistence abstraction beyond rollback. PR #44 makes atomic first-writer-wins idempotency binding and provider-webhook event claiming explicit `ControlPlaneStore` semantics, implements those semantics in both in-memory and SQLite adapters, and adds shared rollback/reopen plus independent-SQLite-connection contract coverage. This gives a future shared store an executable winner-selection target instead of relying on implicit `Map.get()`/`Map.set()` conventions.

## Exact repo state inspected this run

The run started from `main` HEAD `9323c6123dca640f69e8ea6c915199231acc8c3a`, the progress handoff after PR #43 (`41d7a42a3bbd50e42381231ccc87d10ffdd6e8a1`).

Before making any change, inspected the complete recursive repository tree and current source/test architecture, recent commits, and current issue/PR state. The recursive source and test inventories were reviewed; there were no open issues and no pre-existing open pull requests.

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

Also inspected the relevant persistence/domain code and regression coverage, especially `src/store.ts`, `src/sqlite-store.ts`, `src/control-plane.ts`, `tests/store-transaction-contract.test.ts`, and the existing SQLite decision/callback concurrency tests.

The audit found that PR #43 had made rollback an explicit cross-adapter contract, but first-writer-wins idempotency ownership and webhook-event deduplication were still expressed as caller-side `Map.get()`/`Map.set()` / `Set.has()`/`Set.add()` conventions. That is sufficient inside the current single-process SQLite topology but is not a strong store-port contract for a future shared transactional adapter.

The automation container's direct GitHub DNS path remained unavailable for a local clone, so GitHub Actions was used as the authoritative executable verification path.

## Changes made this run

PR #44, `Define atomic store claim contract`, changed `src/store.ts`, `src/sqlite-store.ts`, and `tests/store-transaction-contract.test.ts`.

`ControlPlaneStore` now explicitly requires:

1. `bindEscalationIdempotencyKey(key, escalationId)` — atomically bind a decision idempotency key and return the winning escalation id;
2. `bindCallbackIdempotencyKey(key, callAttemptId)` — atomically bind a callback idempotency key and return the winning call-attempt id;
3. `claimWebhookEventId(eventId)` — atomically claim a provider webhook event id and return `true` only for the first claim.

`InMemoryControlPlaneStore` implements first-writer-wins bindings directly and participates in the existing outer transaction rollback snapshot, so failed transactions release claims exactly like other state.

`SqliteControlPlaneStore` implements idempotency claims with `INSERT OR IGNORE` followed by reading the committed winner, and webhook claims with `INSERT OR IGNORE` against the primary-key event table. Its in-memory mirrors are reloaded from SQL after claim operations so the adapter remains coherent with the database-backed winner.

The shared store contract tests now prove:

- first writer wins for escalation and callback idempotency claims;
- repeated webhook claims return `false` after the first claim;
- claims made inside a failed transaction roll back and can be claimed again;
- committed claims survive SQLite close/reopen;
- two independent SQLite store connections observe the same committed idempotency winner and only one webhook-event claimant succeeds.

This increment deliberately did not rewrite public HTTP/MCP contracts or claim multi-instance production support. The existing control-plane code still needs a follow-up migration to consume the new store primitives directly rather than retaining caller-side map/set claim conventions.

PR #44 was squash-merged into `main` as `6c39c2d02d772da4160bf22b858eaa5a48100031`.

## Verification performed

Authoritative final verification ran against PR head `30cef27f45d2915b3abf013287a83b40bc1320ef`:

- CI run `34560721451` — **success** on Node 24.20.0. Locked dependency installation succeeded, TypeScript typecheck succeeded, build succeeded, and **201/201 tests passed**, 0 failures. The new rollback-safe claim tests and independent SQLite connection winner test passed.
- Container run `34560721452` — **success**. The packaged production image/runtime path remained green.
- Compose deployment run `34560721581` — **success**. The full durable fake-provider deployment/restart path remained green, including scoped credentials, compiled stdio MCP, branch-scoped owner decision recovery, owner callback recovery, exactly-once steering, persistence across restart, and explicit safe-checkpoint consumption.

`package.json` still has no separate lint script and no standalone migration/schema-check command. `npm run check` covers typecheck, build, and tests; SQLite regressions exercise schema/transaction durability, while Container/Compose cover packaged runtime and deployment behavior.

CodeRabbit did not run an automatic review because this repository currently has fewer than 10 stars; no actionable review finding was present on PR #44.

No live CALL-E phone call was attempted or claimed.

## Architecture decisions made this run

1. Atomic winner selection belongs in the persistence port, not as an undocumented convention imposed on callers. A future Postgres/shared-store adapter must expose equivalent first-writer-wins semantics.
2. Idempotency binding APIs return the persisted winner rather than only a boolean, allowing a caller to converge on the already-bound durable identity without inventing another local side effect.
3. Provider webhook-event deduplication is an atomic claim semantic. `has()` followed by `add()` is not an adequate contract for a future shared store.
4. Atomic claim operations participate in the same rollback boundary as other domain mutations; a failed transaction must not permanently consume an idempotency or webhook claim.
5. Independent SQLite connections are used as an executable contract probe for committed-winner visibility. This does not make the current SQLite deployment horizontally scalable and does not change the documented single-instance topology.
6. Public API/MCP behavior remains unchanged in this increment. The next domain step is to replace direct idempotency-map/webhook-set claiming in `ControlPlane` with these store primitives and then exercise the same convergence through domain-level tests.

## CALL-E integration status

- **Fake provider:** deterministic, credential-free, idempotent, restart-rehydratable, and still the primary full-flow development/acceptance provider.
- **Production CALL-E adapter:** implemented against the asynchronous Calls API with server-only `CALLE_API_KEY`, stable provider `Idempotency-Key`, structured result schemas, bounded create/poll requests, persisted correlation, polling/webhook convergence, duplicate prevention, restart-by-provider-id semantics, privacy-safe diagnostics, fail-closed ambiguous/stalled handling, and a strict authenticated base-URL trust boundary.
- **Control-plane persistence:** in-memory and SQLite adapters now share explicit rollback plus atomic idempotency/webhook-claim semantics. SQLite remains the durable single-instance reference store.
- **Control-plane idempotency:** decision and callback keys remain payload-bound; exact retries remain no-op replays; changed-payload reuse is rejected. Store adapters now expose an explicit durable winner-selection primitive, while the control-plane caller migration remains the next implementation step.
- **Webhook deduplication:** processed provider event ids have an explicit first-claim store contract. The control plane still needs to consume that primitive directly in `ingestProviderWebhook` in the next increment.
- **Shared integration surfaces:** HTTP, TypeScript SDK, stdio MCP, lifecycle worker, operator console, and deployment acceptance continue sharing the same persistent control-plane state machine.
- **Checkpoint semantics:** human steering remains durable queued state consumed only at explicit safe work boundaries; non-consuming pull plus exact acknowledgement remains the recommended integration model.
- **Claude Code:** compiled stdio MCP behavior remains covered automatically and through Compose acceptance. A genuine Claude Code host session has still not been observed and is not claimed.
- **Live status:** no authorized real CALL-E phone call has been performed, so live provider connectivity, owner-phone authorization, and externally reachable webhook delivery remain unverified.

## Current blockers / external prerequisites

No repository-development blocker prevents further useful work.

A true Claude Code host acceptance still requires an actual Claude Code environment/CLI to register and exercise the compiled stdio MCP server.

Live CALL-E verification still requires user-controlled prerequisites: a valid/authorized CALL-E credential, an authorized owner phone destination, and a stable externally reachable HTTPS origin whose ingress does not log the webhook capability query string.

The SQLite reference topology remains intentionally single-instance. The new cross-connection contract tests validate committed claim semantics, not distributed application safety. Multi-instance deployment still requires a future shared transactional store and shared limiter preserving the current state-machine, uniqueness, idempotency, and rate-limit semantics.

## Highest-value next actions

1. Migrate `ControlPlane.requestOwnerDecision`, `requestOwnerCallback`, and `ingestProviderWebhook` to consume the new atomic store claim primitives directly; add domain regressions proving loser/retry paths converge on the winning durable identity without duplicate provider I/O or terminal mutation.
2. Extend the reusable store/domain contract to exactly-once terminal application, especially callback instruction creation and owner decision persistence, without moving provider/network I/O inside database transactions.
3. Continue runtime string-configuration hardening only where ambiguity can change operational behavior: provider/store selectors, priority settings, IANA timezone text, and secret/phone whitespace handling should either be explicitly canonical or explicitly rejected.
4. Continue the HTTP request-body semantic audit for required identity/text fields and exact instruction acknowledgement boundaries while preserving harmless forward compatibility.
5. Continue least-privilege review of owner/operator/reconciler surfaces without widening browser or normal-agent credentials.
6. Run the documented acceptance in a genuine Claude Code host when that external prerequisite is available and record only observed host/version behavior.
7. When the user-controlled CALL-E prerequisites are available, perform one tightly bounded live provider acceptance and record only observed behavior.
