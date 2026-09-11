# Shared-store freshness contract

CallYourAgent currently supports a single-process SQLite deployment, but the control-plane API is intentionally designed so a future shared transactional store can be added without weakening correctness. This document records the freshness rules that every store adapter must preserve.

## Rule 1: never overwrite a whole entity from a stale mirror

A control-plane operation may read a run, escalation, call attempt, or instruction from a local mirror to decide what work is eligible. Before it commits a mutation, the store must either:

- re-read the authoritative row inside the transaction, or
- apply a conditional compare-and-set (CAS) update keyed by the entity id and the expected version/updated-at token.

A stale read must fail closed or converge to the already-committed winner. It must never silently replace newer fields with an older snapshot.

## Rule 2: domain writes must preserve unrelated fields

When a mutation only changes one concern, the adapter must update only that concern (or merge against an authoritative row). Examples:

- a heartbeat changes `summary`, `currentScope`, and `updatedAt`, but must not reset run status;
- instruction acknowledgement changes `status` and `consumedAt`, but must not erase source metadata;
- call reservation changes the call-attempt identity and escalation status, but must not erase retry or provider correlation fields;
- recovery bookkeeping changes the recovery markers, but must not clear a terminal winner.

## Rule 3: first committed winner semantics remain authoritative

The existing atomic claims for idempotency, terminal provider outcomes, owner-decision identity, callback instruction-set identity, webhook event identity, and audit sequence allocation remain the source of truth. Freshness logic must not bypass or duplicate those claims.

## Rule 4: stale losers must be observable without leaking sensitive payloads

If a CAS or conditional write loses, the control plane should re-read the winner and return/converge to it. If the attempted write carried semantically conflicting provider evidence, emit at most one privacy-safe audit event containing identifiers, statuses, and a conflict flag—not owner answers, instruction text, transcripts, or raw provider payloads.

## Required contract tests for a future adapter

Every shared-store implementation should prove, with at least two independent workers/connections:

1. heartbeat/report-status cannot revert a newer run status or summary;
2. exact instruction acknowledgement is idempotent and cannot consume an instruction for the wrong run;
3. escalation call reservation has one winner and preserves unrelated escalation fields;
4. deferral/expiry cannot overwrite a resolved or terminal escalation;
5. active-call progress cannot move a terminal attempt back to an active state;
6. ambiguous recovery cannot replace a committed terminal outcome;
7. loser responses converge to the durable winner after re-read;
8. transaction rollback restores both entity fields and all claim/sequence side effects.

Until those tests exist for a real shared store, the supported production topology remains the documented single-process SQLite reference deployment.
