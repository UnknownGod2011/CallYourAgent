# Production deployment

CallYourAgent's current reference deployment is deliberately a **single Node.js control-plane process backed by SQLite**. This keeps the hackathon deployment understandable and preserves the explicit transaction/idempotency guarantees already covered by tests. Do not horizontally scale this exact configuration and assume it becomes distributed-safe.

## Recommended reference topology

```text
Claude / Codex / custom agent ---- MCP / HTTPS ----+
                                                    |
Owner/operator surface ----------- HTTPS ---------->+--> CallYourAgent (1 instance)
                                                    |        |
CALL-E terminal webhook ---------- HTTPS ---------->+        +--> persistent SQLite volume
                                                             |
                                                             +--> CALL-E Calls API
```

A reverse proxy or hosting platform should terminate TLS and forward HTTP to the Node process. The application itself currently serves HTTP.

## Persistent storage

For a durable deployment use:

```text
CYA_STORE=sqlite
CYA_SQLITE_PATH=/data/callyouragent.db
```

`CYA_SQLITE_PATH` should point to a writable **persistent volume**, not an ephemeral container filesystem. SQLite WAL mode may create the database, `-wal`, and `-shm` files alongside each other, so persist the containing directory rather than copying only the main database file while the service is running.

Use one application instance against a SQLite database. The current HTTP rate limiter is also process-local. Moving to multiple application instances requires both a multi-writer store such as Postgres that preserves the existing uniqueness/transaction semantics and a shared rate limiter. Do not place multiple CallYourAgent processes on the same SQLite file as the supported production topology.

For backup/restore, prefer volume snapshots or a SQLite-aware backup performed with the database in a consistent state. Test restores before depending on them.

## Process lifecycle

The runtime owns the HTTP server, lifecycle sweep, and backing store as one unit.

On `SIGTERM` or `SIGINT` it:

1. stops scheduling new lifecycle sweeps;
2. stops accepting new HTTP connections and drains active requests;
3. waits for any already-running lifecycle sweep to finish;
4. closes the store exactly once.

Configure the hosting platform with enough termination grace for active HTTP/provider work to finish. The runtime deliberately does not pretend that killing the process can cancel a phone call that CALL-E may already have accepted; persisted idempotency/call-attempt state remains the recovery source of truth after restart.

CALL-E HTTP operations are independently bounded by `CYA_CALLE_HTTP_TIMEOUT_MS` (15 seconds by default). The bound applies to both `POST /v1/calls` and `GET /v1/calls/{id}`. A create timeout is intentionally treated as an ambiguous side effect by the control plane because the provider may have accepted the request before the local timeout; recovery therefore reuses the exact persisted idempotency key. A polling timeout only fails that reconciliation pass and never creates a replacement phone call. This keeps a hung provider connection from pinning a lifecycle sweep or graceful shutdown indefinitely.

Runtime construction is also exception-safe after durable storage opens: if later policy/lifecycle/HTTP construction throws, the SQLite store is closed before the startup error propagates.

## Public HTTPS and CALL-E webhooks

Live CALL-E mode requires a stable externally reachable HTTPS origin:

```text
CYA_PUBLIC_BASE_URL=https://cya.example.com
```

The backend constructs its terminal webhook URL from this origin. Keep the origin stable while calls are active so delayed provider events still reach the same control plane.

Current CALL-E terminal webhooks are treated as unsigned. CallYourAgent therefore protects the endpoint with an application-owned high-entropy `CYA_CALLE_WEBHOOK_TOKEN` in the webhook URL and separately requires `CALL-E-Event-Id` to equal the body event id before state changes are applied.

Because the capability token is carried in the URL query string, configure reverse-proxy, CDN, APM, and access logging so `/webhooks/calle` query strings are **redacted or not logged**. Never expose the token to browser bundles or agent/MCP processes. If CALL-E later provides signed webhook verification, that should augment or replace this capability-token boundary.

## Credential split

For an internet-exposed deployment prefer `CYA_API_CREDENTIALS_JSON` instead of handing every integration the legacy full-access `CYA_API_TOKEN`.

The safest setup path is to generate the repository's standard four-role bundle rather than hand-editing scope arrays:

