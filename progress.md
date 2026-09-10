# CallYourAgent progress

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. Agents can escalate important decisions without freezing unrelated scopes; owners can independently request callbacks for progress/questions/steering; human input is persisted as structured state and consumed only at explicit safe checkpoints rather than pretending to interrupt in-flight model generation.

The repository includes deterministic fake and production CALL-E providers, SQLite persistence, replayable/idempotent call attempts, polling/webhook convergence, branch-scoped blocking, owner decision persistence, durable per-run instruction queues, exact instruction acknowledgement, quiet hours/call budgets, bounded lifecycle recovery, fail-closed ambiguous/stalled handling, privacy-aware audit history, scoped HTTP authentication, a typed TypeScript client, a real stdio MCP adapter, deterministic end-to-end/demo flows, an operator console, a Claude Code host-acceptance runbook, and a single-instance persistent-volume Compose reference deployment.

This run continued the privacy/security audit and found a concrete least-privilege gap on successful reconciliation responses. The standard `reconciler` role intentionally has only `calls:reconcile`, but the HTTP endpoints returned the full internal `Escalation` or replayable `CallAttempt` after a successful reconcile. That made mutation authority accidentally double as read authority over escalation question/context/idempotency and callback phone-task/provider/recovery state. PR #22 now keeps reconciliation authority intact while returning only the existing privacy-safe lifecycle projections.

## Exact repo state inspected this run

The run started from `main` HEAD `421ee8588ef323ca0b507f8c92ed06f696a40c65`, immediately after PR #21 and its progress handoff documenting HTTP exception privacy hardening.

Before changing code, inspected the complete recursive repository tree through GitHub's recursive tree API, covering the root, `.github/workflows`, `deploy`, all `docs`, all `src`, and all `tests` surfaces. Inspected the recent commit chain through PR #21 and verified there were no open issues and no open pull requests before this run.

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

Also inspected the relevant implementation and test surfaces, especially `src/control-plane.ts`, `src/http-server.ts`, `src/client.ts`, `src/mcp-server.ts`, `src/callback-view.ts`, `src/escalation-view.ts`, `src/run-overview.ts`, and existing privacy/audit/provider tests.

The audit confirmed the durable internal `CallAttempt` must keep exact replayable task, metadata, idempotency, provider correlation, and bounded-recovery state for safe ambiguous-create/restart handling. It also confirmed that ordinary callback reads, escalation lifecycle reads, run overviews, audit events, and MCP error handling already project less-sensitive data. The concrete remaining gap was successful `calls:reconcile` HTTP responses: `POST /v1/escalations/:id/reconcile` returned the full escalation and `POST /v1/callbacks/:id/reconcile` returned the full internal call attempt despite the standard reconciler credential lacking `agent:read` and `decision:read`.

## Changes made this run

PR #22, `Harden reconciliation response privacy`, changed `src/http-server.ts`, `src/client.ts`, and added `tests/reconciliation-response-privacy.test.ts`.

The reconciliation endpoints now separate mutation authority from read authority:

- decision reconciliation still executes `ControlPlane.reconcileEscalation`, but the HTTP response is the existing `EscalationLifecycleView` instead of the full `Escalation`;
- callback reconciliation still executes `ControlPlane.reconcileCallback`, but the HTTP response is the existing `OwnerCallbackView` instead of the replayable `CallAttempt`;
- `CallYourAgentClient.reconcileEscalation` and `reconcileCallback` now expose those narrowed types, so platform adapters cannot accidentally depend on internal recovery state through the public SDK contract.

The decision lifecycle result keeps only operational state such as escalation/run/scope ids, blocking/priority/status, privacy-safe call status, optional policy deferral reason, and timestamps. It excludes the question, context, idempotency key, call/decision ids, provider correlation, and owner decision answer/result.

The callback lifecycle result keeps only callback id, run id, status, and timestamps. It excludes the current-status phone task, owner prompt, provider call id/name, idempotency key, metadata, `lastError`, recovery bookkeeping, transcripts, and queued steering text.

Two new end-to-end tests exercise the routes through the typed client with a credential containing only `calls:reconcile`. The decision test seeds confidential question/context/idempotency plus a secret owner answer/structured result and proves none of those values or internal correlation ids are returned. The callback test seeds a secret agent status, owner prompt, callback idempotency key, and resulting steering instruction and proves none of those values or replay/recovery fields are returned.

This is deliberately a presentation-contract change only. Durable control-plane state, CALL-E/fake-provider calls, polling/webhook convergence, provider idempotency, ambiguous recovery, branch-scoped blocking, and safe-checkpoint instruction consumption are unchanged.

## Verification performed

Direct repository execution in the automation container remained unavailable because the runtime could not resolve GitHub for a local clone, so authoritative verification used the repository's GitHub Actions surfaces as in prior runs.

