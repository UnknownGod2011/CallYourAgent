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

## Idempotency and ambiguous side effects

Every phone side effect has a stable control-plane idempotency key. The real CALL-E adapter forwards that stable value using CALL-E's `Idempotency-Key` header.

A provider timeout or transport exception after request transmission is not treated as a known failure. The attempt becomes `ambiguous`, while retaining the exact original task, metadata, purpose, and idempotency key. Reconciliation may then replay the same logical create request with the same idempotency key. This is important: recovery never invents a new key merely because the local process did not receive the first response.

The escalation/callback remains linked to that ambiguous attempt, so a process restart with durable storage can resume recovery instead of orphaning the side effect.

The fake provider implements the same provider-side deduplication behavior, allowing tests to verify duplicate retries do not create duplicate calls.

## Persistence evolution

`InMemoryControlPlaneStore` is the first deterministic implementation of the store contract. It exists to validate domain behavior before selecting a database. A durable implementation should preserve the same semantics and add transactions/unique constraints for:

- escalation idempotency keys,
- callback idempotency keys,
- provider call ids,
- webhook event ids,
- instruction consumption.

Persisted `CallAttempt` rows must include the exact replayable provider request fields used by recovery; storing only a provider id is insufficient when the original create response may never have reached the control plane.

## CALL-E mapping

The production adapter should use the current asynchronous Calls API:

- `POST /v1/calls` to create a call;
- `Idempotency-Key` for safe retries;
- caller-owned `metadata` for run/escalation/callback correlation;
- `result_schema` / `recipient_result_schema` for owner decisions and callback instructions;
- `GET /v1/calls/{call_id}` for reconciliation;
- terminal webhooks for low-latency completion, deduplicated by event id.

`CALLE_API_KEY` must only exist in trusted server environments.

## Next architectural layers

1. Durable SQL store with transactional uniqueness.
2. Webhook ingestion and event-id deduplication sharing the same terminal transition logic as polling.
3. HTTP service exposing the same control-plane methods.
4. MCP server implemented as a thin adapter over the HTTP/core methods.
5. TypeScript client SDK.
6. Claude Code integration as the first end-to-end external agent adapter.
7. Codex / ChatGPT adapters only where current platform capabilities support the required tool/checkpoint semantics.
