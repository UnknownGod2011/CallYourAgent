# progress.md

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for two-way voice coordination between autonomous AI agents and their owners. It has SQLite persistence, deterministic fake and production CALL-E provider adapters, ambiguous-call recovery, polling/webhook convergence, authenticated HTTP APIs, a typed TypeScript client, a stdio MCP adapter, CI-proven Claude-style work-loop semantics, decision-call policy controls, and a durable privacy-aware run audit timeline.

The core product semantics remain unchanged: an agent can escalate an important decision by phone without unnecessarily freezing unrelated work; the owner can independently request a callback to hear current agent state and steer the run; human answers/instructions become durable structured state consumed at safe checkpoints rather than being injected into an in-flight model generation.

## Inspected this run

Before changing code, inspected:

- full recursive repository tree on `main`;
- `AGENTS.md` in full;
- prior `progress.md` in full;
- `README.md` in full;
- `docs/ARCHITECTURE.md` in full;
- `docs/INTEGRATIONS.md` in full;
- `docs/CALL_POLICY.md` in full;
- recent commits on `main`;
- open GitHub issues endpoint: none;
- current domain/store/SQLite/control-plane/policy/HTTP/client/MCP implementation;
- existing control-plane and SQLite tests;
- current CI workflow and workflow results.

## Existing implemented foundation

- Typed agent/run/escalation/decision/instruction/call-attempt domain model.
- `ControlPlaneStore` abstraction and deterministic in-memory store.
- Durable `node:sqlite` store with transactional webhook reconciliation and SQL uniqueness guarantees.
- `CallProvider` abstraction plus deterministic fake provider.
- Production CALL-E Calls API adapter with server-side auth, idempotency keys, structured results, polling, and webhook URL support.
- Persisted ambiguous create-call recovery using the exact same provider idempotency key.
- Shared terminal transition path for polling and webhooks.
- CALL-E terminal webhook parser and durable provider-event deduplication.
- Authenticated HTTP control-plane API with environment-selectable fake/live provider and memory/SQLite storage.
- Application-owned webhook capability token plus provider event-id consistency validation.
- Typed `CallYourAgentClient` over the authenticated HTTP API.
- Official MCP v2 stdio adapter exposing registration, run/status, escalation, checkpoint, callback, reconciliation, and audit timeline tools.
- Protocol-level MCP client -> MCP server -> HTTP server -> ControlPlane -> FakeCallProvider integration tests.
- Full Claude-style MCP work-loop test proving scoped blocking, unrelated work continuation, later owner decision, owner-requested callback steering, durable queueing, and safe checkpoint consumption.
- Agent -> owner decision-call policy with priority gate, quiet hours, critical bypass, per-run budget, and per-owner 24-hour budget.
- GitHub Actions Node 24 CI running TypeScript typechecking/build and the complete Node test suite.

## Implemented this run

### Durable audit-event domain and persistence

Added first-class `AuditEvent` domain records with explicit event type, actor, references, safe operational metadata, human-readable summary, timestamp, and durable monotonic `sequence`.

The store contract now includes `auditEvents`. Both the in-memory store and SQLite store persist the timeline. SQLite adds an `audit_events` table, run/agent lookup indexes, and includes audit state in transaction rollback/reload handling.

Audit history therefore survives process-style SQLite close/reopen and participates in webhook transaction atomicity rather than being an external best-effort log.

### Audit coverage across the control plane

The control plane now records meaningful transitions including:

- run start and compact status reports;
- escalation creation;
- call-policy deferral and release;
- escalation expiry;
- call-attempt persistence before side effect;
- provider acceptance;
- ambiguous call states and recovery;
- completed/failed calls;
- owner decision resolution;
- owner-requested callbacks;
- queued owner steering;
- instruction consumption at a safe checkpoint;
- provider webhook reconciliation.

The timeline is intentionally metadata-only. It does **not** copy full escalation context, owner decision answers, callback transcripts, or owner instruction text. This keeps the audit path useful for operations/demo storytelling without becoming a second sensitive transcript store.

### Stateful policy deferral audit semantics

`Escalation` now persists `deferredReason` when policy prevents a decision call. Repeated reconciliation under the same reason does not generate duplicate `call_policy_deferred` events. When the condition clears, `call_policy_released` records the transition before the normal call path starts.

This makes a deferred blocking scope explainable without changing the core behavior: only its scope remains blocked and unrelated work can continue.

### Stable causal ordering

The first audit test exposed a real ordering flaw: `run_started` and `run_status_reported` can be produced within the same millisecond, and sorting equal timestamps by random UUID can reverse causal order after a SQLite restart.

The model was fixed rather than weakening the test. Every audit event now receives a monotonic `sequence`, and `listAuditEvents` orders by sequence. This preserves causal order across same-millisecond transitions and durable reopen.

### HTTP, TypeScript SDK, and MCP access

Added authenticated run timeline access:

