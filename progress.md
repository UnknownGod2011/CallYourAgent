# CallYourAgent progress

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. Agents can escalate important decisions without freezing unrelated scopes; owners can independently request callbacks for progress/questions/steering; human input is persisted as structured state and consumed only at explicit safe checkpoints rather than pretending to interrupt in-flight model generation.

The repository includes deterministic fake and production CALL-E providers, SQLite persistence, replayable/idempotent call attempts, polling/webhook convergence, branch-scoped blocking, owner decision persistence, durable per-run instruction queues, exact instruction acknowledgement, quiet hours/call budgets, bounded lifecycle recovery, fail-closed ambiguous/stalled handling, privacy-aware audit history, scoped HTTP authentication, a typed TypeScript client, a real stdio MCP adapter, deterministic end-to-end/demo flows, an operator console, a Claude Code host-acceptance runbook, and a single-instance persistent-volume Compose reference deployment.

This run completed the generic provider-diagnostic privacy boundary introduced by PR #25. PR #26 changes the two durable ambiguous-call persistence sites in `ControlPlane` to use `providerSafeDiagnostic(error)` rather than reflecting arbitrary provider `Error.message` values. Custom/future provider exceptions containing phone/task/token/request data now collapse to the fixed `Call provider operation failed` diagnostic; only an explicit `SafeCallProviderError` may preserve a provider-produced message after the adapter has sanitized it.

## Exact repo state inspected this run

The run started from `main` HEAD `3de2442a96b7966db706e0e947a370bc3af919c2`, the progress handoff immediately after PR #25 (`a621d92fff1450baa0d75dfa98e0e8a905c40c15`).

Before changing code, inspected the complete recursive repository tree through GitHub's recursive tree API (`truncated: false`), covering root configuration, `.github/workflows`, `deploy`, every document under `docs`, all `src` implementation surfaces, and the complete test inventory. Inspected the recent commit chain through PR #25 and verified there were no open issues and no open pull requests before this run.

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

Also inspected the full `src/control-plane.ts` implementation, `src/call-provider.ts`, the existing provider-safe diagnostic tests, and the existing ambiguous-create/recovery regression in `tests/control-plane.test.ts`.

The audit confirmed the previous handoff precisely: `src/call-provider.ts` already had the safe diagnostic trust primitive and `CalleCallProvider` already emitted explicitly sanitized `SafeCallProviderError` instances, but `ControlPlane.dispatchCallAttempt` and `recoverCallAttemptOnce` still persisted raw arbitrary error text through the obsolete local `errorMessage(...)` helper.

## Changes made this run

PR #26, `Close provider diagnostic persistence privacy gap`, changed `src/control-plane.ts`, added `tests/control-plane-provider-error-privacy.test.ts`, and updated the pre-existing ambiguous-create test contract.

`src/control-plane.ts` now imports and applies `providerSafeDiagnostic()` in both places where a provider create exception becomes durable ambiguous-call recovery state:

1. initial provider dispatch failure in `dispatchCallAttempt`;
2. repeated ambiguous-create recovery failure in `recoverCallAttemptOnce`.

The old generic `errorMessage(...)` helper was removed because provider exception text is no longer trusted at this boundary. Idempotency keys, ambiguous-state semantics, provider replay behavior, call-attempt correlation, branch-specific blocking, and recovery flow are unchanged.

A new end-to-end control-plane regression uses a deliberately secret-bearing custom provider error containing a phone number, webhook-token-like value, and task text. It proves that both initial create and subsequent recovery keep `CallAttempt.status = ambiguous` but persist only `GENERIC_CALL_PROVIDER_ERROR`, with none of the injected secret material appearing in the durable attempt. A second regression proves an explicitly marked `SafeCallProviderError("CALL-E create transport failed")` still preserves that sanitized operational diagnostic.

The pre-existing ambiguous-create recovery test previously asserted that raw `socket closed after request transmission` text survived in `lastError`. That assertion represented the old privacy behavior, so it now asserts the fixed generic diagnostic while continuing to prove the exact same idempotency key is reused and recovery clears `lastError` after provider acceptance.

## Verification performed

Verification deliberately caught and corrected two test-contract issues before merge.

First PR head `c11004dadd5e92cfa55c03e0715b432ed70f27c5` failed CI run `34464296853` during TypeScript checking because the two deliberately throwing test-provider overrides inferred `Promise<void>` rather than `Promise<StartCallResult>`. The test doubles were corrected with the exact provider return type.

Second PR head `d4cbee4a825c9ff94ebb5c2e4ae08da56e45178d` reached the test suite but CI run `34464413817` failed one existing assertion: the old ambiguous-create regression still expected `/socket closed/` in durable `lastError`. The new privacy contract intentionally replaces that text with `Call provider operation failed`; the assertion was updated without weakening any recovery/idempotency checks. That run otherwise had 153 passing tests out of 154.

Final authoritative verification ran against PR #26 head `0210cfb14ae8a1e1199c7fb9be64c4254170690d`:

