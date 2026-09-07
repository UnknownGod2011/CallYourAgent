# progress.md

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. It currently has SQLite persistence, deterministic fake and production CALL-E providers, replayable/idempotent call attempts, polling/webhook convergence, scoped authenticated HTTP APIs, a typed TypeScript client, stdio MCP, CI-proven Claude-style branch/checkpoint behavior, decision-call policy, durable privacy-aware audit history, bounded lifecycle recovery, fail-closed ambiguous/stalled call handling, API abuse controls, an owned graceful runtime, and hard deadlines around CALL-E HTTP operations.

The core product semantics remain unchanged: an agent can escalate genuinely important human judgment without freezing unrelated scopes; the owner can independently request a callback to hear current status and steer the run; owner decisions and instructions become durable structured state and are consumed only at safe checkpoints rather than being represented as mid-generation interruption.

## Exact repo state inspected this run

Before making changes, inspected the complete recursive `main` repository tree at `47e4dee197d114d5a96fc42bf6c2de03363a145b`, including every source, test, workflow, configuration, and documentation path. Inspected recent commits through the graceful runtime/deployment hardening work. Checked repository issues and pull requests; there were no open/relevant issues or PRs.

Read `AGENTS.md`, this file, `README.md`, `docs/ARCHITECTURE.md`, `docs/INTEGRATIONS.md`, `docs/CALL_POLICY.md`, `docs/API_SECURITY.md`, and `docs/DEPLOYMENT.md` in full before modifying the repository. Inspected `src/calle-provider.ts`, the call-start/reconciliation behavior in `src/control-plane.ts`, `src/server.ts`, `.env.example`, `tests/calle-provider.test.ts`, and `tests/server-runtime.test.ts` because the highest-value recorded next action was bounding provider HTTP operations without weakening ambiguous-call/idempotency guarantees.

Direct local clone/test execution remains unavailable in this runtime because the execution container cannot use the repository through a normal local GitHub clone path. Repository mutations therefore used authenticated GitHub repository operations and verification used the repository's GitHub Actions CI.

## Existing foundation preserved

- Agent registration, run state, heartbeats/status, branch-scoped blocking, owner decisions, owner callbacks, durable instruction queues, and safe checkpoint consumption.
- In-memory and durable `node:sqlite` stores with WAL, explicit transactions, uniqueness constraints, rollback/reload behavior, persisted causal audit ordering, and idempotent close semantics.
- Fake CALL-E provider and production CALL-E Calls API adapter with server-only credentials, structured results, provider idempotency, polling, and terminal webhook support.
- Persist-before-side-effect call attempts containing the exact replayable provider request/idempotency state.
- Shared polling/webhook terminal transition and provider-event deduplication.
- Typed HTTP client, stdio MCP adapter, and Claude-style end-to-end MCP work-loop tests.
- Priority gates, quiet hours, critical bypass, per-run/per-owner call budgets, escalation expiry, durable policy deferral, bounded ambiguous recovery, and stalled accepted-call review state.
- Scoped HTTP credentials and per-credential callback/reconciliation rate limits.
- Owned runtime with non-overlapping lifecycle sweeps plus graceful HTTP/lifecycle/store shutdown.

## Changes made this run

### Hard deadline around CALL-E HTTP operations

Added `requestTimeoutMs` to the production `CalleCallProvider`, defaulting to 15 seconds. Both provider network paths now carry an `AbortSignal.timeout(...)` deadline:

- `POST /v1/calls` call creation;
- `GET /v1/calls/{id}` call-status reconciliation.

This closes the previous reliability gap where a hung provider connection could indefinitely pin a lifecycle sweep and therefore delay graceful shutdown.

The semantics deliberately differ at the control-plane level according to the operation:

1. A timed-out **create** request throws from the provider into the existing persisted call-attempt boundary. The control plane records the attempt as `ambiguous`, preserving the exact original request and idempotency key. Automatic recovery therefore still replays only that same logical request/key; the timeout does not authorize a fresh call.
2. A timed-out **poll** throws from `getOutcome`. That reconciliation pass fails and can be retried later against the already-known provider call id. It does not create a new provider call or mutate terminal state without evidence.

`CalleCallProvider` validates that an explicitly supplied timeout is a positive integer.

### Runtime configuration

Live CALL-E mode now accepts `CYA_CALLE_HTTP_TIMEOUT_MS`; when omitted the provider uses its 15000 ms default. Environment parsing validates an explicitly supplied value before a durable store is opened.

Updated `.env.example` and `docs/DEPLOYMENT.md` to document the timeout and the create-vs-poll safety semantics.

### Exception-safe runtime construction after SQLite opens

`buildRuntimeFromEnv()` now wraps post-store-open construction of `CallPolicy`, `ControlPlane`, `LifecycleManager`, and the HTTP server. If any of those constructors throws, the store is closed before the startup error propagates.

This addresses the smaller resource-safety follow-up from the prior run: environment syntax is already validated before opening SQLite where possible, while derived constructor validation (for example policy/lifecycle invariants) can no longer leak the durable database handle.

