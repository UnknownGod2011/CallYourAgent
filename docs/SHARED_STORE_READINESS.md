# Shared-store readiness contract

CallYourAgent currently supports a single Node process backed by SQLite. This document defines the evidence required before claiming support for multiple control-plane workers or a future Postgres adapter.

## Required guarantees

A shared store must make every cross-worker mutation authoritative at the persistence boundary. A worker must not write an older whole-entity snapshot merely because it read that snapshot before another worker committed a change.

The adapter must provide one of these patterns for each mutable entity:

- an atomic conditional update keyed by the entity id and expected version/updated-at token;
- an authoritative re-read followed by a write inside the same transaction;
- a domain-specific claim primitive whose winner is durable and replayable.

The mutation result must distinguish `applied`, `already-current`, and `stale-rejected` outcomes so callers can converge without guessing.

## Domain coverage

Before shared-store readiness is declared, independent-worker regressions must cover:

1. run heartbeat/status updates preserving unrelated fields;
2. exact instruction acknowledgement preserving queue ordering and rejecting stale duplicate acknowledgements;
3. escalation reservation, deferral, expiry, and policy release races;
4. call-attempt reservation and provider-start audit ordering;
5. poll/webhook/recovery races over active-call progress;
6. terminal outcome authority and exactly-once decision/instruction effects;
7. ambiguous recovery single-flight and bounded retry behavior;
8. canonical audit sequence allocation and rollback behavior.

Each case must be tested with two independent store instances against the same database, with at least one stale-read interleaving and one rollback path.

## Operational boundary

The current supported deployment remains one process with one SQLite volume. The fake CALL-E provider remains the deterministic acceptance provider. Live CALL-E and genuine Claude Code host acceptance are separate external prerequisites and must not be implied by store readiness.

## Implementation order

1. Add explicit conditional/CAS primitives for run status and instruction acknowledgement.
2. Route control-plane mutations through those primitives.
3. Add independent SQLite-worker tests and in-memory parity tests.
4. Repeat the same contract against the next shared-store adapter.
5. Only then document multi-worker deployment support.
