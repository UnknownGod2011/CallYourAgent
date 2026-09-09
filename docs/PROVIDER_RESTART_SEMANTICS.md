# Provider restart semantics

CallYourAgent deliberately treats the control plane as the source of durable orchestration truth while allowing different phone-provider adapters to have different runtime persistence models.

## Fake provider

`FakeCallProvider` is deterministic test infrastructure. Its accepted-call registry is intentionally process-local, so a fresh fake-provider instance created after a control-plane restart does not remember prior calls by itself.

For that reason the generic `CallProvider` port exposes an optional `rehydrate(...)` hook. Before polling a persisted active fake call, the control plane can reconstruct only the provider-local state that it already durably owns: provider call id, status, original idempotency key, purpose, task, and metadata. Rehydration must not create a new logical phone call, emit a second provider-start audit event, or invent new terminal evidence.

This hook exists to make deterministic fake deployment/restart tests realistic. It is not a requirement that production providers copy their active calls into CallYourAgent memory.

## Production CALL-E

CALL-E is a remote asynchronous provider. Once `POST /v1/calls` returns a concrete provider call id, that identity is persisted in the CallYourAgent `CallAttempt` and CALL-E remains the remote source of provider execution state.

After a control-plane process restart, the production adapter does **not** need `rehydrate(...)`. Reconciliation uses the persisted provider call id with:

```text
GET /v1/calls/{call_id}
```

The control plane then applies the returned active or terminal observation through the same normal reconciliation state machine.

A restart by itself must never cause CallYourAgent to replay `POST /v1/calls` for an already accepted call. Create replay is reserved for the distinct ambiguous-create case, where the original provider request may have succeeded but the control plane never received a concrete call id. Even there, recovery reuses the exact original `Idempotency-Key` and is bounded/fail-closed.

## Durable invariants

Across both provider modes:

- a persisted concrete `providerCallId` is authoritative correlation state;
- ordinary restart reconciliation never invents a replacement idempotency key;
- an accepted callback remains the same callback after restart;
- an accepted owner-decision call remains linked to the same escalation and blocked scope after restart;
- terminal callback steering is queued exactly once and consumed only at a later safe checkpoint;
- terminal owner decisions are persisted exactly once and release only their associated blocked scope;
- provider/network I/O occurs outside SQLite transactions, while resulting local durability units use the store transaction boundary where required.

## Verification

`tests/fake-provider-rehydration.test.ts` proves the deterministic fake provider can reconstruct active process-local state from persisted accepted-call data without masquerading as a second provider create.

`tests/calle-provider-restart.test.ts` proves the production-style boundary with a fresh `CalleCallProvider` instance and a reopened SQLite store. It verifies that both callback and owner-decision reconciliation issue only `GET /v1/calls/{id}` after restart, never replay `POST /v1/calls`, preserve the original provider identity, and apply terminal steering/decision state exactly once.

These tests do not claim a live CALL-E phone call. They verify CallYourAgent's restart contract against the documented asynchronous CALL-E adapter using deterministic mocked HTTP responses.
