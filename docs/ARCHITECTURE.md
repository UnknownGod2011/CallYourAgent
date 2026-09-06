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
4. A call attempt is created through `CallProvider`.
5. The agent continues unrelated work. A checkpoint reports only unresolved *blocking* scope ids.
6. CALL-E/fake-provider terminal evidence is reconciled into a structured owner decision.
7. The affected scope can resume once its escalation is resolved.

A non-blocking escalation never appears in `unresolvedBlockingScopes`.

## Owner -> agent callback flow

1. Owner requests a callback for a running agent.
2. The control plane snapshots the agent's current summary/scope into the phone task.
3. The phone provider calls the owner.
4. Owner questions or steering are extracted into structured instructions.
5. Instructions are persisted as `queued`.
6. The running agent polls/pulls at a safe checkpoint and then marks them consumed.

This is deliberately not described as interrupting an in-flight model generation.

## Idempotency and ambiguous side effects

Every phone side effect has a stable control-plane idempotency key. The real CALL-E adapter must forward a derived stable value using CALL-E's `Idempotency-Key` header. Provider timeouts after request transmission are treated as ambiguous rather than blindly retried under a new key.

The fake provider implements the same deduplication behavior, allowing tests to verify duplicate retries do not create duplicate calls.

## Persistence evolution

`InMemoryControlPlaneStore` is the first deterministic implementation of the store contract. It exists to validate domain behavior before selecting a database. A durable implementation should preserve the same semantics and add transactions/unique constraints for:

- escalation idempotency keys,
- callback idempotency keys,
- provider call ids,
- webhook event ids,
- instruction consumption.

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
2. Real CALL-E provider behind the existing port.
3. HTTP service exposing the same control-plane methods.
4. MCP server implemented as a thin adapter over the HTTP/core methods.
5. TypeScript client SDK.
6. Claude Code integration as the first end-to-end external agent adapter.
7. Codex / ChatGPT adapters only where current platform capabilities support the required tool/checkpoint semantics.
