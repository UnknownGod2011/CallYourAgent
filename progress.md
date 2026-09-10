# CallYourAgent progress

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. Agents can escalate important decisions without freezing unrelated scopes; owners can independently request callbacks for progress/questions/steering; human input is persisted as structured state and consumed only at explicit safe checkpoints rather than pretending to interrupt in-flight model generation.

The repository includes deterministic fake and production CALL-E providers, SQLite persistence, replayable/idempotent call attempts, polling/webhook convergence, branch-scoped blocking, owner decision persistence, durable per-run instruction queues, exact instruction acknowledgement, quiet hours/call budgets, bounded lifecycle recovery, fail-closed ambiguous/stalled handling, privacy-aware audit history, scoped HTTP authentication, a typed TypeScript client, a real stdio MCP adapter, deterministic end-to-end/demo flows, an operator console, a Claude Code host-acceptance runbook, and a single-instance persistent-volume Compose reference deployment.

This run verified the same-attempt concurrency boundary between the background lifecycle worker and explicit reconciliation. PR #28 adds deterministic overlap tests for both owner callbacks and blocking owner decisions, forcing `LifecycleManager.sweep()` and an explicit reconciliation request to pause on the same terminal provider observation before either local apply completes. The existing control-plane design correctly converges: terminal application re-reads current durable state inside the transaction, so the first terminal transition wins and the second path becomes a no-op. Exactly one owner instruction or owner decision is produced, branch semantics remain correct, and one causal terminal audit chain survives. No additional lock or single-flight primitive was added because the race did not reproduce divergence.

## Exact repo state inspected this run

The run started from `main` HEAD `3a529f660a535dfbf97d3258df507665cdf858fe`, the progress handoff immediately after PR #27 (`d84038b66e337a9f0fed7ece1d14053020ec8c9d`).

Before changing code, inspected the complete recursive repository tree through GitHub's recursive tree API, covering root configuration, `.github/workflows`, `deploy`, every document under `docs`, every `src` implementation surface, and the test inventory. Inspected the recent commit chain through PR #27 and verified there were no open issues and no open pull requests before this run.

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

Also inspected the relevant reconciliation and terminal-application sections of `src/control-plane.ts`, `src/lifecycle.ts`, `src/call-provider.ts`, the existing callback/concurrency tests, and the current GitHub Actions acceptance surface.

The inspection confirmed the prior handoff precisely: polling and webhooks already share `applyTerminalOutcome`, terminal application re-fetches the current `CallAttempt`, callback instruction enqueueing occurs only after the first successful completion transition, and decision resolution likewise checks current escalation state. What had not yet been proven was two independent asynchronous callers both receiving the same terminal provider evidence before either path applied it locally.

A direct unauthenticated container `git clone` was unavailable in this automation environment because outbound DNS to github.com was blocked. Repository inspection, mutation, and authoritative verification therefore used the connected GitHub integration and GitHub Actions; this is an execution-environment limitation, not a repository-development blocker.

## Changes made this run

PR #28, `Test lifecycle and explicit reconciliation overlap`, added `tests/reconciliation-overlap-concurrency.test.ts`.

The new callback test uses a deterministic gated fake provider. It starts a normal owner callback, supplies one terminal callback result, launches `LifecycleManager.sweep()`, pauses the first provider observation, launches `ControlPlane.reconcileCallback(...)`, waits until both paths are simultaneously blocked after entering `observe(...)`, then releases both observations with identical terminal evidence. It proves:

- exactly one durable callback instruction is queued;
- exactly one `call_attempt_completed` event exists;
- exactly one `owner_instruction_queued` event exists;
- the completed-call event causally precedes the queued-instruction event;
- the instruction points back to the original call attempt;
- unrelated agent work remains on its existing `documentation` scope;
- a later explicit reconciliation retry remains idempotent and does not queue another instruction.

The owner-decision test forces the same overlap for a blocking `release-approval` escalation. Before terminal evidence, the checkpoint reports only `release-approval` as blocked while the run remains on unrelated `documentation` work. After both reconciliation paths receive the same terminal result, it proves:

- exactly one durable `OwnerDecision` exists;
- exactly one `call_attempt_completed` event exists;
- exactly one `owner_decision_recorded` event exists;
- the terminal call event causally precedes the decision event;
- the affected blocking scope is released exactly once;
- the unrelated current scope is not rewritten by reconciliation;
- later explicit reconciliation is a no-op and cannot produce another decision.

The test demonstrated that the existing transaction/refetch design is sufficient for the supported single-process control-plane topology. No production synchronization was added because doing so would add complexity without fixing a reproducible correctness defect.

PR #28 was squash-merged into `main` as `0c30b2b04cf7e95532cfd130d039c099da8a44e9`.

## Verification performed

Authoritative verification ran against PR #28 head `d4d06b3853340d207ca7274cacff8e8e3c74aa6d`:

