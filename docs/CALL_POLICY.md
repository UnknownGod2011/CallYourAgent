# Decision call policy

CallYourAgent treats a phone call as a real-world side effect, not as the default response to every agent question. The control plane persists an escalation first and evaluates policy before creating a provider call attempt.

## Current policy controls

Agent -> owner decision calls support:

- minimum escalation priority;
- quiet hours in an IANA timezone;
- a priority threshold that may bypass quiet hours (critical by default);
- maximum decision calls per run;
- maximum decision calls per owner across the previous 24 hours.

These controls are configured server-side with:

- `CYA_MIN_DECISION_PRIORITY`
- `CYA_MAX_DECISION_CALLS_PER_RUN`
- `CYA_MAX_DECISION_CALLS_PER_OWNER_24H`
- `CYA_QUIET_HOURS_START`
- `CYA_QUIET_HOURS_END`
- `CYA_QUIET_HOURS_TIME_ZONE`
- `CYA_QUIET_HOURS_BYPASS_PRIORITY`

Quiet-hour start/end values are local hours from 0 through 23. Windows that cross midnight are supported. If start and end are equal, the whole day is treated as quiet.

## Deferred escalation semantics

A policy-denied escalation remains `pending` and has no `callAttemptId`. This distinction matters:

1. no external phone side effect has occurred;
2. a blocking escalation still blocks only its own scope;
3. unrelated scopes can continue;
4. `reconcileEscalation` reevaluates policy and may start the call later;
5. if `expiresAt` passes first, reconciliation marks the escalation `expired` without ever calling the owner.

This lets quiet hours defer an important decision rather than losing it or waking the owner unnecessarily.

## Budgets

Decision-call budgets count attempts that may have produced a real phone side effect. Ambiguous provider attempts therefore count toward budget because the safe assumption is that the provider might have accepted the request.

Per-owner 24-hour budget attribution follows the persisted call attempt's `runId` to its run, then to the registered agent's `ownerId`. It does not depend on phone-provider metadata outside the control plane.

## Owner-requested callbacks

The current policy gate intentionally applies only to autonomous **agent -> owner** decision calls. An owner-requested callback is an explicit human action and is not suppressed by decision priority or quiet hours. Callback-specific abuse/rate limits belong at the authenticated API boundary and are a separate hardening concern.

## Safety properties

- Policy runs before a new call attempt is persisted or sent to CALL-E.
- Deferred calls do not consume provider idempotency keys or budget slots.
- Critical quiet-hour bypass is explicit and configurable.
- Expiry is checked before deferred policy reevaluation.
- Existing provider idempotency and ambiguous-call recovery behavior is unchanged once a call attempt exists.

## Next policy work

- Persist/expose the policy reason in the audit timeline so demos and operators can see why a call was deferred.
- Add bounded recovery-attempt counters and retry scheduling for ambiguous calls.
- Add API-level callback rate limiting and credential scopes.
- Add a periodic lifecycle sweep so deferred/expired escalations do not require an agent-driven reconcile call.
