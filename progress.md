# CallYourAgent progress

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. Agents can escalate important decisions without freezing unrelated scopes; owners can independently request callbacks for progress/questions/steering; human input is persisted as structured state and consumed only at explicit safe checkpoints rather than pretending to interrupt in-flight model generation.

The repository includes deterministic fake and production CALL-E providers, SQLite persistence, replayable/idempotent call attempts, polling/webhook convergence, branch-scoped blocking, owner decision persistence, durable per-run instruction queues, exact instruction acknowledgement, quiet hours/call budgets, bounded lifecycle recovery, fail-closed ambiguous/stalled handling, privacy-aware audit history, scoped HTTP authentication, a typed TypeScript client, a real stdio MCP adapter, deterministic end-to-end/demo flows, an operator console, a Claude Code host-acceptance runbook, and a single-instance persistent-volume Compose reference deployment.

This run audited the external HTTP error boundary as part of the privacy/security surface review. A concrete leak was found: the HTTP adapter returned arbitrary thrown `Error.message` values verbatim. Although the normal domain projections and CALL-E adapter already avoided returning sensitive provider bodies, an unexpected provider/store/runtime exception could therefore have reflected task context, owner data, steering text, credentials, or other sensitive exception material to an authenticated HTTP caller. PR #21 now fails closed for unexpected errors while preserving an explicit allowlist of actionable transport/validation errors.

## Exact repo state inspected this run

The run started from `main` HEAD `edce1f944e9d216ea150976e1133fb3b098e46fc`, immediately after PR #20 and its progress handoff documented multi-instruction acknowledgement batch atomicity.

Before changing code, inspected the complete recursive repository tree through GitHub's recursive tree API, covering the root, `.github/workflows`, `deploy`, all `docs`, all `src`, and all `tests` surfaces. Inspected the recent commit chain through PR #20. There were no open issues and no open pull requests before this run.

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

Also inspected the relevant implementation and test surfaces, especially `src/http-server.ts`, `src/control-plane.ts`, `src/calle-provider.ts`, `src/call-policy.ts`, `tests/http-server.test.ts`, and the repository's existing privacy/MCP/provider tests.

The audit confirmed that `CalleCallProvider` already converts unsuccessful CALL-E HTTP responses into privacy-safe application errors containing only operation, status, and a strictly validated optional request id; upstream response bodies are not copied. Existing MCP tests also already prove upstream HTTP error bodies are not exposed to the host. The concrete remaining leak was the generic `catch` in `src/http-server.ts`, which reflected any exception message directly into JSON.

## Changes made this run

PR #21, `Harden HTTP error privacy boundary`, changed `src/http-server.ts` and added `tests/http-error-privacy.test.ts`.

The HTTP adapter now classifies exceptions through a single privacy boundary:

- unknown-resource exceptions return HTTP 404 with `{ "error": "not_found" }` instead of echoing resource identifiers;
- an oversized request body returns HTTP 413 with the stable `request_body_too_large` code;
- a non-running run returns HTTP 409 with the stable `run_not_running` code rather than echoing the run id;
- known transport/validation failures such as `invalid_json`, required-field errors, boolean/array validation errors, invalid callback-attempt type, required provider-webhook ids, and invalid audit limits remain actionable 400 responses;
- every other unexpected provider/store/control-plane/runtime exception returns HTTP 500 with `{ "error": "internal_error" }` and never reflects the exception message.

The new deterministic regressions prove that a deliberately sensitive exception message is absent from the HTTP response, an attacker-controlled identifier embedded in an `Unknown run` exception is not echoed, and malformed JSON still receives the useful stable `invalid_json` response.

This change is intentionally confined to the HTTP presentation boundary. It does not alter durable control-plane state, provider idempotency, CALL-E calls, branch-scoped blocking, checkpoint semantics, or provider/network transaction boundaries.

## Verification performed

Direct repository execution in the automation container remained unavailable because the runtime could not resolve GitHub for a local clone, so authoritative verification used the repository's GitHub Actions surfaces as in prior runs.

PR #21 head `e48e35baacdc452a84899848f39cdb573e433b35` passed the complete repository verification matrix:

