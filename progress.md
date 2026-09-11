# CallYourAgent progress

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. Agents can escalate important decisions without freezing unrelated scopes; owners can independently request callbacks for progress/questions/steering; human input is persisted as structured state and consumed only at explicit safe checkpoints rather than pretending to interrupt in-flight model generation.

The repository includes deterministic fake and production CALL-E providers, SQLite persistence, replayable/idempotent call attempts, polling/webhook convergence, branch-scoped blocking, owner decision persistence, durable per-run instruction queues with exact acknowledgement, quiet hours/call budgets, bounded lifecycle recovery, fail-closed ambiguous/stalled handling, privacy-aware audit history, scoped HTTP authentication, a typed TypeScript client, a real stdio MCP adapter, deterministic end-to-end/demo flows, an operator console, a Claude Code host-acceptance runbook, and a single-instance persistent-volume Compose reference deployment.

This run strengthened the persistence abstraction itself. PR #43 makes the in-memory store honor the same outermost atomic rollback semantics as durable SQLite, and adds a shared adapter-contract regression proving rollback, nested mutation handling, successful commit, and SQLite reopen persistence. This prevents fast in-memory domain tests from silently exercising weaker failure semantics than the production reference store.

## Exact repo state inspected this run

The run started from `main` HEAD `0112f9905e9e726974121721ed528e9d6a508f5e`, the progress handoff after PR #42 (`81aff0b655711a3d09f6170f92cc9577ae07dce7`).

Before making any change, inspected the complete recursive repository tree and current source/test architecture; the recursive Git tree reported `truncated: false`. Also inspected recent commits and current issue/PR state. There were no open issues and no pre-existing open pull requests.

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

Also inspected the full `src/` and `tests/` inventories plus the persistence/runtime areas relevant to the next increment, especially `src/store.ts`, `src/sqlite-store.ts`, `src/server.ts`, `src/call-policy.ts`, and the existing runtime/SQLite regression coverage.

The audit found a cross-adapter semantic mismatch: `SqliteControlPlaneStore.transaction` rolls failed top-level mutations back and reloads its in-memory mirrors, while `InMemoryControlPlaneStore.transaction` previously executed the callback inline and left any partial mutations in memory when the callback threw. Domain tests using the fast in-memory adapter could therefore observe weaker atomicity guarantees than the durable reference architecture.

The automation container's direct GitHub DNS path remained unavailable for a local clone, so GitHub Actions was used as the authoritative executable verification path.

## Changes made this run

PR #43, `Enforce store transaction rollback contract`, changed `src/store.ts` and added `tests/store-transaction-contract.test.ts`.

`InMemoryControlPlaneStore` now:

1. snapshots all domain maps, idempotency maps, and processed-webhook ids at the outermost transaction boundary;
2. deep-clones map values with `structuredClone`, so rollback also restores values if a transaction mutates an existing object in place;
3. preserves the same nested-transaction model as SQLite by letting nested transactions participate in the outer transaction rather than creating independent savepoints;
4. restores the complete snapshot and rethrows if the outer transaction fails;
5. leaves successful mutations committed normally.

The store interface comment now treats atomicity as the `ControlPlaneStore.transaction` contract rather than describing it as optional when the backing implementation happens to support transactions.

The new shared regression runs the same rollback/commit assertions against both `InMemoryControlPlaneStore` and `SqliteControlPlaneStore`. It proves baseline state survives a forced outer rollback, both outer and nested mutations disappear, a later successful transaction commits, and SQLite persists only the committed state across close/reopen.

PR #43 was squash-merged into `main` as `41d7a42a3bbd50e42381231ccc87d10ffdd6e8a1`.

## Verification performed

Authoritative final verification ran against PR head `ed32e63d3bd39161e3cc651c56d4b852b19f8a92`:

- CI run `34556913438` — **success** on Node 24.20.0. Locked dependency installation succeeded, TypeScript typecheck succeeded, build succeeded, and **199/199 tests passed**, 0 failures. Both new store-contract regressions passed.
- Container run `34556913361` — **success**. The packaged production image/runtime path remained green.
- Compose deployment run `34556913360` — **success**. It validated Compose configuration, booted the fake-provider deployment, verified generated scoped credential capabilities and the compiled stdio MCP path, created a durable branch-blocking owner decision, restarted while that call was active, reconciled it and released only the blocked branch, requested a context-aware owner callback, restarted while that callback was active, completed/reconciled it exactly once, restarted again with steering durable, and consumed steering only at an explicit safe checkpoint.

