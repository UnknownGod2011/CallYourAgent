# CallYourAgent progress

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. Agents can escalate important decisions without freezing unrelated scopes; owners can independently request callbacks for progress/questions/steering; human input is persisted as structured state and consumed only at explicit safe checkpoints rather than pretending to interrupt in-flight model generation.

The repository includes deterministic fake and production CALL-E providers, SQLite persistence, replayable/idempotent call attempts, polling/webhook convergence, branch-scoped blocking, owner decision persistence, durable per-run instruction queues with exact acknowledgement, quiet hours/call budgets, bounded lifecycle recovery, fail-closed ambiguous/stalled handling, privacy-aware audit history, scoped HTTP authentication, a typed TypeScript client, a real stdio MCP adapter, deterministic end-to-end/demo flows, an operator console, a Claude Code host-acceptance runbook, and a single-instance persistent-volume Compose reference deployment.

This run hardened HTTP domain-conflict semantics. PR #31 now returns stable privacy-safe `409` contracts for two client-correctable precondition conflicts that previously looked like transport errors or generic failures: cross-run owner-instruction acknowledgement returns `instruction_run_mismatch`, and attempting callback reconciliation against a non-callback call attempt returns `callback_purpose_mismatch`. Unexpected exceptions remain fail-closed as `500 internal_error`.

## Exact repo state inspected this run

The run started from `main` HEAD `42a02dcf9c762fcb94dd8febac31cfb7ae618525`, the progress handoff after PR #30 (`e4676f5039a2bfec5c14807107a957153f4d7916`).

Before changing code, inspected the complete recursive repository tree at that exact HEAD, including root configuration, all GitHub Actions workflows, `deploy`, every architecture/integration document under `docs`, the full `src` implementation inventory, and the complete test inventory. Inspected recent commits through PR #30 and current issue/PR state; there were no open issues or open pull requests before this run.

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

Also inspected the HTTP/control-plane implementation and existing regression surface, especially `src/http-server.ts`, `src/control-plane.ts`, `tests/http-server.test.ts`, and the complete test inventory represented by the repository tree.

The inspection confirmed that the HTTP adapter already hid arbitrary unexpected exceptions behind `500 internal_error`, mapped unknown resources to privacy-safe `404 not_found`, and mapped non-running runs to `409 run_not_running`. Two known domain/precondition conflicts still had weaker semantics: a cross-run instruction acknowledgement exposed a detailed internal message path that collapsed to 500, while reconciling a decision call through the callback endpoint was treated as a 400 validation error even though the referenced resource exists and simply violates the endpoint's domain precondition.

The same inspection also surfaced a separate idempotency-contract question that remains intentionally unresolved by this PR: request-level idempotency maps currently return the previously mapped resource for a reused key without proving that a retry carries the same logical run/scope/request payload. That needs its own tests and contract decision rather than being mixed into this narrow HTTP status-code change.

Repository mutation used the connected GitHub integration and authoritative verification used GitHub Actions.

## Changes made this run

PR #31, `Harden HTTP domain conflict contracts`, changed `src/http-server.ts` and added `tests/http-conflict-contracts.test.ts`.

Production behavior now:

- maps `Instruction <id> does not belong to run <id>` to HTTP `409` with the fixed public code `instruction_run_mismatch`;
- maps `Call attempt is not an owner callback` to HTTP `409` with the fixed public code `callback_purpose_mismatch`;
- does not echo the instruction id, source run id, destination run id, call-attempt id, or original exception text in either response;
- preserves the existing `500 {"error":"internal_error"}` fallback for unexpected exceptions;
- leaves the underlying domain behavior unchanged: a rejected cross-run acknowledgement remains atomic/non-mutating and the instruction stays queued for its correct run; callback-purpose mismatch does not mutate the call attempt.

The new deterministic HTTP regressions prove both the response semantics and the non-leak/non-mutation properties.

No call state machine, branch-scoped blocking behavior, owner-decision persistence, callback/instruction semantics, provider idempotency, webhook reconciliation, lifecycle behavior, fake-provider behavior, or live CALL-E behavior changed.

PR #31 was squash-merged into `main` as `c5eb8deac6f39c0536d3ce3ab8e932dcc7c222f5`.

## Verification performed

Authoritative verification ran against PR #31 head `dc0d9ad87fd7d2330324453ee82d542c74230a27`:

