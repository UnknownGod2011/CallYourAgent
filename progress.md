# CallYourAgent progress

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. Agents can escalate important decisions without freezing unrelated scopes; owners can independently request callbacks for progress/questions/steering; human input is persisted as structured state and consumed only at explicit safe checkpoints rather than pretending to interrupt in-flight model generation.

The repository includes deterministic fake and production CALL-E providers, SQLite persistence, replayable/idempotent call attempts, polling/webhook convergence, branch-scoped blocking, owner decision persistence, durable per-run instruction queues, exact instruction acknowledgement, quiet hours/call budgets, bounded lifecycle recovery, fail-closed ambiguous/stalled handling, privacy-aware audit history, scoped HTTP authentication, a typed TypeScript client, a real stdio MCP adapter, deterministic end-to-end/demo flows, an operator console, a Claude Code host-acceptance runbook, and a single-instance persistent-volume Compose reference deployment.

This run continued the privacy/security audit and found a concrete operational logging leak: `startRuntimeFromEnv()` logged the complete `LifecycleSweepResult.errors` array and raw sweep/startup/shutdown exceptions to stderr. A custom/future provider or other runtime layer could therefore place owner/task/provider-sensitive exception text into platform logs even though HTTP responses and the production CALL-E adapter already sanitize those boundaries. PR #24 now keeps runtime diagnostics useful while omitting arbitrary messages and identifiers.

## Exact repo state inspected this run

The run started from `main` HEAD `11e5cfb31f131eaeb1e083a662309f236e9a3668`, immediately after PR #23 and its progress handoff documenting CALL-E transport-exception sanitization.

Before changing code, inspected the complete recursive repository tree through GitHub's recursive tree API, covering the root, `.github/workflows`, `deploy`, every file under `docs`, all `src` implementation surfaces, and the full test-suite inventory. Inspected the recent commit chain through PR #23 and verified there were no open issues and no open pull requests before this run.

Read in full before changing code:

- `AGENTS.md`
- `progress.md`
- `README.md`
- `docs/ARCHITECTURE.md`
- `docs/INTEGRATIONS.md`
- `docs/API_SECURITY.md`
- `docs/CALL_POLICY.md`
- `docs/CLAUDE_CODE_ACCEPTANCE.md`
- `docs/DEPLOYMENT.md`
- `docs/OPERATOR_CONSOLE.md`
- `docs/PROVIDER_RESTART_SEMANTICS.md`
- `deploy/README.md`

Also inspected the relevant implementation/test surfaces, especially `src/server.ts`, `src/lifecycle.ts`, `src/call-provider.ts`, `src/calle-provider.ts`, `src/control-plane.ts`, and the existing provider/privacy tests.

The audit confirmed that the production CALL-E adapter already sanitizes HTTP/transport failures before they can reach durable recovery state, but `LifecycleManager.sweep()` intentionally captures arbitrary operation errors in its internal `errors` array for programmatic inspection. `startRuntimeFromEnv()` then logged that complete array with `console.error`, including each error message and domain id. In addition, the runtime entrypoint printed raw rejected exception objects for sweep rejection, graceful-shutdown failure, and startup failure. Those are inappropriate trust boundaries for an internet-deployed service because platform stderr commonly feeds long-lived centralized logs.

## Changes made this run

PR #24, `Harden runtime lifecycle logging privacy`, changed `src/server.ts` and added `tests/runtime-log-privacy.test.ts`.

Runtime lifecycle logging now:

- converts normal sweep errors to an aggregate `{ total, escalations, callbacks }` summary;
- does not log lifecycle error messages;
- does not log escalation ids or callback/call-attempt ids;
- does not reflect raw caught sweep exceptions to stderr;
- does not reflect raw startup or graceful-shutdown exception objects from the CLI entrypoint.

The exported `lifecycleSweepErrorSummary()` helper deliberately accepts only the sweep error collection and returns counts by safe category. The underlying `LifecycleManager.sweep()` result is otherwise unchanged, so tests/internal callers that need structured error information still receive it directly; only the default runtime logging boundary is narrowed.

The new deterministic regression injects secret-bearing lifecycle messages and secret-looking ids and proves the resulting operational summary contains only aggregate counts. It explicitly verifies that webhook/phone/task-like secret text, escalation ids, callback ids, and arbitrary failure text do not survive serialization of the runtime log payload.

The change is intentionally narrow. It does not alter control-plane state, CALL-E requests, provider idempotency, callback/decision reconciliation, recovery state, branch-scoped blocking, owner decision persistence, callback steering, audit events, HTTP authorization, MCP behavior, or safe-checkpoint instruction consumption.

