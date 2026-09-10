# CallYourAgent progress

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. Agents can escalate important decisions without freezing unrelated scopes; owners can independently request callbacks for progress/questions/steering; human input is persisted as structured state and consumed only at explicit safe checkpoints rather than pretending to interrupt in-flight model generation.

The repository includes deterministic fake and production CALL-E providers, SQLite persistence, replayable/idempotent call attempts, polling/webhook convergence, branch-scoped blocking, owner decision persistence, durable per-run instruction queues, exact instruction acknowledgement, quiet hours/call budgets, bounded lifecycle recovery, fail-closed ambiguous/stalled handling, privacy-aware audit history, scoped HTTP authentication, a typed TypeScript client, a real stdio MCP adapter, deterministic end-to-end/demo flows, an operator console, a Claude Code host-acceptance runbook, and a single-instance persistent-volume Compose reference deployment.

This run continued the provider/privacy hardening by introducing an explicit generic `CallProvider` diagnostic trust contract. PR #25 adds `SafeCallProviderError`, a generic fallback diagnostic, and a central `providerSafeDiagnostic()` function. The production CALL-E adapter now marks only diagnostics that have already been sanitized at the adapter boundary as persistence-safe. Arbitrary custom/future provider exceptions and non-Error throws are proven to collapse to a fixed generic diagnostic when passed through that contract.

The control-plane persistence sites still use their older raw `errorMessage(...)` helper today, so this run deliberately does **not** claim that the generic custom-provider `CallAttempt.lastError` privacy gap is fully closed yet. The highest-value next change is now narrowly defined: wire `dispatchCallAttempt` and `recoverCallAttemptOnce` to `providerSafeDiagnostic()` and add an end-to-end control-plane regression proving raw custom-provider exception text cannot reach durable `lastError` while explicitly marked sanitized provider diagnostics remain useful.

## Exact repo state inspected this run

The run started from `main` HEAD `85d79f9d6f697bf15da1c89c29e8406b5b52097c`, immediately after PR #24 and its progress handoff documenting runtime stderr privacy hardening.

Before changing code, inspected the complete recursive repository tree through GitHub's recursive tree API, covering the root, `.github/workflows`, `deploy`, every file under `docs`, all `src` implementation surfaces, and the full test-suite inventory. Inspected the recent commit chain through PR #24 and verified there were no open issues and no open pull requests before this run.

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

Also inspected the relevant implementation/test surfaces, especially `src/call-provider.ts`, `src/calle-provider.ts`, `src/control-plane.ts`, `package.json`, and the existing CALL-E transport-privacy regression.

The audit confirmed that `CalleCallProvider` already sanitized its HTTP and transport failures before throwing, but the provider port had no explicit way to distinguish a deliberately sanitized operational diagnostic from an arbitrary adapter exception. `ControlPlane.dispatchCallAttempt` and `recoverCallAttemptOnce` currently persist generic provider exception messages through `errorMessage(error)`, so a future/custom adapter could still feed phone/task/token/request details into `CallAttempt.lastError` unless the control-plane boundary is switched to the new trust contract.

## Changes made this run

PR #25, `Add privacy-safe provider diagnostic contract`, changed `src/call-provider.ts`, `src/calle-provider.ts`, and added `tests/provider-safe-diagnostic.test.ts`.

`src/call-provider.ts` now exports:

- `SafeCallProviderError`, an explicit marker for adapter-produced diagnostics that are safe to persist;
- `GENERIC_CALL_PROVIDER_ERROR`, the fixed fallback `Call provider operation failed`;
- `providerSafeDiagnostic(error)`, which preserves only a `SafeCallProviderError` message and reduces arbitrary `Error`, string, object, and other thrown values to the generic fallback.

The contract documents that safe provider messages must never contain phone numbers, prompts, credentials, request URLs, webhook tokens, transcripts, or raw upstream response bodies.

`CalleCallProvider` now uses `SafeCallProviderError` only for the diagnostic strings it already constructs from privacy-safe information: sanitized create/get transport failures and timeouts, bounded HTTP status plus validated request id, invalid call payload classification, and terminal create status. Timeout classification still preserves `name = "TimeoutError"`; provider request, idempotency, polling, webhook, structured-result, and recovery semantics are otherwise unchanged.

The new deterministic tests prove:

1. an arbitrary custom-provider-style `Error` containing an owner phone number, webhook token, and task text becomes exactly the generic fallback;
2. an explicitly marked sanitized provider diagnostic retains its safe message;
3. non-Error secret-bearing throws such as strings/objects are never reflected.

The change is intentionally a provider-port trust primitive, not a speculative rewrite. The existing control-plane state machine, fake provider, branch-safe blocking, decision/callback reconciliation, safe-checkpoint instruction queue, HTTP/MCP contracts, SQLite schema, and runtime behavior remain unchanged in this PR.

## Verification performed

