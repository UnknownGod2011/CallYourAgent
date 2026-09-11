# Heartbeat integration test plan

This plan is the executable acceptance target for wiring `ControlPlane.heartbeat` to the store-level `updateRunIfCurrent` compare-and-set primitive.

## Required behavior

1. A heartbeat reads the authoritative run snapshot and uses its `updatedAt` as the CAS token.
2. The successful writer updates only heartbeat-owned fields (`summary`, `currentScope`, `updatedAt`).
3. Unrelated fields and newer terminal/paused state are never replaced by a stale heartbeat.
4. A stale writer returns the durable winner and emits no `run_status_reported` audit event.
5. Only the committed writer emits one progress audit event with the committed scope and summary-change flag.
6. Returned snapshots are isolated from caller mutation.
7. If the surrounding transaction fails, run state and audit sequence allocation roll back together.

## Test cases

### In-memory control-plane path

- Start one running run and capture its initial `updatedAt`.
- Apply one heartbeat and assert the new summary/scope plus one audit event.
- Reuse the old `updatedAt` through the store primitive and assert `applied: false`, the current winner, and unchanged audit count.
- Mutate the returned winner and assert the canonical run is unchanged.

### Independent SQLite workers

- Open two store instances against the same database.
- Load the same run snapshot in both workers.
- Commit worker A's heartbeat.
- Attempt worker B's heartbeat with the stale token.
- Assert worker B receives the durable winner and cannot revert A's summary/scope.
- Reopen the database and assert the winner remains durable.

### Audit correctness

- Verify stale heartbeat attempts do not create misleading `run_status_reported` records.
- Verify audit sequence numbers remain gap-free after a failed transaction that attempted a heartbeat.

## Scope boundary

This plan intentionally does not permit mid-generation model interruption. Heartbeats are durable status reports only; owner decisions and instructions continue to be consumed at safe checkpoints.
