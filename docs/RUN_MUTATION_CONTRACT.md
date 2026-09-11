# Run mutation contract

This document defines the persistence boundary for run heartbeat/status writes. It is intentionally narrower than a generic `update` method: the control plane must not replace a run from a stale process-local snapshot.

## Required semantics

`updateRunIfCurrent(runId, expectedUpdatedAt, next)` must:

1. Read the authoritative current run inside the adapter's write boundary.
2. Apply `next` only when the authoritative `updatedAt` exactly equals `expectedUpdatedAt`.
3. Return the authoritative winner and `applied=false` when another writer has already advanced the run.
4. Preserve unrelated fields from the authoritative row; callers must construct `next` from a fresh authoritative value, not from a stale mirror.
5. Roll back both the entity mutation and any audit/sequence side effects when the surrounding transaction fails.
6. Make the comparison and write one atomic operation for the adapter's supported concurrency model.

The control plane must treat the returned run as authoritative in both the applied and rejected cases. A rejected stale writer must not emit a progress audit event that describes its losing snapshot.

## Heartbeat flow

The intended flow is:

1. Load the run and retain its `updatedAt` as the expected version.
2. Build the heartbeat patch from the caller's requested fields.
3. In one store transaction, re-read the current run, verify it is still `running`, and call `updateRunIfCurrent`.
4. If `applied=false`, return the durable winner without mutating or auditing the losing update.
5. If `applied=true`, append the progress audit event using the canonical committed run state.

This preserves branch-scoped work semantics: a status race must not overwrite a newer scope or summary, and it must not affect escalation or callback state.

## Adapter requirements

### In-memory

The implementation must compare against the current map value, clone stored values, and restore the run and audit sequence allocator on rollback.

### SQLite

The implementation must reload the authoritative row in the same protected write transaction used for the compare-and-set. A separate connection holding an older mirror must lose cleanly and observe the winner after the transaction completes.

### Future shared stores

A Postgres-style adapter should implement the same contract with a conditional update such as `UPDATE ... WHERE id = $1 AND updated_at = $2 RETURNING ...`, or an equivalent serializable transaction. The public control-plane API should not need to know which strategy is used.

## Required regressions

The shared test suite should prove:

- a fresh heartbeat applies and updates the timestamp;
- a stale heartbeat returns the durable winner and preserves the winner's summary/scope;
- two independent workers racing on the same run produce one applied update;
- a failed transaction restores the pre-race run and audit sequence;
- a stale loser does not create a misleading `run_status_reported` audit event;
- close/reopen preserves the winning run state in SQLite.

## Scope boundary

This contract does not claim that the current SQLite deployment is horizontally scalable. It is the semantic boundary that a future shared persistence adapter must preserve before the deployment topology changes.
