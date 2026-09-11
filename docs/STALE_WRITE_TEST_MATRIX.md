# Stale-write test matrix

This document is the executable-planning companion to `docs/STORE_FRESHNESS.md`. It identifies the mutations that must be proven safe when two workers hold stale local mirrors of the same run, escalation, call attempt, or instruction.

## Required invariant

A stale worker must never replace an authoritative entity with an older whole-object snapshot. Every mutation must either re-read inside the transaction, use a conditional/versioned write, or converge to the already-committed winner. Unrelated fields must survive.

## Priority matrix

| Mutation | Authoritative fields | Stale-worker failure prevented | Minimum two-worker regression |
| --- | --- | --- | --- |
| `heartbeat` / status report | `summary`, `currentScope`, `updatedAt` | older progress erases newer progress or terminal status | worker A writes fresh summary; worker B writes from stale run; final state keeps terminal/other fields and winner policy is explicit |
| instruction acknowledgement | `status`, `acknowledgedAt` | duplicate or late acknowledgement rewrites consumed state | both workers acknowledge same instruction; one durable acknowledgement, idempotent replay |
| escalation reservation | `callAttemptId`, `status` | duplicate provider call after stale read | both workers reserve same escalation; one attempt identity and one provider start |
| escalation deferral/expiry | `status`, `updatedAt` | expiry overwrites a resolved escalation or vice versa | resolve and expire race; committed winner remains authoritative |
| active-call progress | `status`, provider correlation | stale poll rewrites newer webhook/provider state | poll and webhook race; final attempt equals first terminal outcome |
| ambiguous recovery | provider id/status | repeated recovery creates duplicate call | two workers recover same ambiguous attempt; one idempotent provider start |

## Implementation order

1. Add explicit conditional store primitives for run status/heartbeat and instruction acknowledgement.
2. Route control-plane mutations through those primitives.
3. Add independent SQLite connection tests before claiming shared-store readiness.
4. Mirror the same contract in the in-memory adapter and transaction tests.
5. Keep provider I/O outside persistence transactions.

This matrix is intentionally scoped to correctness work; it does not expand the supported deployment beyond the current single-process SQLite topology.