PR #22 head `27bc220c33edc7ee7ac522ab37b9879a59e4d305` passed the complete repository verification matrix:

- CI run `34443655422` — **success** on Node `24.20.0`; `npm run check` completed TypeScript typechecking, build, and the Node test suite with **146 tests, 146 passed, 0 failed, 0 cancelled, 0 skipped, 0 todo**. Both new reconciliation privacy tests passed explicitly.
- Container run `34443655328` — **success**; the production image/runtime smoke path passed.
- Compose deployment run `34443655334` — **success**; the production-style single-instance SQLite + scoped credentials + compiled stdio MCP + restart/recovery + branch-safe owner-decision + callback steering + safe-checkpoint acceptance remained green.

PR #22 was squash-merged into `main` as `e29737444f6c294041bf6c842070b22e60063e47`.

`package.json` still has no separate lint script and no standalone migration/schema-check command. `npm run check` covers typechecking, build, and tests; SQLite tests exercise the durable schema/transaction path; Container and Compose exercise the production image/runtime/deployment behavior.

No live CALL-E phone call was attempted or claimed.

## Architecture decisions made this run

1. `calls:reconcile` is mutation authority, not implicit broad read authority. A provider-facing reconciler should be able to advance a call without receiving the private application context that caused the call.
2. Successful mutation responses are privacy boundaries too. Sanitizing error paths and ordinary GET views is insufficient if a privileged action route returns the full internal aggregate afterward.
3. Keep replayable provider state durable and server-side. Privacy is enforced by HTTP/SDK projection rather than weakening `CallAttempt` persistence that ambiguous-create and restart recovery require.
4. Owner decision consumption remains explicitly behind `agent:read` + `decision:read`; reconciliation never returns the durable answer merely because it caused that answer to be persisted.
5. Reuse the same lifecycle projections already used by observational read APIs instead of inventing a second reconcile-only response model.
6. The MCP adapter remains thin over the typed HTTP client and therefore automatically receives the narrowed contract without gaining a parallel authorization or state machine.
7. No change was required to branch semantics: only the affected blocking scope waits, unrelated work continues, and callback steering remains durable queued state consumed at an explicit safe checkpoint.

## CALL-E integration status

- **Fake provider:** deterministic, credential-free, idempotent, restart-rehydratable from durable accepted-call state, and still the primary full-flow development/acceptance provider.
- **Production CALL-E adapter:** remains implemented against the asynchronous Calls API with server-only `CALLE_API_KEY`, stable `Idempotency-Key`, structured result schemas, bounded create/poll requests, persisted correlation, polling/webhook convergence, duplicate prevention, restart-by-provider-id semantics, privacy-safe provider errors, and fail-closed ambiguous/stalled handling. This run did not alter provider dispatch behavior.
- **Shared surfaces:** HTTP, TypeScript SDK, stdio MCP, lifecycle worker, operator console, and deployment flows continue to share the same persistent control-plane state machine. Successful HTTP/SDK reconciliation responses are now least-privilege projections rather than internal aggregates.
- **Claude Code:** compiled stdio MCP behavior remains covered by automated and Compose acceptance. A genuine Claude Code host session has still not been observed and is not claimed.
- **Live status:** no authorized real CALL-E phone call has been performed, so live provider connectivity, owner-phone authorization, and public webhook success remain unverified.

## Current blockers / external prerequisites

No repository-development blocker prevents further useful work.

A true Claude Code host acceptance requires an actual Claude Code environment/CLI to register and exercise the compiled stdio MCP server.

Live CALL-E verification still requires user-controlled prerequisites: a valid/authorized CALL-E credential, an authorized owner phone destination, and stable public HTTPS webhook ingress configured with the application-owned webhook capability token.

## Highest-value next actions

1. Continue the privacy audit on durable/internal error state and less-direct operator surfaces. In particular, failure-test `CallAttempt.lastError` retention and verify no HTTP/MCP/operator route, lifecycle projection, or audit metadata can expose provider bodies, phone numbers, callback prompts, owner decision answers, steering text, API credentials, or webhook capability tokens.
2. Review shutdown/lifecycle overlap around provider polling and callback/decision reconciliation for same-attempt concurrent observe/apply paths not already covered by webhook/poll race tests; alter production synchronization only for a reproduced divergence.
3. Audit webhook and operational logging guidance so the application-owned webhook capability token cannot be copied into audit/error/log metadata, especially because it lives in the URL query string.
4. Continue tightening stable API conflict/validation semantics without reintroducing arbitrary exception reflection.
5. Run the documented acceptance in a genuine Claude Code host when that external prerequisite is available and record only observed host/version behavior.
6. When the user-controlled CALL-E prerequisites are available, perform one tightly bounded live provider acceptance and record only observed behavior.