## Verification performed

Authoritative verification ran through GitHub Actions against PR #24 head `cd3bf3dbef29c844b6c890cbb5ee93e063572d8c`.

- CI run `34453048784` — **success** on the repository's Node 24 check job. Locked dependency installation and the combined typecheck/build/test step completed successfully, including the new runtime-log privacy regression.
- Container run `34453048789` — **success**; the production image/runtime smoke path passed.
- Compose deployment run `34453048812` — **success**; the full durable fake-provider deployment acceptance remained green.

PR #24 was squash-merged into `main` as `584b4918f6548999dbf06c965a2477a5c26f1747`.

`package.json` still has no separate lint script and no standalone migration/schema-check command. The repository's `npm run check` path covers TypeScript checking, build, and tests; SQLite tests exercise the durable schema/transaction path; Container and Compose exercise production image/runtime/deployment behavior.

No live CALL-E phone call was attempted or claimed.

## Architecture decisions made this run

1. Treat application/platform logs as a public-ish operational boundary rather than as a trusted dump target. Provider, owner, task, webhook, and recovery exception text must not be assumed safe merely because it is not returned through HTTP.
2. Preserve structured lifecycle errors inside the lifecycle service for direct trusted programmatic use, but narrow the default runtime logger to counts only. This avoids weakening debuggability inside tests/controlled tooling while protecting centralized stderr logs.
3. Omit ids as well as messages from the default aggregate. Call-attempt/escalation ids are not required to know a sweep is unhealthy and can be correlated through the privacy-aware audit/operator surfaces instead.
4. Fail closed for unexpected top-level runtime exceptions: the CLI emits a fixed failure category rather than serializing arbitrary thrown objects.
5. Do not change provider/recovery semantics as part of logging hardening. Ambiguous-create handling, idempotency reuse, restart recovery, branch-safe waiting, and safe-checkpoint steering remain exactly the same.

## CALL-E integration status

- **Fake provider:** deterministic, credential-free, idempotent, restart-rehydratable from durable accepted-call state, and still the primary full-flow development/acceptance provider. Compose acceptance remains green after this change.
- **Production CALL-E adapter:** implemented against the asynchronous Calls API with server-only `CALLE_API_KEY`, stable `Idempotency-Key`, structured result schemas, bounded create/poll requests, persisted correlation, polling/webhook convergence, duplicate prevention, restart-by-provider-id semantics, sanitized HTTP response failures, sanitized transport exceptions, and fail-closed ambiguous/stalled handling.
- **Shared surfaces:** HTTP, TypeScript SDK, stdio MCP, lifecycle worker, operator console, and deployment flows continue to share the same persistent control-plane state machine. This run changes only the default runtime stderr projection of lifecycle/runtime failures.
- **Claude Code:** compiled stdio MCP behavior remains covered by automated and Compose acceptance. A genuine Claude Code host session has still not been observed and is not claimed.
- **Live status:** no authorized real CALL-E phone call has been performed, so live provider connectivity, owner-phone authorization, and public webhook success remain unverified.

## Current blockers / external prerequisites

No repository-development blocker prevents further useful work.

A true Claude Code host acceptance requires an actual Claude Code environment/CLI to register and exercise the compiled stdio MCP server.

Live CALL-E verification still requires user-controlled prerequisites: a valid/authorized CALL-E credential, an authorized owner phone destination, and stable public HTTPS webhook ingress configured with the application-owned webhook capability token.

## Highest-value next actions

1. Finish the generic/custom `CallProvider` diagnostic contract: production CALL-E is safe and runtime stderr is now safe, but a future adapter can still feed arbitrary exception text into durable `CallAttempt.lastError` during ambiguous create/recovery. Add an explicit provider-safe error type/classification and make the control plane persist only trusted safe diagnostics or a generic fallback.
2. Audit all remaining code paths that may stringify request URLs or HTTP request objects around `/webhooks/calle`; application code does not currently access-log requests, but future middleware/proxy guidance should remain query-token-safe.
3. Review lifecycle sweep versus explicit callback/decision reconciliation for same-attempt concurrent observe/apply overlap not already covered by webhook-vs-poll and ambiguous-recovery single-flight tests. Add synchronization only if a reproducible divergence exists.
4. Continue tightening stable API conflict/validation semantics without reintroducing arbitrary exception reflection.
5. Run the documented acceptance in a genuine Claude Code host when that external prerequisite is available and record only observed host/version behavior.
6. When the user-controlled CALL-E prerequisites are available, perform one tightly bounded live provider acceptance and record only observed behavior.
