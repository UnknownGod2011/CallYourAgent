# Heartbeat CAS acceptance

This document is the executable acceptance target for the next runtime change. It is intentionally separate from the lower-level store contract so the control-plane integration can be reviewed and tested as a user-visible behavior.

## Required behavior

1. `ControlPlane.heartbeat(runId, update)` reloads the authoritative run inside the store transaction.
2. A stale worker cannot replace a newer `updatedAt`, summary, scope, paused state, or terminal state.
3. A rejected stale write returns the authoritative run snapshot and emits no `run_status_reported` audit event.
4. A successful heartbeat preserves `id`, `agentId`, `startedAt`, and all unrelated fields.
5. Returned snapshots are isolated from canonical store state.
6. If audit publication fails after the run mutation, transaction rollback restores the prior run and audit sequence.
7. Two independent SQLite connections converge on the same durable winner.

## Minimum regression cases

- successful heartbeat advances `updatedAt` and emits one progress event;
- two workers start from the same snapshot, one commits first, the other loses without rollback;
- stale heartbeat cannot overwrite a newer paused/terminal transition;
- stale heartbeat cannot revert a newer `currentScope` or summary;
- failed audit publication rolls back both the run mutation and audit sequence;
- close/reopen preserves the committed winner.

## Scope boundary

The current store primitive already provides compare-and-set behavior. The pending implementation work is to route the public heartbeat method through that primitive without widening the domain API or pretending that an in-flight model generation can be interrupted. Human decisions and instructions remain durable state consumed at safe checkpoints.