- HTTP: `GET /v1/runs/:runId/audit?limit=...`;
- TypeScript client: `getAuditTimeline(runId, limit)`;
- MCP: read-only `get_audit_timeline`.

The MCP tool reads the same control-plane event store and does not receive CALL-E credentials or privileged database access.

### Architecture/integration documentation

Updated `docs/ARCHITECTURE.md` with audit persistence, privacy, ordering, webhook-transaction behavior, and adapter boundaries.

Updated `docs/INTEGRATIONS.md` with the typed-client/MCP audit surface and its read-only privacy semantics.

## Tests added this run

Added `tests/audit-timeline.test.ts` covering:

1. a complete asynchronous decision + owner callback + safe-checkpoint workflow produces the expected operational timeline;
2. serialized audit events do not contain supplied sensitive escalation context, owner decision answer, or owner instruction text;
3. SQLite audit events survive close/reopen;
4. causal event order remains stable across restart.

Existing policy, CALL-E, webhook, HTTP, client, MCP, work-loop, and SQLite tests continue to run in the same CI suite.

## Verification performed

- CI run `34056804992` initially failed with 30/31 tests passing. TypeScript typecheck and build succeeded; the only failure showed same-millisecond audit events reversing after SQLite reopen because timestamp + random UUID was not a valid causal ordering.
- The implementation was corrected with durable monotonic audit `sequence` values.
- Final code-bearing CI run `34056933011` for commit `0353e178ca3f0700a4359d91f6f4dd947d4fe297` completed successfully. It ran checkout, Node 24 setup, dependency installation, TypeScript typechecking/build, and the complete Node test suite.
- Documentation commits followed the successful code-bearing run and do not change runtime behavior.
- No live CALL-E call was attempted because this run has no authorized CALL-E credential/destination phone/public HTTPS deployment.
- No real Claude Code host process was launched; host-level Claude acceptance remains an external runtime prerequisite, while protocol-level MCP behavior is CI-tested.

## Architecture decisions confirmed this run

1. Audit events are domain state, not adapter logs. HTTP/MCP/UI surfaces read them rather than inventing independent histories.
2. Audit payloads should record operational facts and references, not duplicate call/decision/instruction content.
3. Causal event ordering must be explicit; timestamps alone are insufficient for multi-transition control-plane operations.
4. Provider webhook reconciliation and its audit event belong to the same durable transaction boundary.
5. Policy deferral reasons belong on the durable escalation so repeated reconciliation is explainable without producing audit spam.
6. Audit access is observational and read-only; it does not alter checkpoint or branch-blocking semantics.

## CALL-E integration status

- Fake provider: implemented and CI-tested.
- Production CALL-E HTTP provider: implemented.
- Server-only API key handling: implemented.
- Stable provider idempotency propagation: implemented.
- Polling terminal reconciliation: implemented.
- Structured decision/callback results: implemented.
- Ambiguous create-call persistence and same-key recovery: implemented.
- Terminal webhook parser: implemented.
- Webhook event-id deduplication + shared terminal reconciliation: implemented.
- Durable webhook transaction boundary: implemented.
- Durable SQLite state across restart: implemented and tested.
- HTTP webhook receiver + application-owned secret URL: implemented.
- Typed HTTP agent SDK: implemented and tested.
- MCP adapter + complete asynchronous work-loop fixture: implemented and CI-tested.
- Autonomous decision call policy: priority gates, quiet hours, per-run and per-owner budgets implemented and CI-tested.
- Durable run audit timeline: implemented across SQLite, HTTP, TypeScript client, and MCP; code-bearing CI verified.
- Live CALL-E call: not attempted because credentials/authorized phone/public HTTPS deployment are not available to this automation run.

## Current blockers

No blocker to continued repository development.

Live CALL-E verification requires a valid `CALLE_API_KEY`, an authorized owner destination phone number, and a publicly reachable HTTPS deployment URL. Actual Claude Code host acceptance requires a Claude Code installation/session capable of registering the local stdio process. These external prerequisites do not block lifecycle, retry, security, deployment, or UI development.

## Highest-value next actions

1. Add bounded ambiguous-call recovery attempts, retry scheduling/backoff, and terminal handling after repeated recovery failures. Current same-idempotency recovery is safe but not lifecycle-bounded.
2. Add a periodic lifecycle sweep for deferred/expired escalations and pending/ambiguous calls so progress does not depend solely on an agent-driven reconcile request.
3. Add API credential scopes and rate limiting, especially for owner-requested callbacks, before exposing the control plane beyond a trusted single-owner deployment.
4. Add graceful shutdown and production deployment documentation; validate SQLite persistence assumptions for the chosen hosting target.
5. Generate and commit a lockfile once dependency choices stabilize, then use `npm ci` in CI.
6. Exercise the documented `claude mcp add` path in a real Claude Code installation and record exact host-level results.
7. After retry/lifecycle/security hardening, build a small demo/status UI over the same run/audit APIs rather than creating another state machine.
