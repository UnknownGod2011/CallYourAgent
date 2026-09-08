# API security

CallYourAgent's HTTP boundary separates ordinary agent work from operations that can directly affect real-world phone behavior.

## Credentials and scopes

`CYA_API_TOKEN` remains a backwards-compatible full-access token for trusted/local deployments. Exposed deployments should instead configure `CYA_API_CREDENTIALS_JSON`, a JSON array of credentials with stable ids, high-entropy bearer tokens, and explicit scopes.

Supported scopes are:

- `agent:read` — read runs, privacy-safe escalation lifecycle metadata, and privacy-safe callback state;
- `agent:write` — register agents, start/report runs, checkpoint, and request owner decisions;
- `decision:read` — read the owner's durable decision answer and structured result for an escalation; this route also requires `agent:read`;
- `audit:read` — read the privacy-aware run audit timeline;
- `owner:callback` — request an owner-initiated callback to an active run;
- `calls:reconcile` — explicitly reconcile decision/callback calls with the provider;
- `*` — full trusted access.

The intended split is that normal agent/MCP credentials receive `agent:read`, `agent:write`, `decision:read`, and optionally `audit:read`. A human-facing owner surface receives `owner:callback` plus only the observational read scopes it actually needs; the standard owner role intentionally does **not** receive `decision:read`. A read-only operator also intentionally lacks `decision:read`. A trusted backend/operator worker receives `calls:reconcile`. This prevents a browser-facing owner/operator credential from retrieving private decision answers merely because it can render run state, while preserving the answer for the agent that must safely resume the affected scope.

The exported helpers in `src/credential-roles.ts` provide standard least-privilege role presets for integrations that construct credentials programmatically:

- `agent` → `agent:read`, `agent:write`, `decision:read`, `audit:read`;
- `operator-read` → `agent:read`, `audit:read`;
- `owner` → `agent:read`, `audit:read`, `owner:callback`;
- `reconciler` → `calls:reconcile`.

These presets intentionally never include `*`. They are convenience defaults, not a second authorization system: `createControlPlaneHttpServer` remains the enforcement boundary and custom scoped credentials are still supported directly.

Credential ids and bearer tokens must both be unique. Authentication comparisons use constant-time equality. The server never returns configured tokens.

## Credential capabilities

Authenticated clients can inspect the effective permissions of the bearer credential they are already using through:

```text
GET /v1/auth/capabilities
```

The response contains only the stable credential id and its effective concrete scopes. It never returns bearer-token material. A legacy trusted `*` credential is projected as the six concrete capabilities rather than exposing the wildcard itself. This keeps owner/operator surfaces from needing to infer privileges from token labels or from probing side-effecting endpoints.

The endpoint is authenticated, side-effect free, and returned with `Cache-Control: no-store`. It does not grant access to any run data on its own; normal route-level scope checks remain authoritative.

## Escalation lifecycle privacy

`GET /v1/escalations/:id/status` is the privacy-safe individual escalation observation endpoint. It requires only `agent:read` and returns an `EscalationLifecycleView` containing lifecycle fields needed by an owner/operator surface: escalation/run/scope ids, blocking flag, priority, escalation status, privacy-safe call status, optional policy deferral reason, and timestamps.

It deliberately does **not** return the escalation question, context, idempotency key, call-attempt id, decision id, provider call id, replayable phone task, provider metadata, or the owner's decision answer/structured result. The TypeScript client exposes the same boundary as `getEscalationLifecycleStatus`.

This route exists so observational credentials never need to be granted `decision:read` merely to inspect whether one escalation is pending, calling, resolved, expired, or failed. The richer decision-result route remains separately authorized.

## Owner decision response privacy

`GET /v1/escalations/:id` is the endpoint that returns the persisted `OwnerDecision`, including the owner's answer and optional structured result. It now requires **both** `agent:read` and `decision:read`.

The split is intentional:

- the standard `agent` role receives `decision:read` because an agent that raised a decision must be able to consume the durable answer and resume the affected branch safely;
- `operator-read` can observe run/branch/audit state but cannot retrieve the answer;
- `owner` can observe the run and request callbacks but cannot retrieve the answer through the browser/API merely by virtue of having `agent:read`;
- `reconciler` remains provider-facing and cannot read agent or decision state;
- legacy `*` remains full trusted access for backwards-compatible local deployments.

A custom credential with only `decision:read` is also insufficient: `agent:read` is still required. This prevents a narrowly issued decision capability from becoming a standalone data-exfiltration credential.

Deployments that previously gave custom agent credentials only `agent:read`/`agent:write` and relied on `GET /v1/escalations/:id` must add `decision:read`. The standard `agent` role helper already includes it.

## Owner callback response privacy

`POST /v1/callbacks` and `GET /v1/callbacks/:id` return a deliberately narrow `OwnerCallbackView` containing only:

- `id`;
- `runId`;
- operational `status`;
- `createdAt`;
- `updatedAt`.

They do **not** return the internally persisted provider call id, provider name, idempotency key, replayable `request.task`, request metadata, last provider error, or automatic-recovery fields. A callback phone task can contain the agent's current status/scope and the owner's prompt, so exposing the persisted `CallAttempt` to a browser-facing owner/read credential would unnecessarily duplicate sensitive agent context and recovery material outside the control plane.

The full `CallAttempt` remains durable server-side because ambiguous-create recovery, provider polling/webhook convergence, and duplicate-call prevention require the exact original request and correlation state. Trusted reconciliation operations continue to work against that internal representation. The privacy projection therefore changes only the ordinary owner/read response boundary; it does not weaken recovery or idempotency guarantees.

The TypeScript client mirrors this contract: `requestOwnerCallback` and `getCallback` return `OwnerCallbackView`, while trusted reconciliation remains a separate privileged operation.

## Targeted rate limits

Two real-world-control surfaces are rate-limited per credential id with an in-memory fixed window:

- `POST /v1/callbacks` — default 6 requests per minute;
- reconciliation endpoints — default 60 requests per minute across decision and callback reconciliation.

Configure them with:

- `CYA_CALLBACK_RATE_LIMIT_PER_MINUTE`
- `CYA_RECONCILE_RATE_LIMIT_PER_MINUTE`

A rejected request returns HTTP `429`, a `Retry-After` header, and does not invoke the control plane operation. A request lacking the required scope returns HTTP `403` before any domain mutation.

These limits are an API abuse boundary, not a replacement for the control-plane decision-call budgets/quiet-hours policy. Agent -> owner autonomous decision calls still use the durable policy layer described in `CALL_POLICY.md`.

## Deployment limitation

The current limiter is intentionally process-local because the hackathon/reference deployment is a single HTTP control-plane instance with SQLite. Multi-instance deployment must replace it with a shared limiter (for example Redis or database-backed counters) while preserving the same scope semantics. Do not describe the current limiter as globally distributed.

The legacy `CYA_API_TOKEN` has full access by design. Production deployments that expose the service beyond a trusted single-owner environment should migrate MCP/agent clients to scoped credentials before treating the boundary as least-privilege.
