# API security

CallYourAgent's HTTP boundary separates ordinary agent work from operations that can directly affect real-world phone behavior.

## Credentials and scopes

`CYA_API_TOKEN` remains a backwards-compatible full-access token for trusted/local deployments. Exposed deployments should instead configure `CYA_API_CREDENTIALS_JSON`, a JSON array of credentials with stable ids, high-entropy bearer tokens, and explicit scopes.

Supported scopes are:

- `agent:read` — read runs, escalation/decision state, and call-attempt state;
- `agent:write` — register agents, start/report runs, checkpoint, and request owner decisions;
- `audit:read` — read the privacy-aware run audit timeline;
- `owner:callback` — request an owner-initiated callback to an active run;
- `calls:reconcile` — explicitly reconcile decision/callback calls with the provider;
- `*` — full trusted access.

The intended split is that normal agent/MCP credentials receive `agent:read`, `agent:write`, and optionally `audit:read`. A human-facing owner surface receives `owner:callback` (plus read access if needed). A trusted backend/operator worker receives `calls:reconcile`. This prevents a compromised normal agent credential from directly generating owner callbacks or repeatedly exercising provider reconciliation endpoints.

Credential ids and bearer tokens must both be unique. Authentication comparisons use constant-time equality. The server never returns configured tokens.

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