- CI run `34439750657` — **success** on Node `24.20.0`; `npm run check` completed TypeScript typechecking, build, and the Node test suite with **144 tests, 144 passed, 0 failed, 0 cancelled, 0 skipped, 0 todo**. All three new HTTP privacy tests passed explicitly.
- Container run `34439750591` — **success**; the production image/runtime smoke path passed.
- Compose deployment run `34439750490` — **success**; the deployment acceptance remained green, preserving the durable fake-provider/control-plane/MCP/restart/branch-safe callback and steering path.

PR #21 was squash-merged into `main` as `bb3d40dc50f46560e5098a504977206ac9297386`.

`package.json` still has no separate lint script and no standalone migration/schema-check command. `npm run check` covers typechecking, build, and tests; SQLite tests exercise the durable schema/transaction path; Container and Compose exercise the production image/runtime/deployment behavior.

No live CALL-E phone call was attempted or claimed.

## Architecture decisions made this run

1. Exception messages are internal diagnostic data, not an HTTP contract. Unexpected exception text must never be reflected merely because the caller is authenticated.
2. The public HTTP error contract is fail-closed and allowlisted: expose only stable errors that are intentionally actionable to a client; map everything else to `internal_error`.
3. Unknown-resource responses must not echo user-controlled or sensitive identifiers. A stable `not_found` response is sufficient for the API contract.
4. Domain conflicts such as a non-running run should be represented by a stable semantic code (`run_not_running`) rather than an interpolated internal exception string.
5. Keep privacy hardening at adapter boundaries where possible. There was no reason to weaken durable `CallAttempt.lastError` recovery data or rewrite core state machines to fix an HTTP presentation leak.
6. Existing CALL-E provider error sanitization and MCP upstream-body sanitization remain complementary layers; the HTTP boundary now closes the generic final reflection path.
7. The change preserves the core product model: unrelated scopes continue while branch-specific work is blocked, and human instructions remain durable queued state consumed only at safe checkpoints.

## CALL-E integration status

- **Fake provider:** deterministic, credential-free, idempotent, restart-rehydratable from durable accepted-call state, and still the primary full-flow development/acceptance provider.
- **Production CALL-E adapter:** remains implemented against the asynchronous Calls API with server-only `CALLE_API_KEY`, stable `Idempotency-Key`, structured result schemas, bounded create/poll requests, persisted correlation, polling/webhook convergence, duplicate prevention, restart-by-provider-id semantics, privacy-safe HTTP/provider errors, and fail-closed ambiguous/stalled handling. This run did not alter provider dispatch behavior.
- **Shared surfaces:** HTTP, TypeScript SDK, stdio MCP, lifecycle worker, operator console, and deployment flows continue to share the same persistent control-plane state machine.
- **Claude Code:** compiled stdio MCP behavior remains covered by automated and Compose acceptance. A genuine Claude Code host session has still not been observed and is not claimed.
- **Live status:** no authorized real CALL-E phone call has been performed, so live provider connectivity, owner-phone authorization, and public webhook success remain unverified.

## Current blockers / external prerequisites

No repository-development blocker prevents further useful work.

A true Claude Code host acceptance requires an actual Claude Code environment/CLI to register and exercise the compiled stdio MCP server.

Live CALL-E verification still requires user-controlled prerequisites: a valid/authorized CALL-E credential, an authorized owner phone destination, and stable public HTTPS webhook ingress configured with the application-owned webhook capability token.

## Highest-value next actions

1. Continue the privacy audit on durable/internal error state and operator-visible projections: verify that `CallAttempt.lastError`, audit metadata, run overviews, callback lifecycle views, and any reconciliation response cannot surface callback prompts, owner decision answers, instruction text, phone numbers, API credentials, or webhook capability tokens through less-direct paths.
2. Review shutdown/lifecycle overlap around provider polling and callback/decision reconciliation for same-attempt concurrent observe/apply paths not already covered by webhook/poll race tests; alter production synchronization only for a reproduced divergence.
3. Audit validation/error classification for stable API semantics so legitimate domain conflicts remain distinguishable without falling back to sensitive exception reflection.
4. Run the documented acceptance in a genuine Claude Code host when that external prerequisite is available and record only observed host/version behavior.
5. When the user-controlled CALL-E prerequisites are available, perform one tightly bounded live provider acceptance and record only observed behavior.
