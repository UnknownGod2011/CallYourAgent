# progress.md

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for two-way voice coordination between autonomous AI agents and their owners. It has SQLite persistence, deterministic fake and production CALL-E provider adapters, ambiguous-call recovery, polling/webhook convergence, authenticated HTTP APIs, a typed TypeScript client, a stdio MCP adapter, and a CI-proven Claude-style work loop.

The core product semantics remain unchanged: an agent can escalate an important decision by phone without unnecessarily freezing unrelated work; the owner can independently request a callback to hear current agent state and steer the run; human answers/instructions become durable structured state consumed at safe checkpoints rather than being injected into an in-flight model generation.

Agent -> owner decision calls now also pass through an explicit production call-policy gate before any external phone side effect is created.

## Inspected this run

Before changing code, inspected:

- full recursive repository tree on `main`;
- `AGENTS.md` in full;
- this `progress.md` in full;
- `README.md` in full;
- `docs/ARCHITECTURE.md` in full;
- `docs/INTEGRATIONS.md` in full;
- recent commits on `main`;
- open GitHub issues endpoint: none;
- current domain types;
- `ControlPlane` decision/callback/reconciliation/checkpoint behavior;
- store contract;
- fake provider behavior;
- runtime environment bootstrap;
- package/CI architecture through the existing repository tree and prior verified workflow state.

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
- Official MCP v2 stdio adapter exposing registration, run/status, escalation, checkpoint, callback, and reconciliation tools.
- Protocol-level MCP client -> MCP server -> HTTP server -> ControlPlane -> FakeCallProvider integration test.
- Full Claude-style MCP work-loop test proving scoped blocking, unrelated work continuation, later owner decision, owner-requested callback steering, durable queueing, and safe checkpoint consumption.
- GitHub Actions Node 24 CI running the full TypeScript check/build/test path.

## Implemented this run

### Explicit decision-call policy layer

Added `src/call-policy.ts` as a provider-independent policy gate for autonomous agent -> owner decision calls.

Current controls:

- minimum escalation priority;
- quiet hours using an IANA timezone;
- configurable priority threshold for quiet-hour bypass (`critical` by default);
- maximum decision calls per run;
- maximum decision calls per owner during the previous 24 hours.

Budget accounting deliberately counts attempts that may have produced a real external side effect. Ambiguous attempts therefore count because the provider might have accepted the request even when the local response was lost.

### Deferred escalation semantics

`requestOwnerDecision` now persists the escalation first and evaluates call policy before starting CALL-E/fake-provider work.

If policy denies the call:

- escalation remains `pending`;
- no `CallAttempt` is created;
- no provider request is sent;
- a blocking escalation continues to block only its own scope;
- unrelated scopes remain free to continue.

`reconcileEscalation` now reevaluates policy when a pending escalation has no call attempt. This means quiet hours can defer rather than discard an escalation. Once policy allows the call, reconciliation starts the normal idempotent call path.

Expiry is evaluated before deferred policy reevaluation. A deferred escalation whose `expiresAt` passes becomes `expired` without ever creating a phone side effect.

### Runtime configuration

`src/server.ts` now builds the policy from server-side environment variables:

- `CYA_MIN_DECISION_PRIORITY`
- `CYA_MAX_DECISION_CALLS_PER_RUN`
- `CYA_MAX_DECISION_CALLS_PER_OWNER_24H`
- `CYA_QUIET_HOURS_START`
- `CYA_QUIET_HOURS_END`
- `CYA_QUIET_HOURS_TIME_ZONE`
- `CYA_QUIET_HOURS_BYPASS_PRIORITY`

Quiet-hour start/end/timezone must be configured together and are validated at startup. Invalid priorities, hour ranges, counts, or timezones fail fast rather than surfacing only when a live call is attempted.

`.env.example` now shows a production-oriented policy configuration, and the call-policy types are exported through `src/index.ts`.

### Policy documentation

Added `docs/CALL_POLICY.md` documenting deferred-call semantics, budgets, quiet-hour behavior, owner-requested callback treatment, and the safety invariants around provider side effects.

