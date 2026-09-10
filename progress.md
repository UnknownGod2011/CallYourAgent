# CallYourAgent progress

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. Agents can escalate important decisions without freezing unrelated scopes; owners can independently request callbacks for progress/questions/steering; human input is persisted as structured state and consumed only at explicit safe checkpoints rather than pretending to interrupt in-flight model generation.

The repository includes deterministic fake and production CALL-E providers, SQLite persistence, replayable/idempotent call attempts, polling/webhook convergence, branch-scoped blocking, owner decision persistence, durable per-run instruction queues, exact instruction acknowledgement, quiet hours/call budgets, bounded lifecycle recovery, fail-closed ambiguous/stalled handling, privacy-aware audit history, scoped HTTP authentication, a typed TypeScript client, a real stdio MCP adapter, deterministic end-to-end/demo flows, an operator console, a Claude Code host-acceptance runbook, and a single-instance persistent-volume Compose reference deployment.

This run closed the remaining lifecycle-worker provider-exception privacy gap. PR #27 changes `LifecycleManager.sweep()` so arbitrary exceptions from provider `observe(...)`, optional `rehydrate(...)`, or another reconciliation dependency no longer have their raw messages copied into the structured `LifecycleSweepResult.errors` surface. Each per-item error now carries the fixed operational diagnostic `Lifecycle reconciliation failed`, while retaining only the already-known local item kind/id needed for correlation.

## Exact repo state inspected this run

The run started from `main` HEAD `a077a5405e2d072f5adee118d84c4fc9da5d4552`, the progress handoff immediately after PR #26 (`ec4d3c3a67d112f120adfd7eb1842a335b500d3c`).

Before changing code, inspected the complete recursive repository tree through GitHub's recursive tree API with `truncated: false`, covering root configuration, `.github/workflows`, `deploy`, every document under `docs`, every `src` implementation surface, and the complete test inventory. Inspected the recent commit chain through PR #26 and verified there were no open issues and no open pull requests before this run.

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

Also inspected `package.json`, `src/call-provider.ts`, the relevant reconciliation/rehydration sections of `src/control-plane.ts`, `src/lifecycle.ts`, and the existing lifecycle/provider observation tests.

The inspection confirmed the prior handoff precisely: durable ambiguous-create diagnostics were already protected by `providerSafeDiagnostic`, HTTP unexpected errors were fail-closed, and runtime stderr emitted only aggregate lifecycle failure counts, but `LifecycleManager.sweep()` still caught arbitrary reconciliation exceptions and copied `Error.message` directly into its structured `errors` array. Because custom provider `observe` and `rehydrate` implementations can throw arbitrary text, that structured operational result remained a possible path for phone numbers, task context, webhook-token-like values, request details, or other provider diagnostics to escape.

## Changes made this run

PR #27, `Harden lifecycle provider-error privacy`, changed `src/lifecycle.ts` and added `tests/lifecycle-error-privacy.test.ts`.

`src/lifecycle.ts` now exports `GENERIC_LIFECYCLE_ERROR = "Lifecycle reconciliation failed"`. Both escalation and callback reconciliation catch paths append only this fixed diagnostic to `LifecycleSweepResult.errors`; the obsolete generic `errorMessage(...)` reflection helper was removed.

The change intentionally does not alter provider state, call-attempt status, decision/callback reconciliation semantics, branch blocking, retry/backoff behavior, stale-call handling, idempotency, or provider I/O. A failed observation/rehydration pass remains retryable on a later lifecycle sweep or explicit reconciliation.

Two deterministic regressions inject a secret-bearing custom-provider exception containing a phone number, webhook-token-like value, and private task text:

1. an owner-callback provider `observe(...)` failure proves the sweep result contains only the fixed diagnostic, none of the secret text is serialized, and the callback remains durably queued for a future retry;
2. an owner-decision provider `rehydrate(...)` failure proves the same privacy boundary while the blocking escalation continues to block only its own `release` scope.

PR #27 was squash-merged into `main` as `d84038b66e337a9f0fed7ece1d14053020ec8c9d`.

## Verification performed

Authoritative verification ran against PR #27 head `6e6a5f6923c6b3b897271841ef6fc7fc74e2a873`:

