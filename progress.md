# progress.md

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for two-way voice coordination between autonomous AI agents and their owners. The product has SQLite persistence, deterministic fake and production CALL-E providers, same-idempotency ambiguous-call recovery, polling/webhook convergence, authenticated HTTP APIs, a typed TypeScript client, stdio MCP, CI-proven Claude-style branch/checkpoint behavior, autonomous decision-call policy, a durable privacy-aware audit timeline, and now a background lifecycle manager with bounded automatic ambiguous-call recovery.

The core semantics remain unchanged: an agent may call its owner for genuinely important judgment without freezing unrelated scopes; the owner may independently request a callback to hear current status and steer the run; human answers/instructions become durable structured state consumed only at safe checkpoints.

## Exact repo state inspected this run

Before changing code, inspected the full recursive `main` tree at `542115962be51bd81fc5d1363948673b940b1049`, recent commits, repository metadata/permissions, and open issues (none). Read `AGENTS.md`, this file, `README.md`, `docs/ARCHITECTURE.md`, `docs/INTEGRATIONS.md`, and `docs/CALL_POLICY.md` in full. Inspected the current `ControlPlane`, domain model, SQLite store, runtime bootstrap, control-plane tests, CI workflow/tree, and the existing audit/policy architecture. No open issue or PR required coordination.

## Existing foundation preserved

- Agent registration, runs, heartbeat/status, branch-scoped blocking, decisions, callbacks, durable instruction queues, and safe checkpoint consumption.
- `ControlPlaneStore` with in-memory and durable `node:sqlite` implementations, WAL, uniqueness constraints, and webhook transaction rollback/reload behavior.
- Fake CALL-E provider plus production CALL-E Calls API adapter with server-only credentials, structured results, provider idempotency, polling, and terminal webhooks.
- Persist-before-side-effect call attempts and recovery using the exact original provider idempotency key.
- Shared polling/webhook terminal state transition and provider event deduplication.
- Authenticated HTTP control plane, typed TypeScript client, official MCP stdio adapter, and Claude-style end-to-end MCP work-loop tests.
- Decision-call priority gate, quiet hours, critical bypass, per-run/per-owner budgets, expiry, and durable policy-deferral reasons.
- Privacy-aware durable audit timeline with explicit monotonic ordering across SQLite restarts.

## Changes made this run

### Autonomous lifecycle manager

Added `src/lifecycle.ts` with `LifecycleManager`. A sweep now progresses unresolved work independently of an agent explicitly invoking reconcile endpoints:

- revisits `pending`/`calling` decision escalations, so policy-deferred work can later become eligible or expire;
- polls active decision calls for terminal outcomes;
- polls active owner-requested callbacks and queues resulting steering through the existing safe-checkpoint path;
- handles each item independently so one provider/reconciliation error does not prevent unrelated lifecycle work from progressing;
- returns a typed sweep summary with visit/recovery/error counts.

The production CLI runtime wires a periodic lifecycle sweep around the same `ControlPlane`; the background loop does not create a second state machine and does not consume queued owner instructions.

### Bounded automatic ambiguous-call recovery

`CallAttempt` now has durable optional recovery lifecycle fields:

- `automaticRecoveryAttempts`
- `nextAutomaticRecoveryAt`
- `automaticRecoveryExhaustedAt`

Automatic recovery replays the exact persisted call task/metadata through the existing `ControlPlane.recoverCallAttempt`, which retains the original provider idempotency key. Failed replays use exponential backoff capped by configuration.

When the automatic recovery budget is exhausted, the attempt remains `ambiguous` and receives `automaticRecoveryExhaustedAt`. It is intentionally **not** marked `failed`, because an ambiguous original request may have reached the provider. This is a fail-closed manual-review state that stops automatic retries rather than risking a duplicate real-world call.

Manual/explicit reconcile remains an intentional override path today; the bounded guarantee applies to autonomous background recovery. Moving the guard into the core primitive is a later hardening step if untrusted clients receive reconcile permission.

### Auditability

Added audit types:

- `call_recovery_scheduled`
- `call_recovery_exhausted`

