# Architecture

## Goal

CallYourAgent is a durable control plane between long-running agents, their owners, and a phone transport. The core system must remain correct even if the phone provider, MCP client, or agent process retries, restarts, or temporarily disappears.

## Components

```text
Agent / MCP / SDK / platform adapter
              |
              v
       Agent Control Plane
       |      |        |
       |      |        +--> instruction queue
       |      +-----------> escalation + decision state
       +------------------> call attempt state
              |
              v
        CallProvider port
          /        \
     FakeCall     CALL-E
```

The control plane owns truth. CALL-E only transports a voice interaction.

## Agent -> owner decision flow

1. Agent reports current run state.
2. Agent creates an escalation with a `runId`, `scopeId`, `blocking` flag, and stable idempotency key.
3. The control plane persists the escalation before attempting a phone side effect.
4. A call attempt is persisted with the exact task, metadata, provider name, and stable idempotency key before the provider request is sent.
5. The agent continues unrelated work. A checkpoint reports only unresolved *blocking* scope ids.
6. CALL-E/fake-provider terminal evidence is reconciled into a structured owner decision.
7. The affected scope can resume once its escalation is resolved.

A non-blocking escalation never appears in `unresolvedBlockingScopes`.

## Owner -> agent callback flow

1. Owner requests a callback for a running agent.
2. The control plane snapshots the agent's current summary/scope into the phone task.
3. The exact callback request is persisted before the phone provider is invoked.
4. The phone provider calls the owner.
5. Owner questions or steering are extracted into structured instructions.
6. Instructions are persisted as `queued`.
7. The running agent polls/pulls at a safe checkpoint and then marks them consumed.

This is deliberately not described as interrupting an in-flight model generation.

## HTTP control-plane boundary

`src/http-server.ts` exposes the same domain operations over a small JSON API. Agent-facing routes require `Authorization: Bearer <CYA_API_TOKEN>`; `/health` is intentionally unauthenticated. The API currently exposes agent registration, run start/read/heartbeat, escalation creation/read/reconciliation, checkpoints, owner callback creation/read/reconciliation, and CALL-E webhook ingress.

The HTTP adapter does not own business state. It validates transport-level input and delegates directly to `ControlPlane`, preserving one set of semantics for future MCP and SDK adapters.

Request bodies are size-bounded and responses use `Cache-Control: no-store` because status/decision payloads can contain sensitive agent context.

## CALL-E webhook ingress security

Current CALL-E terminal webhook delivery is unsigned: there is no current provider webhook secret/signature contract. CALL-E does provide the required `CALL-E-Event-Id` header, and current SDK guidance says receivers should verify that it matches the body event `id` and deduplicate by that id.

CallYourAgent therefore uses two checks before domain mutation:

1. an application-owned high-entropy `CYA_CALLE_WEBHOOK_TOKEN`, embedded in the configured webhook URL and compared using constant-time equality;
2. `CALL-E-Event-Id` must exactly match the parsed body event id.

This is deliberately documented as an application-layer secret URL, **not** as a CALL-E signature. If CALL-E adds signed webhooks later, signature verification should replace or augment this boundary without changing `ControlPlane.ingestProviderWebhook`.

## Runtime bootstrap

`src/server.ts` builds a deployable runtime from environment variables:

- `CYA_CALL_PROVIDER=fake|calle` selects deterministic development calls or live CALL-E;
- `CYA_STORE=memory|sqlite` selects test/dev memory state or durable SQLite;
- `CYA_SQLITE_PATH` controls the durable DB path;
- `CYA_API_TOKEN` authenticates agent-facing HTTP routes;
- live CALL-E mode additionally requires `CALLE_API_KEY`, `CYA_OWNER_PHONE`, `CYA_PUBLIC_BASE_URL`, and `CYA_CALLE_WEBHOOK_TOKEN`.

When live mode is selected, the configured CALL-E webhook URL is constructed by the backend itself so the user does not need to hand-wire a separate callback URL format.

## Idempotency and ambiguous side effects

Every phone side effect has a stable control-plane idempotency key. The real CALL-E adapter forwards that stable value using CALL-E's `Idempotency-Key` header.

