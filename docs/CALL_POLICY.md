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

A policy-denied escalation remains `pending` and has no `callAttemptId`. This distinction matters: no external phone side effect has occurred; a blocking escalation still blocks only its own scope; unrelated scopes can continue; lifecycle reconciliation reevaluates policy; and an escalation can expire without ever calling the owner.

## Budgets

Decision-call budgets count attempts that may have produced a real phone side effect. Ambiguous provider attempts therefore count toward budget because the safe assumption is that the provider might have accepted the request.

Per-owner 24-hour budget attribution follows the persisted call attempt's `runId` to its run, then to the registered agent's `ownerId`. It does not depend on phone-provider metadata outside the control plane.

## Bounded ambiguous-call recovery

The runtime now includes a periodic `LifecycleManager` sweep. It advances deferred/expired escalations, polls active decision and callback calls, and automatically recovers ambiguous create requests without requiring an agent to call reconciliation endpoints.

Automatic recovery is deliberately bounded. The manager replays the exact persisted provider request and the exact original idempotency key. Failed recovery attempts receive exponential backoff capped by configuration. Once the configured automatic attempt budget is exhausted, the attempt remains `ambiguous` and receives `automaticRecoveryExhaustedAt`; it is not relabeled `failed`, because the original request may actually have reached the provider. This is a fail-closed manual-review state that prevents automatic duplicate-call risk.

The lifecycle manager records `call_recovery_scheduled` and `call_recovery_exhausted` audit events without copying call task/transcript content.

Runtime settings are:

- `CYA_LIFECYCLE_SWEEP_INTERVAL_MS` (default 5000)
- `CYA_MAX_AUTOMATIC_RECOVERY_ATTEMPTS` (default 3)
- `CYA_RECOVERY_BASE_BACKOFF_MS` (default 5000)
- `CYA_RECOVERY_MAX_BACKOFF_MS` (default 60000)

An explicit operator/agent reconciliation remains an intentional manual override path; automatic background behavior is what is bounded by this policy.

## Owner-requested callbacks

The decision policy gate intentionally applies only to autonomous **agent -> owner** decision calls. An owner-requested callback is an explicit human action and is not suppressed by decision priority or quiet hours. Callback-specific abuse/rate limits belong at the authenticated API boundary and are a separate hardening concern.

## Safety properties

- Policy runs before a new call attempt is persisted or sent to CALL-E.
- Deferred calls do not consume provider idempotency keys or budget slots.
- Critical quiet-hour bypass is explicit and configurable.
- Expiry is checked before deferred policy reevaluation.
- Automatic ambiguous recovery always preserves the original provider idempotency key.
- Backoff state and automatic-recovery exhaustion live on the durable `CallAttempt` and therefore survive SQLite restart.
- Exhausted ambiguity stays ambiguous rather than pretending the provider definitely failed.
- Background reconciliation does not consume owner instructions; agents still consume them only at safe checkpoints.

## Next policy work

- Add API-level callback rate limiting and credential scopes.
- Move the automatic-recovery guard into the core reconciliation primitive if manual reconciliation should also be bounded in untrusted deployments.
- Add stale in-progress call timeout policy separate from ambiguous create recovery.
