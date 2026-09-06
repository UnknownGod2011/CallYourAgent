# progress.md

## Current status

Architecture-first TypeScript control-plane implementation is in place, with deterministic fake-provider behavior and a first production CALL-E provider adapter. The repository now has executable core domain code, transport abstraction, production HTTP mapping, and contract-focused tests.

## Inspected this run

- Full recursive repository tree before changes.
- `AGENTS.md` in full.
- `progress.md` in full.
- `README.md` in full.
- `docs/ARCHITECTURE.md` in full.
- `docs/INTEGRATIONS.md` in full.
- Core source files including `domain.ts`, `store.ts`, `call-provider.ts`, `control-plane.ts`, and public exports.
- Existing control-plane tests and package scripts.
- Recent commit history on `main`.
- Open issues endpoint: none present.
- Current CALL-E Developer API documentation as of 2026-09-06 for `POST /v1/calls`, explicit `recipients[].phones`, `Idempotency-Key`, `result_schema`, metadata, optional `webhook_url`, call lifecycle states, and `GET /v1/calls/{call_id}` terminal reconciliation.

## Previously implemented

- Typed agent/run/escalation/decision/instruction/call-attempt domain model.
- `ControlPlaneStore` abstraction and deterministic `InMemoryControlPlaneStore`.
- `CallProvider` port and deterministic `FakeCallProvider` with provider-side idempotency behavior.
- `ControlPlane` operations for registration, run start/status, blocking and non-blocking escalations, owner callbacks, durable owner instructions, checkpoint consumption, branch/scope blocking, decision reconciliation, and duplicate request prevention.
- End-to-end fake-provider tests covering non-blocking continuation, branch-specific blocking, decision resolution, callback steering, checkpoint consumption, and idempotency.
- Architecture and integration-boundary documentation.

## Implemented this run

- Added `src/calle-provider.ts` implementing a production `CalleCallProvider` behind the existing `CallProvider` port.
- Production provider configuration now requires server-side `apiKey` and owner phone, with optional base URL, webhook URL, and injectable fetch implementation for deterministic tests.
- `CalleCallProvider.start()` now maps control-plane call requests to CALL-E `POST /v1/calls` with:
  - `Authorization: Bearer ...`,
  - stable `Idempotency-Key`,
  - explicit owner recipient via `recipients: [{ phones: [...] }]`,
  - caller-owned correlation metadata,
  - optional terminal webhook URL,
  - strict purpose-specific task-level JSON schemas.
- Owner-decision calls request a strict structured `{ answer: string }` result.
- Owner-callback calls request a strict structured `{ instructions: string[] }` result so steering can flow directly into the durable instruction queue.
- `CalleCallProvider.getOutcome()` now maps queued/in-progress calls to no terminal outcome, completed calls to `CallOutcome`, and failed/canceled calls to terminal failure without pretending success.
- Added defensive response validation so malformed provider payloads fail explicitly rather than silently corrupting control-plane state.
- Added `tests/calle-provider.test.ts` covering request mapping, idempotency header propagation, recipient/metadata/schema mapping, completed decision extraction, callback instruction extraction, active-call behavior, and failure mapping.
- Exported `CalleCallProvider` from the public package API.
- Added `.env.example` containing only variable names/placeholders for `CALLE_API_KEY`, `CALLE_OWNER_PHONE`, optional `CALLE_BASE_URL`, and optional `CALLE_WEBHOOK_URL`, with a server-only warning.

## Architecture decisions

1. The control plane remains the source of truth; CALL-E remains a replaceable phone transport.
2. Owner phone configuration currently belongs to the trusted production provider instance. Multi-owner routing should later move to persisted owner/contact policy rather than exposing phone data to agents.
3. Provider result schemas are purpose-specific and intentionally small. Domain-specific richer decision schemas can be introduced later without coupling the agent adapters to CALL-E.
4. `Idempotency-Key` is forwarded unchanged from the control-plane-derived stable key, matching CALL-E's documented safe replay behavior.
5. Polling reconciliation is now implemented at the provider boundary. Webhook ingestion/deduplication is still a separate missing backend concern.
6. No live CALL-E success is claimed until an authorized `CALLE_API_KEY` and owner phone are supplied and a real call is observed.

## Verification performed

- Contract behavior was checked against the current CALL-E Developer API documentation on 2026-09-06. The documented API accepts asynchronous `POST /v1/calls`, explicit `recipients[].phones`, stable `Idempotency-Key`, caller metadata, strict `result_schema`, optional `webhook_url`, and exposes terminal state through `GET /v1/calls/{call_id}`.
- Added deterministic provider tests using an injected fetch implementation; these do not require live credentials or consume CALL-E credits.
- Re-attempted a clean clone followed by dependency installation and `npm run check` in the execution container. The checkout could not begin because the container still cannot resolve `github.com` (`Could not resolve host: github.com`). Therefore TypeScript compilation/tests are still **not claimed as executed successfully** in this environment.
- GitHub API repository reads/writes succeeded, so committed source state was verified through GitHub itself.

## CALL-E integration status

- Fake provider: implemented.
- Production CALL-E provider: implemented at HTTP adapter level against the current Calls API.
- Polling terminal reconciliation: implemented.
- Strict structured result extraction: implemented for decisions and callback instructions.
- Webhook receiver + event-id deduplication: not yet implemented.
- Recovery of a locally persisted `ambiguous` create-call attempt after process/network uncertainty: not yet strong enough; this remains a correctness priority before production use.
- Live CALL-E call: not attempted because no credential/authorized phone was supplied in this run.

## Current blockers

No product-design blocker and no blocker to continued repository development.

Environment-only verification limitation: the execution container cannot resolve `github.com`, preventing clean checkout/dependency installation and therefore preventing an actual local `tsc`/Node test run here.

## Highest-value next actions

1. Strengthen ambiguous create-call recovery: persist enough call request data to safely replay the same CALL-E idempotency key after timeout/process restart instead of leaving an unrecoverable ambiguous attempt.
2. Add webhook ingestion semantics with event-id deduplication and terminal-call reconciliation that shares the same core transition logic as polling.
3. Add a durable SQL-backed store with transactional unique constraints for escalation/callback idempotency, provider call ids, webhook event ids, and instruction consumption.
4. Add a minimal HTTP service over the control-plane methods and configuration bootstrap that chooses fake vs CALL-E provider from environment.
5. Add MCP tools as a thin adapter over the HTTP/core layer.
6. Build the first real Claude/Claude Code integration and exercise the complete fake-provider flow externally.
7. As soon as an environment with package/network access is available, run `npm run check` and fix any TypeScript/runtime issues before expanding scope.