Authoritative verification ran through GitHub Actions against PR #25 head `31ff301ba79488a4d6b93d8da95889f2d0b60976`.

- CI run `34458404399` — **success**. The repository's Node 24 locked install, TypeScript typecheck/build, and test suite completed successfully, including the new provider-safe diagnostic regressions.
- Container run `34458404333` — **success**; production image/runtime smoke behavior passed.
- Compose deployment run `34458404383` — **success**; the complete durable fake-provider deployment acceptance remained green.

PR #25 was squash-merged into `main` as `a621d92fff1450baa0d75dfa98e0e8a905c40c15`.

`package.json` still has no separate lint script and no standalone migration/schema-check command. The repository's `npm run check` path covers TypeScript checking, build, and tests; SQLite tests exercise the durable schema/transaction path; Container and Compose exercise production image/runtime/deployment behavior.

No live CALL-E phone call was attempted or claimed.

## Architecture decisions made this run

1. Make provider diagnostic trust explicit rather than relying on conventions around ordinary `Error.message`. A provider exception is untrusted by default.
2. Preserve useful provider diagnostics only through an opt-in marker type owned by the generic provider boundary. Future adapters must deliberately construct a persistence-safe error after sanitizing upstream data.
3. Keep the fallback fixed and content-free. Arbitrary adapter exceptions, thrown strings, and objects must not be serialized or inspected for diagnostic text.
4. Keep CALL-E sanitization adapter-local. The generic control plane should not need CALL-E-specific string matching or knowledge of provider HTTP response formats.
5. Preserve timeout type classification for CALL-E while separating classification from message trust; changing an error's `name` does not remove the `SafeCallProviderError` marker.
6. Do not claim the durable generic-provider leak is fixed until the control-plane catch sites actually consume `providerSafeDiagnostic()` and an end-to-end regression verifies the persisted `CallAttempt.lastError` value.

## CALL-E integration status

- **Fake provider:** deterministic, credential-free, idempotent, restart-rehydratable from durable accepted-call state, and still the primary full-flow development/acceptance provider. Compose acceptance remains green after this provider-contract change.
- **Production CALL-E adapter:** implemented against the asynchronous Calls API with server-only `CALLE_API_KEY`, stable `Idempotency-Key`, structured result schemas, bounded create/poll requests, persisted correlation, polling/webhook convergence, duplicate prevention, restart-by-provider-id semantics, sanitized HTTP response failures, sanitized transport exceptions, and fail-closed ambiguous/stalled handling. Its sanitized thrown diagnostics are now explicitly marked safe by the generic provider contract.
- **Shared surfaces:** HTTP, TypeScript SDK, stdio MCP, lifecycle worker, operator console, and deployment flows continue to share the same persistent control-plane state machine. This run only introduces the diagnostic trust primitive and adopts it inside the CALL-E adapter.
- **Claude Code:** compiled stdio MCP behavior remains covered by automated and Compose acceptance. A genuine Claude Code host session has still not been observed and is not claimed.
- **Live status:** no authorized real CALL-E phone call has been performed, so live provider connectivity, owner-phone authorization, and public webhook success remain unverified.

## Current blockers / external prerequisites

No repository-development blocker prevents further useful work.

A true Claude Code host acceptance requires an actual Claude Code environment/CLI to register and exercise the compiled stdio MCP server.

Live CALL-E verification still requires user-controlled prerequisites: a valid/authorized CALL-E credential, an authorized owner phone destination, and stable public HTTPS webhook ingress configured with the application-owned webhook capability token.

## Highest-value next actions

1. Complete the generic provider-diagnostic boundary: replace raw `errorMessage(error)` persistence in `ControlPlane.dispatchCallAttempt` and `recoverCallAttemptOnce` with `providerSafeDiagnostic(error)`. Add a control-plane-level regression using a deliberately secret-bearing custom provider and prove both initial ambiguous create and recovery persist only the generic fallback, while `SafeCallProviderError` preserves an explicitly sanitized message.
2. Audit provider `observe`/`rehydrate` exceptions for any durable/logging path that might need the same trust primitive; current reconciliation errors are not written to `CallAttempt.lastError`, but lifecycle error aggregation should remain privacy-safe by construction.
3. Audit all remaining code paths that may stringify request URLs or HTTP request objects around `/webhooks/calle`; application code does not currently access-log requests, but future middleware/proxy guidance should remain query-token-safe.
4. Review lifecycle sweep versus explicit callback/decision reconciliation for same-attempt concurrent observe/apply overlap not already covered by webhook-vs-poll and ambiguous-recovery single-flight tests. Add synchronization only if a reproducible divergence exists.
5. Continue tightening stable API conflict/validation semantics without reintroducing arbitrary exception reflection.
6. Run the documented acceptance in a genuine Claude Code host when that external prerequisite is available and record only observed host/version behavior.
7. When the user-controlled CALL-E prerequisites are available, perform one tightly bounded live provider acceptance and record only observed behavior.
