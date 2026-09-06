# progress.md

## Current status

Architecture-first TypeScript control-plane implementation now has a durable SQLite-backed store, transactional webhook reconciliation, deterministic fake-provider behavior, a production CALL-E provider adapter, ambiguous-call recovery, and provider-webhook/polling convergence. GitHub Actions CI now provides a real Node 24 verification path and has successfully completed typecheck + the full test suite for the persistence increment.

## Inspected this run

- Full recursive repository tree before changes.
- `AGENTS.md` in full.
- `progress.md` in full.
- `README.md` in full.
- `docs/ARCHITECTURE.md` in full.
- `docs/INTEGRATIONS.md` in full.
- Core source files needed for the persistence boundary, including `domain.ts`, `store.ts`, `control-plane.ts`, `call-provider.ts`, and exports.
- Existing test layout and `package.json` / TypeScript configuration.
- Recent commit history on `main`.
- Open GitHub issues endpoint: none present; therefore no open PR was surfaced by that endpoint either.
- Current Node documentation for `node:sqlite` / `DatabaseSync` availability and Node 24 behavior.
- GitHub Actions run state and job steps after adding CI.

## Previously implemented

- Typed agent/run/escalation/decision/instruction/call-attempt domain model.
- `ControlPlaneStore` abstraction and deterministic `InMemoryControlPlaneStore`.
- `CallProvider` port and deterministic `FakeCallProvider` with provider-side idempotency behavior.
- `ControlPlane` operations for registration, run start/status, blocking and non-blocking escalations, owner callbacks, durable owner instructions, checkpoint consumption, branch/scope blocking, decision reconciliation, and duplicate request prevention.
- End-to-end fake-provider tests covering non-blocking continuation, branch-specific blocking, decision resolution, callback steering, checkpoint consumption, and idempotency.
- Production `CalleCallProvider` mapping to CALL-E's asynchronous create/get APIs with server-side auth, stable `Idempotency-Key`, recipient phone, correlation metadata, optional webhook URL, and purpose-specific structured result schemas.
- Persisted replayable call requests and same-idempotency-key recovery for ambiguous create outcomes.
- Polling/webhook convergence through one terminal transition path.
- CALL-E terminal webhook parser with event-id deduplication and duplicate-side-effect tests.
- Architecture and integration-boundary documentation.

## Implemented this run

### Durable store boundary

- Extended `ControlPlaneStore` with a synchronous `transaction(operation)` contract.
- `InMemoryControlPlaneStore.transaction` executes inline, preserving existing deterministic behavior.
- Wrapped `ControlPlane.ingestProviderWebhook` in the store transaction boundary, so provider-event lookup, terminal state application, decision/instruction creation, and webhook event recording are one atomic domain mutation when the backing store supports transactions.

### SQLite persistence

- Added `SqliteControlPlaneStore` using Node 24's built-in `node:sqlite` `DatabaseSync`.
- Added durable SQL-backed map/set implementations while preserving the existing tested `Map`/`Set` control-plane contract.
- Persisted:
  - agents,
  - runs,
  - escalations,
  - owner decisions,
  - owner instructions,
  - replayable call attempts,
  - escalation idempotency mappings,
  - callback idempotency mappings,
  - processed webhook event ids.
- Enabled WAL, foreign-key mode, and normal synchronous durability mode for the reference single-process deployment.
- Added an explicit `BEGIN IMMEDIATE` / `COMMIT` / `ROLLBACK` transaction implementation.
- On rollback, reloads all in-memory SQL mirrors so the process cannot continue with memory diverged from committed durable state.
- Added SQL uniqueness for escalation idempotency keys and non-null provider call ids.
- Added indexes for run/status lookups on instructions and escalations.
- Exported `SqliteControlPlaneStore` from the public package surface.
- Raised the documented runtime engine to Node 24+ to match the built-in SQLite implementation.

### Tests

- Added persistence test proving agent/run/escalation/instruction/call-attempt state survives a close/reopen cycle.
- Added transaction rollback test proving both SQL rows and in-memory mirrors revert after a thrown domain mutation.
- Added SQL uniqueness test proving two call attempts cannot claim the same provider call id.

### CI / verification