- CI run `34469026678` — **success** on Node 24.20.0. Locked dependency installation, TypeScript typecheck, build, and **156/156 tests passed**, 0 failures. Both new lifecycle provider-error privacy regressions passed.
- Container run `34469026667` — **success**. The production image built and the fake-provider runtime smoke test passed.
- Compose deployment run `34469026656` — **success**. It generated least-privilege scoped credentials, validated Compose, booted the fake-provider deployment, exercised the compiled stdio MCP adapter, created a durable branch-blocking owner decision, restarted while that decision was active, reconciled and released only the blocked branch, requested a context-aware owner callback, restarted while the callback was active, reconciled callback steering exactly once, restarted again, and consumed that queued steering only at an explicit safe checkpoint.

`package.json` still has no separate lint script and no standalone migration/schema-check command. `npm run check` covers TypeScript typechecking, build, and tests; SQLite tests exercise durable schema/transaction behavior; Container and Compose exercise the production image/runtime/deployment path.

No live CALL-E phone call was attempted or claimed.

## Architecture decisions made this run

1. Treat `LifecycleSweepResult` as an operational data boundary, not an unrestricted debug channel. Structured background-worker results can be consumed by future monitoring/adapters and therefore must not reflect arbitrary provider exception text.
2. Preserve only a fixed content-free reconciliation diagnostic at that boundary. Provider-specific raw exception messages are untrusted regardless of whether they originate from `observe`, `rehydrate`, or another reconciliation dependency.
3. Keep local kind/id correlation in the lifecycle result because those identifiers are already control-plane state and are useful for locating the affected item; do not attach provider request bodies, tasks, phone data, credentials, or thrown text.
4. Do not mutate call state merely because a provider observation/rehydration pass failed. The correct behavior is to leave the accepted call in its prior durable state and allow bounded later reconciliation rather than fabricate a terminal result.
5. Preserve branch-level semantics during observation failures: a blocking decision keeps only its associated scope blocked while unrelated work remains independent.
6. This boundary complements, rather than replaces, the existing protections: `providerSafeDiagnostic` for durable create/recovery diagnostics, generic unexpected HTTP errors, privacy-safe response projections, and aggregate-only runtime stderr logging.

## CALL-E integration status

- **Fake provider:** deterministic, credential-free, idempotent, restart-rehydratable from durable accepted-call state, and still the primary full-flow development/acceptance provider. The complete Compose restart/decision/callback/checkpoint scenario remains green after PR #27.
- **Production CALL-E adapter:** implemented against the asynchronous Calls API with server-only `CALLE_API_KEY`, stable `Idempotency-Key`, structured result schemas, bounded create/poll requests, persisted correlation, polling/webhook convergence, duplicate prevention, restart-by-provider-id semantics, sanitized HTTP/transport failures, and fail-closed ambiguous/stalled handling.
- **Generic provider privacy boundary:** arbitrary provider create/recovery exceptions cannot enter durable `lastError`, and arbitrary provider observation/rehydration exceptions can no longer escape through lifecycle sweep structured errors.
- **Shared surfaces:** HTTP, TypeScript SDK, stdio MCP, lifecycle worker, operator console, and deployment flows continue sharing one persistent control-plane state machine.
- **Claude Code:** compiled stdio MCP behavior remains covered by automated and Compose acceptance. A genuine Claude Code host session has still not been observed and is not claimed.
- **Live status:** no authorized real CALL-E phone call has been performed, so live provider connectivity, owner-phone authorization, and public webhook success remain unverified.

## Current blockers / external prerequisites

No repository-development blocker prevents further useful work.

A true Claude Code host acceptance requires an actual Claude Code environment/CLI to register and exercise the compiled stdio MCP server.

Live CALL-E verification still requires user-controlled prerequisites: a valid/authorized CALL-E credential, an authorized owner phone destination, and stable public HTTPS webhook ingress configured with the application-owned webhook capability token.

## Highest-value next actions

1. Deterministically test concurrent lifecycle sweep versus explicit callback/decision reconciliation on the same accepted call. Force both paths to overlap across `observe -> apply` and verify one terminal domain transition, one owner decision/instruction effect, and one causal audit chain. Add synchronization only if a real reproducible race demonstrates divergence.
2. Audit all remaining request/proxy guidance and runtime handling around `/webhooks/calle` so the query-string capability token is never encouraged into access logs, tracing metadata, error serialization, or referrer surfaces.
3. Continue tightening stable API conflict/validation semantics without reintroducing arbitrary exception reflection.
4. Run the documented acceptance in a genuine Claude Code host when that external prerequisite is available and record only observed host/version behavior.
5. When the user-controlled CALL-E prerequisites are available, perform one tightly bounded live provider acceptance and record only observed behavior.