`package.json` still has no separate lint script and no standalone migration/schema-check command. `npm run check` covers typecheck, build, and tests; SQLite regressions exercise schema/transaction durability, while Container/Compose cover packaged runtime and deployment behavior.

No live CALL-E phone call was attempted or claimed.

## Architecture decisions made this run

1. `ControlPlaneStore.transaction` is a cross-adapter semantic contract, not an optional optimization. A future Postgres or other shared-store adapter must preserve the same atomic mutation boundary.
2. The in-memory test adapter must roll back failed transactions. Otherwise fast domain tests can mask partial-state defects that SQLite correctly rejects.
3. Nested transactions intentionally share the outermost transaction boundary, matching the existing SQLite semantics; this increment does not introduce savepoints or partial nested commits.
4. In-memory snapshots deep-clone stored values so rollback covers both `Map.set`/`Set.add` operations and in-place object mutation inside the transaction.
5. This adapter-level contract complements, rather than replaces, the existing SQLite-specific uniqueness and concurrency regressions. Future multi-instance work must satisfy both the generic transaction contract and the stronger durable winner/uniqueness guarantees.

## CALL-E integration status

- **Fake provider:** deterministic, credential-free, idempotent, restart-rehydratable, and still the primary full-flow development/acceptance provider.
- **Production CALL-E adapter:** implemented against the asynchronous Calls API with server-only `CALLE_API_KEY`, stable provider `Idempotency-Key`, structured result schemas, bounded create/poll requests, persisted correlation, polling/webhook convergence, duplicate prevention, restart-by-provider-id semantics, privacy-safe diagnostics, fail-closed ambiguous/stalled handling, and a strict authenticated base-URL trust boundary.
- **Control-plane persistence:** in-memory and SQLite adapters now share explicit top-level rollback semantics; SQLite remains the durable single-instance reference store and retains its SQL uniqueness/concurrency guarantees.
- **Control-plane idempotency:** decision and callback keys remain payload-bound; exact retries remain no-op replays; changed-payload reuse is rejected; SQLite race coverage proves the durable first binding wins before provider I/O.
- **Public webhook configuration:** live runtime requires an exact HTTPS origin and structurally constructs the tokenized webhook target. Application request handling strips the capability token from `IncomingMessage.url`; reverse-proxy/CDN/APM query-string redaction remains mandatory.
- **Shared integration surfaces:** HTTP, TypeScript SDK, stdio MCP, lifecycle worker, operator console, and deployment acceptance continue sharing the same persistent control-plane state machine.
- **Checkpoint semantics:** human steering remains durable queued state consumed only at explicit safe work boundaries; non-consuming pull plus exact acknowledgement remains the recommended integration model.
- **Claude Code:** compiled stdio MCP behavior remains covered automatically and through Compose acceptance. A genuine Claude Code host session has still not been observed and is not claimed.
- **Live status:** no authorized real CALL-E phone call has been performed, so live provider connectivity, owner-phone authorization, and externally reachable webhook delivery remain unverified.

## Current blockers / external prerequisites

No repository-development blocker prevents further useful work.

A true Claude Code host acceptance still requires an actual Claude Code environment/CLI to register and exercise the compiled stdio MCP server.

Live CALL-E verification still requires user-controlled prerequisites: a valid/authorized CALL-E credential, an authorized owner phone destination, and a stable externally reachable HTTPS origin whose ingress does not log the webhook capability query string.

The SQLite reference topology remains intentionally single-instance. Multi-instance/distributed guarantees require a future shared transactional store and shared limiter that preserve the current uniqueness/idempotency semantics.

## Highest-value next actions

1. Extend the reusable store-adapter contract beyond rollback to cover uniqueness/atomic winner selection and exactly-once terminal application so any future Postgres adapter has an executable semantic target before it is introduced.
2. Continue runtime string-configuration hardening only where ambiguity can change operational behavior: provider/store selectors, priority settings, IANA timezone text, and secret/phone whitespace handling should either be explicitly canonical or explicitly rejected rather than silently varying by field.
3. Continue the HTTP request-body semantic audit for required identity/text fields and exact instruction acknowledgement boundaries, while avoiding needless rejection of harmless forward-compatible fields.
4. Continue least-privilege review of owner/operator/reconciler surfaces without widening browser or normal-agent credentials.
5. Run the documented acceptance in a genuine Claude Code host when that external prerequisite is available and record only observed host/version behavior.
6. When the user-controlled CALL-E prerequisites are available, perform one tightly bounded live provider acceptance and record only observed behavior.
