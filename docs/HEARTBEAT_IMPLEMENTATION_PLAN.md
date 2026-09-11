# Heartbeat implementation plan

The persistence layer already exposes `ControlPlaneStore.updateRunIfCurrent(runId, expectedUpdatedAt, next)` with first-writer-wins semantics and rollback-safe implementations for the in-memory and SQLite stores.

The remaining integration work is intentionally narrow:

1. `ControlPlane.heartbeat` must capture the caller's `updatedAt` version before entering the transaction.
2. It must build a candidate run from that version and call `updateRunIfCurrent` rather than replacing the map entry directly.
3. If `applied` is false, it must return the authoritative run and emit no `run_status_reported` audit event.
4. If `applied` is true, it may emit exactly one `run_status_reported` event describing the committed candidate.
5. The method must preserve fields that are not part of the heartbeat patch and must not revert a newer terminal/paused state.
6. Regression coverage must exercise two independent control-plane workers over the same SQLite database, including a stale loser and a failed transaction rollback.

Until this wiring is merged, `updateRunIfCurrent` is a tested persistence primitive but heartbeat freshness is not yet an end-to-end control-plane guarantee. This document is a boundary marker to prevent the repository from claiming shared-store heartbeat safety prematurely.