```bash
npm ci
export CYA_API_CREDENTIALS_JSON="$(npm run --silent credentials:generate)"
```

The command emits one JSON array containing four independently generated high-entropy bearer tokens with these exact roles:

- `agent`: `agent:read`, `agent:write`, `decision:read`, `audit:read`;
- `owner`: `agent:read`, `audit:read`, `owner:callback`;
- `operator-read`: `agent:read`, `audit:read`;
- `reconciler`: `calls:reconcile`.

Store the resulting JSON as one secret value in the hosting platform. Do not commit the generated output, paste it into browser code, or reuse one role's token for another process. In particular, owner/operator credentials intentionally lack `decision:read`, and browser-facing credentials intentionally lack `calls:reconcile`.

If the platform's secret UI does not support command substitution, run `npm run --silent credentials:generate` locally once, copy the single JSON line into the `CYA_API_CREDENTIALS_JSON` secret, then discard terminal history/output according to your local secret-handling policy. Regenerate the whole bundle if any generated token is exposed.

Custom credentials remain supported when a deployment genuinely needs a different split, but start from the standard role definitions in `src/credential-roles.ts` rather than widening a browser token for convenience. Avoid `*` except for tightly controlled trusted administration.

`decision:read` is intentionally separate from ordinary observational read access because `GET /v1/escalations/:id` can return the owner's durable answer and structured result. The standard agent role includes it so the agent that raised an escalation can resume the affected scope; standard owner/operator-read roles do not.

Store bearer credentials, `CALLE_API_KEY`, owner phone configuration, and the webhook capability token in the hosting platform's secret store. Do not bake them into an image or commit them to the repository.

## Fake-first bring-up

Before enabling real phone calls, deploy with:

```text
CYA_CALL_PROVIDER=fake
CYA_STORE=sqlite
```

Verify health, readiness, persistence across restart, agent/MCP registration, decision/callback flows, audit history, and safe-checkpoint instruction consumption. The fake provider is intentionally deterministic so this path can be exercised without CALL-E credentials or credits.

Only then switch to:

```text
CYA_CALL_PROVIDER=calle
```

Live mode additionally requires `CALLE_API_KEY`, `CYA_OWNER_PHONE`, `CYA_PUBLIC_BASE_URL`, and `CYA_CALLE_WEBHOOK_TOKEN`. Switching provider mode does not change the agent-facing HTTP/MCP contract.

## Health, readiness, and monitoring

`GET /health` is an unauthenticated **process liveness** endpoint. It only means the HTTP process is serving requests.

`GET /ready` is an unauthenticated, side-effect-free **deployment readiness/configuration** endpoint. It reports only non-secret operational facts: selected provider mode, store mode, whether live CALL-E configuration/public-webhook configuration was validated at startup, and `providerNetworkChecked: false`. A successfully booted `calle` runtime can therefore report that all required local configuration was present without implying that CALL-E itself is reachable, the owner phone is authorized, public ingress is externally routable, or a real call has succeeded. `/ready` never sends a CALL-E request and never triggers a phone side effect.

This distinction is intentional:

- `/health` answers “is this process alive?”;
- `/ready` answers “did the selected runtime mode pass local startup configuration validation?”;
- neither endpoint is evidence of live provider success.

Operationally monitor at least:

- process restarts and failed graceful shutdowns;
- lifecycle sweep errors;
- `call_attempt_ambiguous`, `call_recovery_exhausted`, and `call_attempt_stalled` audit events;
- HTTP `401`, `403`, and `429` rates;
- persistent-volume capacity and backup health.

The audit timeline intentionally omits full decision answers, callback transcripts, and owner instruction text from operational metadata.

## Current deployment boundaries

The following are intentional limitations, not hidden capabilities:

- one SQLite-backed control-plane instance is the supported reference topology;
- rate limits are process-local;
- TLS is expected to terminate at the platform/reverse proxy;
- `/health` is liveness only;
- `/ready` validates local selected-mode configuration only and explicitly does not probe CALL-E;
- real Claude Code host acceptance still requires running the documented MCP registration in an actual Claude Code environment;
- live CALL-E success must not be claimed until a real authorized credential, owner destination, and public HTTPS webhook path are exercised successfully.
