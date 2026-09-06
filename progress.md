# progress.md

## Current status

Architecture-first TypeScript control-plane implementation is in place with deterministic fake-provider behavior, a production CALL-E provider adapter, durable recovery semantics for ambiguous call creation, and provider-webhook reconciliation that converges with polling through one terminal transition path. Duplicate terminal delivery is now explicitly guarded both by call-attempt terminal state and webhook event-id deduplication.

## Inspected this run

- Full recursive repository tree before changes.
- `AGENTS.md` in full.
- `progress.md` in full.
- `README.md` in full.
- `docs/ARCHITECTURE.md` in full.
- `docs/INTEGRATIONS.md` in full.
- Core source files including `domain.ts`, `store.ts`, `call-provider.ts`, `calle-provider.ts`, `control-plane.ts`, and exports.
- Existing control-plane tests.
- Recent commit history on `main`.
- Open GitHub issues endpoint: none present.
- Current CALL-E Calls API documentation for terminal webhook correlation. The docs state that terminal webhooks use a top-level event `id`, return the call task under `data`, and use `data.id` as the call id; caller metadata is echoed on webhook payloads.

## Previously implemented

- Typed agent/run/escalation/decision/instruction/call-attempt domain model.
- `ControlPlaneStore` abstraction and deterministic `InMemoryControlPlaneStore`.
- `CallProvider` port and deterministic `FakeCallProvider` with provider-side idempotency behavior.
- `ControlPlane` operations for registration, run start/status, blocking and non-blocking escalations, owner callbacks, durable owner instructions, checkpoint consumption, branch/scope blocking, decision reconciliation, and duplicate request prevention.
- End-to-end fake-provider tests covering non-blocking continuation, branch-specific blocking, decision resolution, callback steering, checkpoint consumption, and idempotency.
- Production `CalleCallProvider` mapping to CALL-E's asynchronous create/get APIs with server-side auth, stable `Idempotency-Key`, recipient phone, correlation metadata, optional webhook URL, and purpose-specific structured result schemas.
- Persisted replayable call requests and same-idempotency-key recovery for ambiguous create outcomes.
- Architecture and integration-boundary documentation.

## Implemented this run

- Added `processedWebhookEventIds` to the store contract and in-memory store so repeated provider events have an explicit deduplication key.
- Added `ControlPlane.ingestProviderWebhook({ eventId, providerCallId, outcome })`.
- Refactored polling reconciliation and webhook ingestion to share one internal terminal transition path instead of separately creating decisions/instructions.
- The shared terminal transition is idempotent at call-attempt level: already `completed` or `failed` attempts are no-ops.
- Owner-decision terminal outcomes now resolve the linked escalation through the same logic regardless of whether evidence arrived through polling or a webhook.
- Owner-callback terminal outcomes queue instructions through the same logic regardless of delivery path.
- Added explicit webhook event-id deduplication so repeated delivery returns `duplicate: true` without repeating domain side effects.
- Added regression coverage proving a decision webhook delivered twice creates exactly one `OwnerDecision` and unblocks the scope once.
- Added regression coverage proving webhook completion followed by polling cannot enqueue callback instructions twice.
- Added `parseCalleTerminalWebhook` as a CALL-E-specific boundary parser. It accepts documented terminal CallTask webhook payloads, uses the top-level event id for deduplication, maps `data.id` to provider call id, rejects/non-mutates non-terminal or malformed payloads, maps `failed`/`canceled` to failed outcomes, and extracts decision answers or callback instructions from `structured_result`.
- Added parser tests for completed decisions, callback instructions, ignored non-terminal events, and terminal failures.
- Exported the CALL-E webhook parser publicly.
- Updated `docs/ARCHITECTURE.md` with polling/webhook convergence, event-id dedup semantics, and the requirement that a future durable store atomically records the event and applies its terminal state transition.

## Architecture decisions

1. Polling and webhooks are transport mechanisms for the same provider result and must share one domain transition path.
2. Webhook deduplication uses the provider's stable event id; provider call id alone is insufficient because a call may legitimately produce multiple events.
3. A terminal call attempt is a second idempotency barrier. This protects against a delayed webhook after polling and against different event ids carrying the same terminal evidence.
4. Unknown provider call ids are rejected rather than recorded as processed. This avoids poisoning event dedup state before the correlated call attempt exists.
5. In a SQL-backed store, event-id insertion and outcome application must occur atomically in one transaction.
6. Provider-specific payload parsing stays outside the core domain. The control plane consumes a provider-agnostic `CallOutcome`.
7. HTTP-level webhook authentication/signature verification must happen before `parseCalleTerminalWebhook` / `ingestProviderWebhook`; the current repository does not claim such verification yet.
8. Live CALL-E success is still not claimed without authorized credentials and an observed real call.

## Verification performed

- Reviewed all modified files through GitHub writes and repository reads available to this run.
- Added deterministic unit tests for duplicate decision webhook delivery and webhook-then-poll callback reconciliation.
- Added deterministic unit tests for CALL-E terminal webhook payload parsing.
- Verified the current CALL-E documentation states that terminal webhooks identify the event at top-level `id` and the call task at `data.id`, matching the new adapter boundary.
- Local TypeScript compilation/tests are still **not claimed as executed successfully** because this automation environment has previously been unable to resolve/clone `github.com`; GitHub connector reads/writes are functioning. No unsupported success claim was made.

## CALL-E integration status

- Fake provider: implemented.
- Production CALL-E HTTP provider: implemented.
- Server-only API key handling: implemented by provider configuration and `.env.example` convention.
- Stable provider idempotency key propagation: implemented.
- Polling terminal reconciliation: implemented.
- Purpose-specific structured decision/callback results: implemented.
- Ambiguous create-call persistence and same-key recovery: implemented at the control-plane/domain layer.
- Terminal webhook payload parser: implemented.
- Webhook event-id deduplication + shared terminal reconciliation: implemented at the control-plane/in-memory-store layer.
- HTTP webhook receiver/authentication: not yet implemented.
- Durable SQL persistence / transactional webhook atomicity: not yet implemented.
- Live CALL-E call: not attempted because no credential/authorized phone is available to this run.

## Current blockers

No product-design blocker and no blocker to continued repository development.

Environment-only verification limitation: an actual package install / `tsc` / Node test execution has not yet been possible from prior automation containers because direct GitHub checkout could not resolve `github.com`. GitHub connector operations remain healthy.

## Highest-value next actions

1. Add a durable SQL-backed store with transactional unique constraints for escalation/callback idempotency, provider call ids, webhook event ids, instruction consumption, and persisted replayable `CallAttempt.request`; make webhook-event insertion + terminal transition atomic.
2. Add a minimal HTTP service/configuration bootstrap selecting fake vs CALL-E provider from environment and exposing health/register/run/status/escalation/checkpoint/callback operations.
3. Add authenticated CALL-E webhook ingress that verifies provider authenticity according to current documented mechanism before parsing/ingesting an event.
4. Add MCP tools as a thin adapter over the exact same control-plane/HTTP semantics.
5. Build a small TypeScript SDK for generic agents and then the first real Claude/Claude Code MCP/checkpoint integration.
6. Add quiet hours, call budgets, retry bounds, expiration sweep behavior, and audit events before broadening UI scope.
7. As soon as an environment with package/network access is available, run `npm run check` and fix any TypeScript/runtime issues before expanding aggressively.
