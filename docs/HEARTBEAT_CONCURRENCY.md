# Heartbeat concurrency contract

`ControlPlane.heartbeat(runId, update)` is an authoritative run mutation, not a best-effort in-memory refresh.

## Required semantics

1. Read the run snapshot and retain its `updatedAt` as the compare-and-set version.
2. Construct the next snapshot by changing only `summary`, `currentScope`, and `updatedAt`.
3. Commit through `ControlPlaneStore.updateRunIfCurrent(runId, expectedUpdatedAt, next)` inside the store transaction boundary.
4. If the CAS loses, return the store's authoritative winner and do not emit `run_status_reported` for the stale update.
5. Preserve unrelated fields and never publish a stale whole-object snapshot.
6. If audit allocation or another side effect fails, rollback must restore both the run snapshot and the audit sequence allocator.

## Race cases that must be covered

- Two workers heartbeat from the same `updatedAt`; exactly one update is applied.
- The losing worker receives the durable winner and does not overwrite `summary` or `currentScope`.
- A stale heartbeat cannot revert a newer terminal/paused run state.
- Independent SQLite connections converge on the same winner after reopen.
- A failed heartbeat transaction leaves the run and audit timeline unchanged.

## Audit rule

Only the worker whose CAS mutation is applied may append `run_status_reported`. A stale loser must not create a misleading progress event, because the event would describe state that never became authoritative.

## Deployment boundary

These semantics are required for any future shared store. The current supported SQLite deployment remains single-process; the contract must still be tested with independent SQLite connections so adapter behavior does not silently weaken when the topology changes.