- CI run `34474703740` — **success** on Node 24.20.0. Locked dependency installation, TypeScript typecheck, build, and **158/158 tests passed**, 0 failures. Both new lifecycle-vs-explicit reconciliation overlap regressions passed.
- Container run `34474703762` — **success**. The production image and fake-provider runtime smoke path remained green.
- Compose deployment run `34474703781` — **success**. The production-style single-instance SQLite deployment acceptance remained green, including scoped credentials, persistence/restart behavior, compiled stdio MCP integration, branch-scoped decision handling, owner callback steering, and safe-checkpoint instruction consumption.

`package.json` still has no separate lint script and no standalone migration/schema-check command. `npm run check` covers TypeScript typechecking, build, and tests; SQLite tests exercise durable schema/transaction behavior; Container and Compose exercise the production image/runtime/deployment path.

No live CALL-E phone call was attempted or claimed.

## Architecture decisions made this run

1. Do not add synchronization merely because lifecycle and explicit reconciliation can overlap. A concurrency primitive is justified only if identical terminal observations can produce divergent local effects.
2. Keep provider I/O outside the SQLite transaction. Both paths may independently observe the remote call, but terminal application remains a short local durability unit.
3. Preserve the existing `applyTerminalOutcome` refetch rule: terminal application must resolve against the current persisted attempt, not against the stale pre-I/O snapshot supplied by the caller.
4. Treat a terminal attempt as an idempotency fence. Once the first path commits `completed` or `failed`, a second terminal application for that attempt must be a no-op.
5. Preserve domain-level exactly-once effects behind that fence: callback steering is queued once and owner decisions are recorded once even when multiple reconciliation callers saw terminal evidence concurrently.
6. Preserve branch semantics independently of reconciliation concurrency. A blocking escalation affects only its own `scopeId`; unrelated work remains free to continue before resolution and is not rewritten by the reconciliation process.
7. Keep the supported concurrency claim scoped to the documented single-process SQLite/reference topology. A future multi-instance store must preserve equivalent transactional/idempotency guarantees rather than assuming these process-local execution characteristics automatically transfer.

## CALL-E integration status

- **Fake provider:** deterministic, credential-free, idempotent, restart-rehydratable from durable accepted-call state, and still the primary full-flow development/acceptance provider. It now also deterministically proves lifecycle-worker and explicit-reconciliation overlap convergence for both callbacks and owner decisions.
- **Production CALL-E adapter:** implemented against the asynchronous Calls API with server-only `CALLE_API_KEY`, stable `Idempotency-Key`, structured result schemas, bounded create/poll requests, persisted correlation, polling/webhook convergence, duplicate prevention, restart-by-provider-id semantics, sanitized HTTP/transport failures, and fail-closed ambiguous/stalled handling.
- **Concurrency boundary:** lifecycle sweep and explicit reconciliation may independently poll the same accepted call, but identical terminal evidence converges through the shared transaction/refetch terminal transition without duplicate owner decisions, callback steering, or terminal audit effects in the supported topology.
- **Generic provider privacy boundary:** arbitrary provider create/recovery exceptions cannot enter durable `lastError`, and arbitrary provider observation/rehydration exceptions cannot escape through lifecycle sweep structured errors.
- **Shared surfaces:** HTTP, TypeScript SDK, stdio MCP, lifecycle worker, operator console, and deployment flows continue sharing one persistent control-plane state machine.
- **Claude Code:** compiled stdio MCP behavior remains covered by automated and Compose acceptance. A genuine Claude Code host session has still not been observed and is not claimed.
- **Live status:** no authorized real CALL-E phone call has been performed, so live provider connectivity, owner-phone authorization, and public webhook success remain unverified.

## Current blockers / external prerequisites

No repository-development blocker prevents further useful work.

A true Claude Code host acceptance requires an actual Claude Code environment/CLI to register and exercise the compiled stdio MCP server.

Live CALL-E verification still requires user-controlled prerequisites: a valid/authorized CALL-E credential, an authorized owner phone destination, and stable public HTTPS webhook ingress configured with the application-owned webhook capability token.

## Highest-value next actions

1. Audit all remaining request/proxy guidance and runtime handling around `/webhooks/calle`. The current query-string capability token is intentionally application-owned, but query credentials are inherently easy for reverse proxies, CDNs, APM agents, tracing systems, and referrer surfaces to log. Tighten defaults/tests/docs so the repository never encourages logging the full webhook URL and, where practical without inventing unsupported CALL-E signing, reduce the token's exposure surface.
2. Add deterministic HTTP/runtime privacy regressions specifically around webhook request-target handling, error paths, and any logging hooks so a webhook capability token cannot be reflected into application diagnostics.
3. Continue tightening stable API conflict/validation semantics without reintroducing arbitrary exception reflection.
4. Run the documented acceptance in a genuine Claude Code host when that external prerequisite is available and record only observed host/version behavior.
5. When the user-controlled CALL-E prerequisites are available, perform one tightly bounded live provider acceptance and record only observed behavior.
