# progress.md

## Current status

Architecture-first TypeScript control-plane implementation is now in place. The repository has moved beyond product notes into executable domain code plus deterministic fake-provider tests.

### Inspected this run

- Full repository tree before changes: `AGENTS.md`, `README.md`, `progress.md` only.
- `AGENTS.md` in full.
- `progress.md` in full.
- `README.md` in full.
- Recent commit history: three initialization/documentation commits; no prior implementation commits.
- Repository issues endpoint: no issues or pull requests were present.
- Current CALL-E developer documentation for the asynchronous Calls API, including `POST /v1/calls`, `GET /v1/calls/{call_id}`, structured result schemas, metadata, `Idempotency-Key`, and terminal webhook behavior.

### Implemented this run

- Added a strict Node/TypeScript project scaffold (`package.json`, `tsconfig.json`, `.gitignore`).
- Added typed domain contracts for:
  - agents,
  - active agent runs,
  - owner-decision escalations,
  - structured owner decisions,
  - owner instructions,
  - callback requests,
  - provider call attempts,
  - safe checkpoints.
- Added `ControlPlaneStore` abstraction and deterministic `InMemoryControlPlaneStore` implementation.
- Added `CallProvider` port so CALL-E is transport rather than source of truth.
- Added deterministic `FakeCallProvider` with provider-side idempotency behavior.
- Implemented `ControlPlane` operations for:
  - registering an agent,
  - starting a run,
  - heartbeat/status updates,
  - blocking and non-blocking owner-decision requests,
  - phone call orchestration,
  - decision reconciliation,
  - owner-requested callbacks,
  - callback reconciliation into durable owner instructions,
  - safe checkpoint inspection/consumption,
  - branch/scope-specific blocking state,
  - duplicate escalation/callback prevention.
- Added public exports in `src/index.ts`.
- Added end-to-end deterministic tests covering:
  - non-blocking escalation not blocking unrelated work,
  - blocking escalation exposing only the affected scope,
  - escalation idempotency preventing duplicate calls,
  - callback result becoming queued owner instructions,
  - safe-checkpoint instruction consumption,
  - callback idempotency preventing duplicate calls.
- Added `docs/ARCHITECTURE.md` describing state ownership, both voice directions, scope-level blocking, persistence evolution, idempotency, and current CALL-E API mapping.
- Added `docs/INTEGRATIONS.md` defining stable adapter semantics for Claude/Claude Code, Codex, ChatGPT/Work, and generic agents without claiming mid-generation interruption.

### Architecture decisions made

1. The control plane, not CALL-E, owns durable state.
2. Every escalation is scoped to a `runId` + `scopeId`; `blocking=false` never freezes the run.
3. Blocking escalations report only their unresolved scope, allowing the agent to keep executing other branches.
4. Owner callback instructions are durable queued state and are consumed only at explicit safe checkpoints.
5. Phone side effects are hidden behind `CallProvider` and use stable idempotency keys.
6. Ambiguous provider failures are represented explicitly and must not trigger blind duplicate calls under new keys.
7. MCP/Claude/Codex/ChatGPT integrations will remain thin adapters over the same core semantics.
8. The real CALL-E adapter should map directly to the documented asynchronous Calls API using metadata, structured schemas, idempotency headers, GET reconciliation, and webhook event deduplication.

### Verification performed

- Re-fetched the recursive GitHub tree after implementation and confirmed all new source, test, docs, and configuration files are present on `main`.
- Reviewed the generated control-plane source through GitHub after commit.
- Attempted a clean clone + `npm install` + `npm run check` in the execution container. This could not start because that container cannot resolve `github.com` (`Could not resolve host: github.com`). This is an execution-environment network limitation, not a repository test failure.
- Because the clean checkout could not be materialized, TypeScript compilation and Node tests are **not yet claimed as executed successfully**. The repository now contains the scripts/tests necessary for the next environment with network/package access to run them immediately.

### CALL-E integration status

- Fake provider: implemented at the control-plane boundary.
- Production provider: not yet implemented.
- Live CALL-E call: not attempted; no credential was used or required in this run.
- Current production mapping is documented against CALL-E's developer API, but live behavior must not be claimed until verified with `CALLE_API_KEY`.

### Current blockers

No product-design blocker.

Current run-only verification limitation: the local execution container had no DNS access to GitHub, preventing clean checkout/dependency installation and therefore preventing an actual `tsc`/test run here. GitHub writes themselves succeeded.

### Highest-value next actions

1. Fetch/review the entire updated repository and run TypeScript build/tests in an environment that can install dependencies; fix any compile/runtime failures first.
2. Strengthen call-attempt recovery semantics for ambiguous create-call failures so reconciliation can never accidentally duplicate a real call.
3. Implement the production CALL-E provider behind `CallProvider` using server-only `CALLE_API_KEY`, `Idempotency-Key`, metadata, strict `result_schema`, GET reconciliation, and webhook deduplication.
4. Add a durable SQL-backed store with unique constraints/transactions matching the in-memory contract.
5. Add a small HTTP service exposing the core operations.
6. Add MCP tools as a thin adapter over the same service/core.
7. Build the first real Claude/Claude Code integration and exercise the complete fake-provider flow from an external agent.