- CI run `34464518789` — **success** on Node 24.20.0. Locked dependency installation, TypeScript typecheck, build, and **154/154 tests passed**, 0 failures.
- Container run `34464519285` — **success**; production image/runtime smoke behavior passed.
- Compose deployment run `34464518798` — **success**. It validated generated scoped credentials, booted the fake-provider deployment, exercised the compiled stdio MCP adapter, created a durable branch-blocking decision, restarted with that decision active, reconciled and released only its blocked branch, requested a context-aware owner callback, restarted with the callback active, reconciled callback steering exactly once, restarted again, and consumed the queued steering only at a safe checkpoint.

PR #26 was squash-merged into `main` as `ec4d3c3a67d112f120adfd7eb1842a335b500d3c`.

`package.json` still has no separate lint script and no standalone migration/schema-check command. `npm run check` covers TypeScript checking, build, and tests; SQLite tests exercise durable schema/transaction behavior; Container and Compose exercise production image/runtime/deployment behavior.

No live CALL-E phone call was attempted or claimed.

## Architecture decisions made this run

1. Treat arbitrary `CallProvider` exceptions as untrusted at the control-plane persistence boundary, regardless of whether the adapter is first-party or custom.
2. Keep the safe-message opt-in explicit. Only `SafeCallProviderError` may cross into durable `lastError` with its message intact; ordinary errors, strings, objects, and future provider failures collapse to a fixed content-free fallback.
3. Apply the trust boundary at both initial dispatch and ambiguous recovery so repeated recovery cannot reintroduce a privacy leak after a safe initial failure.
4. Preserve useful sanitized CALL-E diagnostics because sanitization remains adapter-local and the generic control plane does not need CALL-E-specific parsing/string matching.
5. Preserve ambiguous-create correctness exactly: the system still fails closed, keeps the same logical call/idempotency key, and only clears `lastError` once provider acceptance is durably known.
6. Treat failing legacy assertions as evidence to update the documented/tested contract rather than retaining unsafe behavior for backwards compatibility.

## CALL-E integration status

- **Fake provider:** deterministic, credential-free, idempotent, restart-rehydratable from durable accepted-call state, and still the primary full-flow development/acceptance provider. The complete Compose restart/decision/callback/checkpoint scenario remains green after this change.
- **Production CALL-E adapter:** implemented against the asynchronous Calls API with server-only `CALLE_API_KEY`, stable `Idempotency-Key`, structured result schemas, bounded create/poll requests, persisted correlation, polling/webhook convergence, duplicate prevention, restart-by-provider-id semantics, sanitized HTTP/transport failures, and fail-closed ambiguous/stalled handling. Its sanitized diagnostics remain explicitly marked via `SafeCallProviderError`, and the control plane now honors that trust contract at durable `lastError` persistence sites.
- **Generic provider boundary:** arbitrary custom/future provider create exceptions can no longer feed their raw messages into durable ambiguous-call `lastError` during initial dispatch or recovery.
- **Shared surfaces:** HTTP, TypeScript SDK, stdio MCP, lifecycle worker, operator console, and deployment flows continue sharing one persistent control-plane state machine.
- **Claude Code:** compiled stdio MCP behavior remains covered by automated and Compose acceptance. A genuine Claude Code host session has still not been observed and is not claimed.
- **Live status:** no authorized real CALL-E phone call has been performed, so live provider connectivity, owner-phone authorization, and public webhook success remain unverified.

## Current blockers / external prerequisites

No repository-development blocker prevents further useful work.

A true Claude Code host acceptance requires an actual Claude Code environment/CLI to register and exercise the compiled stdio MCP server.

Live CALL-E verification still requires user-controlled prerequisites: a valid/authorized CALL-E credential, an authorized owner phone destination, and stable public HTTPS webhook ingress configured with the application-owned webhook capability token.

## Highest-value next actions

1. Audit provider `observe` and optional `rehydrate` exception paths end-to-end. They are currently not persisted to `CallAttempt.lastError`, but lifecycle and explicit-reconciliation surfaces should be regression-tested to prove arbitrary provider exception text cannot escape through operational results/logs or HTTP/MCP error projections.
2. Review lifecycle sweep versus explicit callback/decision reconciliation for concurrent same-attempt `observe -> apply` overlap not already covered by webhook-vs-poll and ambiguous-recovery tests. Add synchronization only if a deterministic race demonstrates state/audit divergence.
3. Audit all remaining request/proxy guidance around `/webhooks/calle` to ensure the query-string capability token is never encouraged into access logs, tracing metadata, or error serialization.
4. Continue tightening stable API conflict/validation semantics without reintroducing arbitrary exception reflection.
5. Run the documented acceptance in a genuine Claude Code host when that external prerequisite is available and record only observed host/version behavior.
6. When the user-controlled CALL-E prerequisites are available, perform one tightly bounded live provider acceptance and record only observed behavior.
