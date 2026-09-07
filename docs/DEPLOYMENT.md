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

Recommended roles:

- agent/MCP credential: `agent:read`, `agent:write`, optionally `audit:read`;
- owner-facing callback surface: `owner:callback` plus only the read scopes it genuinely needs;
- trusted reconciliation worker/operator: `calls:reconcile`;
- avoid `*` except for tightly controlled trusted administration.

Store bearer credentials, `CALLE_API_KEY`, owner phone configuration, and the webhook capability token in the hosting platform's secret store. Do not bake them into an image or commit them to the repository.

## Fake-first bring-up

Before enabling real phone calls, deploy with:

```text
CYA_CALL_PROVIDER=fake
CYA_STORE=sqlite
```

Verify health, persistence across restart, agent/MCP registration, decision/callback flows, audit history, and safe-checkpoint instruction consumption. The fake provider is intentionally deterministic so this path can be exercised without CALL-E credentials or credits.

Only then switch to:

```text
CYA_CALL_PROVIDER=calle
```

Live mode additionally requires `CALLE_API_KEY`, `CYA_OWNER_PHONE`, `CYA_PUBLIC_BASE_URL`, and `CYA_CALLE_WEBHOOK_TOKEN`. Switching provider mode does not change the agent-facing HTTP/MCP contract.

## Health and monitoring

`GET /health` is an unauthenticated **process liveness** endpoint. It does not claim that CALL-E credentials, public webhook routing, or the phone provider are currently healthy.

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
- `/health` is liveness, not provider readiness;
- real Claude Code host acceptance still requires running the documented MCP registration in an actual Claude Code environment;
- live CALL-E success must not be claimed until a real authorized credential, owner destination, and public HTTPS webhook path are exercised successfully.