### Regression coverage

Expanded `tests/calle-provider.test.ts` to verify:

- outbound CALL-E requests actually receive an abort signal;
- a hung create request is aborted at the configured deadline;
- a hung reconciliation request is aborted at the configured deadline;
- invalid timeout configuration is rejected.

The existing control-plane behavior that converts provider create exceptions into durable ambiguous call attempts remains unchanged and continues to be covered by the broader state-machine/lifecycle tests.

## Architecture decisions made this run

1. Provider network deadlines belong in the production `CallProvider` adapter, not in agent/MCP adapters or business prompts.
2. Create-request timeout is ambiguous, not failed, because CALL-E may have accepted the real-world side effect before the local deadline fired.
3. The exact persisted idempotency key remains the only automatic recovery key after a create timeout; timeout handling does not relax duplicate-call prevention.
4. Poll timeout is a transient reconciliation failure against an existing provider call id and must never synthesize a terminal result or replacement call.
5. One timeout setting is used for CALL-E create and poll operations for the current reference deployment; provider-specific tuning can be split later only if live evidence justifies it.
6. Runtime construction owns the resource-cleanup boundary once a store has been opened: later constructor failure closes the store before propagating.

## Verification performed

- Code-bearing provider implementation commit `8a455b7ededd4ef8004dff741226b478b82a8088` added the request deadline.
- Test commit `aa5ef894dbc4316185b2970530243397806ce025` added deterministic hung-request coverage.
- Runtime/config code commit `74846725ce2dc2d7ba1618c904883128bb13a621` wired `CYA_CALLE_HTTP_TIMEOUT_MS` and made post-store-open construction exception-safe.
- GitHub Actions CI run `34075022569` for commit `74846725ce2dc2d7ba1618c904883128bb13a621` completed successfully on September 7, 2026 UTC.
- The successful job used Node 24, installed dependencies, and ran the repository's `npm run check` pipeline. Typechecking/build/test execution all passed, including the new hung-create and hung-reconciliation timeout tests.
- Documentation/configuration commits `b4016822a26e01d973e3cd98002cee6949e635f9` and `535ae46481ea13e80cd8d9676b58310192f12cde` record the timeout configuration and deployment semantics.
- No live CALL-E call was attempted in this run.

## CALL-E integration status

- Fake provider: implemented and CI-tested end-to-end, including decision calls, callbacks, branch-scoped blocking, queued owner steering, checkpoint consumption, idempotency, policy, lifecycle recovery, and auditability.
- Production CALL-E adapter: implemented with server-only API key, structured result schemas, provider idempotency, asynchronous polling, webhook URL construction, terminal reconciliation, and now bounded create/poll HTTP requests.
- Ambiguous create replay with the exact original idempotency key: implemented.
- Automatic recovery bounds/backoff and core recovery-exhaustion enforcement: implemented and CI-tested.
- Accepted-call stale timeout: implemented; terminal provider evidence is polled before stalling and CI-tested.
- Webhook event-id validation/deduplication + durable transaction: implemented.
- HTTP + TypeScript SDK + MCP path: implemented.
- Scoped credentials + callback/reconciliation rate limits: implemented and CI-tested.
- Graceful server/lifecycle/store shutdown: implemented and CI-tested.
- CALL-E create/poll network timeout: implemented, configurable, and CI-tested this run.
- Live CALL-E call: **not attempted and not claimed**. A valid CALL-E credential, authorized owner phone destination, and stable public HTTPS deployment remain external prerequisites.

## Current blockers

There is no blocker to continued repository development.

Live CALL-E verification still requires a valid CALL-E credential, authorized owner phone number, and public HTTPS deployment. Host-level Claude Code acceptance still requires an actual Claude Code installation/session. Authenticated GitHub access and GitHub Actions continue to provide a working implementation/verification path in this runtime.

## Highest-value next actions

1. Generate and commit a dependency lockfile, then switch CI from `npm install` to reproducible `npm ci` once the current dependency graph is captured cleanly.
2. Exercise the documented Claude Code stdio MCP registration path in a real Claude Code host and record exact host acceptance results rather than inferring host behavior from protocol-level tests.
3. Add a small operator/status surface over existing authenticated run/audit APIs so the hackathon demo visibly shows concurrent unrelated work, blocked-scope resume, call state, and checkpoint-consumed steering without introducing a second state layer.
4. Consider a narrowly scoped provider-readiness endpoint or startup self-check only if it can report credentials/webhook/provider reachability without causing a phone side effect; keep `/health` as liveness.
5. Add an explicit operator-only resolution/recovery path for `stalled` or exhausted-ambiguous calls only if real deployment testing demonstrates a need; keep it separately scoped and audited.
6. Consider a shared store/rate limiter only when moving beyond the supported single-instance reference deployment.
7. Add broader Codex/ChatGPT adapters only where current platform capabilities can genuinely support the existing checkpoint/tool semantics; do not duplicate the state machine or claim mid-generation interruption.