These events contain operational recovery metadata only and do not duplicate call tasks, answers, callback transcripts, or owner instruction text.

### Runtime configuration

`src/server.ts` now parses lifecycle recovery configuration and exposes `lifecycle` from `buildRuntimeFromEnv`. The normal server entrypoint runs the sweeper periodically (default 5 seconds) and reports item-level errors to stderr without terminating unrelated reconciliation.

Supported variables are documented in `docs/CALL_POLICY.md`:

- `CYA_LIFECYCLE_SWEEP_INTERVAL_MS`
- `CYA_MAX_AUTOMATIC_RECOVERY_ATTEMPTS`
- `CYA_RECOVERY_BASE_BACKOFF_MS`
- `CYA_RECOVERY_MAX_BACKOFF_MS`

An attempted `.env.example` blob update was blocked by the execution safety layer while handling credential-shaped placeholders, so the example file is unchanged in this run; runtime support and documentation are present.

### Tests added

Added `tests/lifecycle.test.ts` covering:

1. a lifecycle sweep independently reconciles a completed owner decision and owner callback, including durable queued steering, without agent-driven reconcile calls;
2. ambiguous provider-create recovery is bounded, backoff-aware, fail-closed, and reuses the exact same idempotency key for every automatic replay;
3. once exhausted, later sweeps do not automatically create another provider request and the affected blocking scope remains blocked for manual review;
4. a policy-deferred escalation expires through the lifecycle sweep without ever creating a phone attempt.

## Architecture decisions made this run

1. Background lifecycle processing is an orchestrator over the existing `ControlPlane`, not a separate business-state implementation.
2. Ambiguous provider outcomes must fail closed. Exhausting retries means “manual review required,” not “provider definitely failed.”
3. Automatic retry metadata belongs on durable `CallAttempt` records so restart does not reset retry budgets/backoff.
4. Background reconciliation never consumes owner instructions; consumption remains an agent safe-checkpoint action.
5. One failing lifecycle item must not stop unrelated branches/callbacks from reconciling.
6. Explicit manual reconciliation remains an override for now; autonomous recovery is bounded.

## Verification performed

Repository code is committed only after the final tree is assembled. The local execution container still cannot resolve `github.com`, so direct local clone/test execution is unavailable. This run therefore relies on the repository's GitHub Actions Node 24 CI after commit for authoritative typecheck/build/test verification. CI status must be checked before claiming the new code passes.

## CALL-E integration status

- Fake provider: implemented and previously CI-tested; lifecycle tests extend its end-to-end use.
- Production CALL-E adapter: implemented with server-only API key, structured results, polling, webhook URL, and provider idempotency.
- Same-key ambiguous recovery: implemented.
- Automatic recovery bounds/backoff: implemented by lifecycle manager this run.
- Webhook dedupe + durable transaction: implemented.
- HTTP + TypeScript SDK + MCP path: implemented.
- Live CALL-E call: still not attempted; this run has no authorized `CALLE_API_KEY`, owner destination phone, or public HTTPS deployment.

## Current blockers

No blocker to continued repository development.

Live CALL-E verification still requires a valid CALL-E credential, authorized owner phone number, and public HTTPS deployment. Host-level Claude Code acceptance requires an actual Claude Code installation/session. The automation execution container cannot currently clone GitHub by DNS, but the GitHub connector and Actions CI remain available for direct repository work and verification.

## Highest-value next actions

1. Verify this lifecycle increment in GitHub Actions; fix any type/test regressions before proceeding.
2. Move recovery-exhaustion enforcement into core reconciliation or scoped API permissions so untrusted callers cannot bypass automatic retry limits.
3. Add stale in-progress call timeout policy distinct from ambiguous-create recovery.
4. Add credential scopes and callback/reconcile rate limits before exposing the API beyond a trusted single-owner environment.
5. Add graceful shutdown that stops background lifecycle work and cleanly closes SQLite/server resources.
6. Add production deployment guidance for a host with persistent disk and stable public HTTPS webhook ingress.
7. Generate a lockfile and switch CI to `npm ci` once dependency choices stabilize.
8. After reliability/security hardening, build a small status/demo UI on the existing run/audit APIs.