Owner-requested callbacks intentionally do not use the autonomous decision priority/quiet-hours gate: the owner explicitly requested that interaction. API-level callback abuse/rate limiting remains separate future hardening.

## Tests added this run

Added `tests/call-policy.test.ts` covering:

1. a high-priority blocking decision is deferred during Asia/Kolkata quiet hours with no call attempt, remains visible as a blocked scope, then starts on reconciliation after quiet hours;
2. a critical decision bypasses quiet hours when the configured bypass threshold is critical;
3. a minimum-priority gate keeps a low-value non-blocking decision pending without creating a phone call;
4. a per-run decision-call budget allows the first call and leaves the next escalation pending with only one provider attempt created;
5. a quiet-hour-deferred escalation can expire without ever creating a call and stops blocking after expiry.

## Verification performed

- GitHub Actions CI run `34053768808` for the runtime policy configuration commit completed successfully.
- GitHub Actions CI run `34053790452` for the policy integration tests completed successfully. This includes checkout, Node 24 setup, dependency installation, TypeScript typechecking/build, and the complete Node test suite.
- Subsequent documentation/export commits were pushed after the successful code-bearing policy test run; their CI runs contain the same already-passing code plus documentation/export changes and should remain the final verification target before the next implementation increment.
- No live CALL-E call was attempted because this run has no authorized CALL-E credential/destination phone/public HTTPS deployment.
- No real Claude Code host process was launched; host-level Claude acceptance remains an external runtime prerequisite, while protocol-level MCP behavior is CI-tested.

## Architecture decisions confirmed this run

1. Call policy belongs inside the control plane immediately before external side effects, not inside MCP, HTTP, Claude, or CALL-E adapters.
2. Policy denial is not equivalent to provider failure. A denied call remains a durable pending escalation that may later become eligible.
3. Quiet hours defer important decisions rather than losing them.
4. A pending blocking escalation continues to block only its branch/scope, preserving the core non-blocking product differentiator.
5. Critical quiet-hour bypass must be explicit/configurable rather than hard-coded as an undocumented exception.
6. Agent-driven decision calls and explicit owner-requested callbacks have different interruption semantics and therefore different policy treatment.
7. Ambiguous provider attempts count toward budgets because safety must assume a side effect may already exist.

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
- Live CALL-E call: not attempted because credentials/authorized phone/public HTTPS deployment are not available to this automation run.

## Current blockers

No blocker to continued repository development.

Live CALL-E verification requires a valid `CALLE_API_KEY`, an authorized owner destination phone number, and a publicly reachable HTTPS deployment URL. Actual Claude Code host acceptance requires a Claude Code installation/session capable of registering the local stdio process. These external prerequisites do not block audit, lifecycle, retry, security, deployment, or UI development.

## Highest-value next actions

1. Add a durable audit-event timeline covering run status changes, policy decisions/defer reasons, escalation/call transitions, owner decisions, callbacks, queued instructions, webhook reconciliation, and checkpoint consumption. This is now especially valuable because operators/demo viewers should be able to see *why* an escalation remained pending during policy deferral.
2. Add bounded recovery-attempt counters, retry scheduling/backoff, and terminal handling for repeatedly ambiguous provider calls. Current same-idempotency recovery is safe but not yet lifecycle-bounded.
3. Add a periodic lifecycle sweep for deferred/expired escalations so policy reevaluation and expiration do not depend solely on agent-driven reconcile calls.
4. Add API rate limiting and credential scopes, especially for owner-requested callbacks, before exposing the control plane beyond a trusted single-owner deployment.
5. Add graceful shutdown and production deployment documentation; validate SQLite persistence assumptions for the chosen hosting target.
6. Generate and commit a lockfile once dependency choices stabilize, then use `npm ci` in CI.
7. Exercise the documented `claude mcp add` path in a real Claude Code installation and record exact host-level results.
8. After policy/audit/lifecycle hardening, build a small demo/status UI over the same APIs rather than creating another state machine.