- Added `.github/workflows/ci.yml` for pushes to `main` and pull requests.
- CI uses Node 24 and runs dependency installation followed by `npm run check`.
- Initial workflow revision used `npm ci` but the repository does not yet have a lockfile; corrected it to `npm install --no-audit --no-fund` rather than leaving knowingly broken CI.
- GitHub Actions run `34041142863` completed successfully; the `Typecheck and test` step completed successfully under Node 24.
- A subsequent documentation-only CI run was in progress at the time this progress file was prepared; the code-bearing run had already passed.

### Documentation

- Updated `docs/ARCHITECTURE.md` with the durable SQLite persistence model, transactional webhook invariant, rollback mirror-reload behavior, SQL uniqueness guarantees, Node 24 requirement, CI verification path, and Postgres evolution boundary.

## Architecture decisions

1. The existing synchronous domain API is intentionally preserved for the reference implementation rather than forcing an async persistence rewrite before the MVP is stable.
2. SQLite is the durable single-control-plane store for the hackathon/reference deployment; a future multi-instance Postgres adapter must preserve the exact same uniqueness and transaction semantics.
3. Webhook event recording and terminal side effects must execute inside one store transaction.
4. SQL-backed `Map`/`Set` mirrors allow the tested domain code to remain unchanged while making every mutation durable.
5. A rollback must repair both SQL and in-memory state; rolling back only SQL would be unsafe because later domain reads use the mirrors.
6. Provider call id uniqueness is enforced below the application layer, not only by code conventions.
7. CI is now the authoritative executable verification path when the automation environment cannot clone the repository itself.
8. CALL-E remains a transport adapter; live CALL-E success is still not claimed without authorized credentials and an observed real call.

## Verification performed

- GitHub Actions successfully executed Node 24 dependency installation, TypeScript typecheck, build, and Node test suite through `npm run check` for the code-bearing CI run.
- The CI job's `Typecheck and test` step reported `success`.
- Reviewed every new/modified file through GitHub connector reads/writes.
- Verified official Node documentation exposes `DatabaseSync` through `node:sqlite` and that it is available without the old experimental CLI flag in current Node 24-era releases.
- No live CALL-E call was attempted because no authorized API key/phone credential is available to this run.

## CALL-E integration status

- Fake provider: implemented and tested.
- Production CALL-E HTTP provider: implemented.
- Server-only API key handling: implemented by provider configuration and `.env.example` convention.
- Stable provider idempotency key propagation: implemented.
- Polling terminal reconciliation: implemented.
- Purpose-specific structured decision/callback results: implemented.
- Ambiguous create-call persistence and same-key recovery: implemented.
- Terminal webhook payload parser: implemented.
- Webhook event-id deduplication + shared terminal reconciliation: implemented.
- Durable webhook transaction boundary: implemented for SQLite store.
- Durable SQLite state across restart: implemented and tested.
- HTTP webhook receiver/authentication: not yet implemented.
- Live CALL-E call: not attempted because no credential/authorized phone is available to this run.

## Current blockers

No product-design blocker and no blocker to continued repository development.

Live CALL-E verification still requires a valid `CALLE_API_KEY`, an authorized destination phone number, and any provider webhook-secret/authentication material required by the current CALL-E account configuration.

## Highest-value next actions

1. Add a minimal HTTP server/bootstrap selecting fake vs CALL-E provider and in-memory vs SQLite store from environment.
2. Expose health, agent registration, run start/status, escalation creation/status, checkpoint, owner callback, and reconciliation endpoints over the same `ControlPlane` methods.
3. Add authenticated CALL-E webhook ingress; verify the provider's current webhook-auth mechanism before accepting mutations.
4. Add API authentication for agent-facing endpoints so arbitrary callers cannot create calls or consume instructions.
5. Add MCP tools as a thin adapter over the exact same control-plane semantics.
6. Build a small TypeScript SDK and then the first real Claude/Claude Code checkpoint integration.
7. Add quiet hours, call budgets, retry bounds, expiration sweep behavior, and audit events before broad UI scope.
8. Add and commit a lockfile once dependency management is stabilized, then switch CI back to `npm ci` for fully reproducible installs.