A provider timeout or transport exception after request transmission is not treated as a known failure. The attempt becomes `ambiguous`, while retaining the exact original task, metadata, purpose, and idempotency key. Reconciliation may then replay the same logical create request with the same idempotency key. This is important: recovery never invents a new key merely because the local process did not receive the first response.

The escalation/callback remains linked to that ambiguous attempt, so a process restart with durable storage can resume recovery instead of orphaning the side effect.

The fake provider implements the same provider-side deduplication behavior, allowing tests to verify duplicate retries do not create duplicate calls.

## Polling and webhook convergence

Polling and webhooks are delivery mechanisms for the same terminal provider outcome; they must never implement separate business transitions.

`ControlPlane.applyTerminalOutcome` is the single internal transition path for both polling reconciliation and terminal webhook ingestion. This gives the domain these guarantees:

- an owner decision is created at most once for an escalation;
- callback instructions are queued at most once for a call attempt;
- a webhook arriving before a later poll does not cause duplicate state;
- a poll completing before a delayed webhook also remains safe because already-terminal attempts are no-ops;
- duplicate webhook delivery is explicitly deduplicated by provider event id.

`ingestProviderWebhook` executes lookup, terminal transition, and provider-event recording inside the store's synchronous transaction boundary. The durable SQLite implementation therefore commits or rolls back the webhook event and all associated domain mutations together. If a mutation throws, both the SQL transaction and the in-memory mirrors are restored to the pre-event state.

CALL-E's current Calls API documents terminal webhook payloads with a top-level event `id` and the terminal CallTask under `data`; the call task id is `data.id`. `parseCalleTerminalWebhook` validates this boundary and converts only terminal `completed`, `failed`, or `canceled` payloads into the provider-agnostic `CallOutcome` consumed by the control plane.

## Durable persistence

`InMemoryControlPlaneStore` remains the fastest deterministic test implementation. `SqliteControlPlaneStore` is now the default durable architecture for a single control-plane deployment and deliberately preserves the same synchronous `Map`/`Set` contract used by the tested domain layer.

The SQLite store:

- persists agents, runs, escalations, decisions, instructions, replayable call attempts, idempotency mappings, and processed webhook event ids;
- uses WAL mode and an explicit synchronous transaction API;
- reloads in-memory mirrors from SQL after a rollback so memory cannot diverge from committed state;
- enforces unique escalation idempotency keys;
- enforces unique non-null provider call ids;
- uses primary keys for callback/escalation idempotency maps and webhook event ids;
- indexes run/status fields used by instruction and escalation lookup;
- survives process-style close/reopen with queued state and replayable call-attempt state intact.

The implementation uses Node's built-in `node:sqlite` `DatabaseSync`, so the repository currently requires Node 24+. This avoids a native third-party database dependency for the hackathon/reference deployment while keeping SQL semantics and transaction boundaries explicit. A future multi-instance deployment can replace the store with Postgres without changing the `ControlPlane` domain semantics, but that adapter must preserve the same uniqueness and atomicity guarantees.

Persisted `CallAttempt` rows include the exact replayable provider request fields used by recovery; storing only a provider id is insufficient when the original create response may never have reached the control plane.

## CALL-E mapping

The production adapter uses the current asynchronous Calls API:

- `POST /v1/calls` to create a call;
- `Idempotency-Key` for safe retries;
- caller-owned `metadata` for run/escalation/callback correlation;
- `result_schema` / `recipient_result_schema` for owner decisions and callback instructions;
- `GET /v1/calls/{call_id}` for reconciliation;
- terminal webhooks for low-latency completion, deduplicated by event id.

`CALLE_API_KEY` must only exist in trusted server environments.

## Verification architecture

The repository has GitHub Actions CI on `main` and pull requests using Node 24. CI installs dependencies, runs TypeScript typechecking, builds, and executes the Node test suite. This provides an external verification path even when an automation runtime cannot clone the repository directly.

## Next architectural layers

1. MCP server implemented as a thin adapter over the same control-plane semantics.
2. TypeScript client SDK.
3. Claude Code integration as the first end-to-end external agent adapter.
4. Codex / ChatGPT adapters only where current platform capabilities support the required tool/checkpoint semantics.
5. Quiet hours, call budgets, retries/expiry, and auditable policy enforcement before broad UI work.
6. Production deployment hardening: TLS/reverse proxy, secret management, rate limiting, and optional Postgres for multi-instance scale.