- CI run `34493134603` — **success** on Node 24.20.0. Locked dependency installation succeeded; TypeScript typecheck succeeded; build succeeded; **166/166 tests passed**, 0 failures. Both new HTTP conflict tests passed.
- Container run `34493134386` — **success**. The production image/fake-provider runtime path remained green.
- Compose deployment run `34493134533` — **success**. The production-style single-instance SQLite acceptance remained green, preserving generated scoped credentials, compiled stdio MCP, durable branch-scoped decision behavior, restart recovery, owner callback flow, exactly-once steering, persistence across restart, and safe-checkpoint consumption.

`package.json` still has no separate lint script and no standalone migration/schema-check command. `npm run check` covers typechecking, build, and tests; SQLite tests exercise schema/transaction durability; Container and Compose cover the production image/runtime/deployment paths.

No live CALL-E phone call was attempted or claimed.

## Architecture decisions made this run

1. Known domain/precondition conflicts that clients can safely correct should use stable opaque `409` codes rather than raw internal exception strings or generic 500s.
2. Cross-run instruction acknowledgement is a resource-state conflict, not malformed JSON: the instruction and run may both exist, but that instruction is not valid for that run.
3. Callback-purpose mismatch is likewise a resource-purpose conflict: the call attempt exists, but it cannot be reconciled through the owner-callback operation.
4. Public error contracts should describe the conflict class without echoing attacker-controlled or sensitive resource identifiers.
5. Unexpected/domain-unclassified exceptions remain fail-closed as `500 internal_error`; this change does not widen the set of raw error messages considered safe.
6. The idempotency-key payload-binding concern is deliberately left for a separate coherent change with explicit replay-compatibility tests rather than being bundled speculatively into HTTP error mapping.

## CALL-E integration status

- **Fake provider:** deterministic, credential-free, idempotent, restart-rehydratable from durable accepted-call state, and still the primary full-flow development/acceptance provider.
- **Production CALL-E adapter:** implemented against the asynchronous Calls API with server-only `CALLE_API_KEY`, stable `Idempotency-Key`, structured result schemas, bounded create/poll requests, persisted correlation, polling/webhook convergence, duplicate prevention, restart-by-provider-id semantics, privacy-safe provider diagnostics, and fail-closed ambiguous/stalled handling.
- **Public webhook configuration:** live runtime requires an exact HTTPS origin and constructs the tokenized webhook target structurally. Application request handling strips the capability token from `IncomingMessage.url` immediately after extraction. Reverse-proxy/CDN/APM query-string redaction remains mandatory because those layers may see the raw request first.
- **Shared surfaces:** HTTP, TypeScript SDK, stdio MCP, lifecycle worker, operator console, and deployment flows continue sharing one persistent control-plane state machine.
- **HTTP error boundary:** known safe conflicts now have stable opaque 409 codes while unexpected exceptions continue to collapse to `internal_error`.
- **Claude Code:** compiled stdio MCP behavior remains covered by automated and Compose acceptance. A genuine Claude Code host session has still not been observed and is not claimed.
- **Live status:** no authorized real CALL-E phone call has been performed, so live provider connectivity, owner-phone authorization, and externally reachable webhook delivery remain unverified.

## Current blockers / external prerequisites

No repository-development blocker prevents further useful work.

A true Claude Code host acceptance requires an actual Claude Code environment/CLI to register and exercise the compiled stdio MCP server.

Live CALL-E verification still requires user-controlled prerequisites: a valid/authorized CALL-E credential, an authorized owner phone destination, and a stable externally reachable HTTPS origin whose ingress is configured not to log the webhook capability query string.

## Highest-value next actions

1. Audit and harden request-level idempotency-key replay binding so reusing one key for a different logical run/scope/request cannot silently alias to an unrelated existing escalation or callback. Add deterministic in-memory and SQLite/concurrency tests before changing the contract, and preserve exact retries as no-op replays.
2. Continue the HTTP validation audit, especially enum/date inputs such as escalation priority and `expiresAt`, so invalid client input receives stable 4xx responses without weakening the fail-closed unexpected-error boundary.
3. Review live-runtime environment validation ordering for any remaining pure settings that can fail only after durable storage opens, and move safe validation earlier where it does not duplicate domain rules.
4. Continue hardening operator/reconciler least-privilege boundaries without widening browser or agent credentials.
5. Run the documented acceptance in a genuine Claude Code host when that external prerequisite is available and record only observed host/version behavior.
6. When the user-controlled CALL-E prerequisites are available, perform one tightly bounded live provider acceptance and record only observed behavior.
