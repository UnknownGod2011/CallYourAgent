# CallYourAgent progress

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. Agents can raise important owner decisions without freezing unrelated scopes; owners can independently request callbacks for progress/questions/steering; human input is persisted and consumed only at explicit safe checkpoints rather than pretending to interrupt in-flight model generation.

The repository includes SQLite persistence, deterministic fake and production CALL-E providers, replayable/idempotent call attempts, polling/webhook convergence, scoped authenticated HTTP APIs, a typed TypeScript client, stdio MCP, branch-scoped blocking, call policy/quiet hours/budgets, privacy-aware audit history, bounded lifecycle recovery, fail-closed ambiguous/stalled handling, API abuse controls, graceful shutdown, bounded CALL-E HTTP requests, readiness/liveness surfaces, deterministic end-to-end and operator demos, a production Docker image, and a single-instance persistent-volume Compose deployment.

This run closed the previously identified `in_progress` acceptance gap. The deterministic fake provider can now truthfully model a provider that returns `in_progress` when a call is accepted, while retaining `queued` as its default. Regression coverage proves that this status survives the durable call attempt, privacy-safe owner callback view, run overview, audit metadata, idempotent retry, and later completion without exposing callback prompt/task content or queued steering text.

## Exact repo state inspected this run

Before making any changes, inspected the complete recursive `main` repository tree at HEAD `3d35d1c495ad2f494543b11c1109659b98b09cdf`. The Git tree reported `truncated: false` and covered root configuration, all GitHub workflows, deployment assets, every documentation file, every `src` file, and every test file.

Inspected recent commits through the callback privacy-hardening work. Checked repository issues and pull requests; there were no open issues and no open pull requests competing with this work.

Read `AGENTS.md`, this file, `README.md`, `docs/ARCHITECTURE.md`, `docs/INTEGRATIONS.md`, `docs/API_SECURITY.md`, `docs/CALL_POLICY.md`, `docs/DEPLOYMENT.md`, `docs/OPERATOR_CONSOLE.md`, and `deploy/README.md` in full before editing.

Inspected the relevant provider/lifecycle/read-model implementation and tests before making changes: `src/call-provider.ts`, `src/calle-provider.ts`, `src/domain.ts`, `src/control-plane.ts`, `src/lifecycle.ts`, `src/run-overview.ts`, `tests/calle-provider.test.ts`, `tests/control-plane.test.ts`, and `tests/operator-ui.test.ts`, plus the complete source/test listing from the recursive tree.

The prior run had already made owner callback creation/read responses privacy-safe and explicitly identified the next highest-value action: cover a provider that truthfully reports `in_progress` and verify that state reaches the callback DTO, run overview, audit, and operator presentation without leaking replay/provider material.

## Changes made this run

### Deterministic fake provider can truthfully start `in_progress`

Updated `FakeCallProvider` in `src/call-provider.ts` with an optional `initialStatus: "queued" | "in_progress"` setting.

The default remains `queued`, preserving all existing deterministic demos and tests. A focused test/provider path can now select `in_progress` at create time, matching the existing `CallProvider.start` contract and the production CALL-E adapter's already-supported create response.

The fake provider's idempotency map now stores the full accepted `StartCallResult` rather than only the provider call id. Retrying the exact same idempotency key therefore returns the same provider call id **and the same accepted start status**, rather than accidentally rewriting an originally accepted `in_progress` call back to `queued`.

### In-progress callback projection acceptance

Added `tests/in-progress-callback.test.ts`.

The acceptance creates a running agent and owner callback using `FakeCallProvider({ initialStatus: "in_progress" })` and proves:

- the durable `CallAttempt` is genuinely `in_progress` immediately after provider acceptance;
- `OwnerCallbackView` returns only `id`, `runId`, `status`, `createdAt`, and `updatedAt`, with `status: "in_progress"`;
- the run overview reports that exact callback as `in_progress` without exposing `providerCallId` or the owner's callback prompt;
- the durable `call_attempt_started` audit event records only safe operational metadata including `status: "in_progress"`, without copying the phone task/prompt;
- after deterministic terminal evidence arrives, normal callback reconciliation moves the call to `completed` and queues exactly one owner instruction;
- the overview then reports `completed` plus `queuedInstructionCount: 1` while still omitting the instruction text;
- an idempotent retry against an in-progress fake call returns the exact same accepted result instead of creating/relabeling another call.

The existing operator UI already renders `latestOwnerCallback.status` generically and has regression coverage for the `in_progress` presentation copy. The new domain/read-model acceptance therefore exercises the previously missing state source rather than adding a demo-only browser transition.

Code/test commits made this run:

- `1e829b80028aba03d60e84f4081384f35a8fe2df` — `feat: let fake provider model immediate in-progress calls`
- `6c090d56302c11e110f605d8aa11cdcc68a2745f` — `test: cover truthful in-progress callback projection`

## Architecture decisions made this run

1. Do not fabricate a `queued -> in_progress` transition solely for presentation. The deterministic provider now truthfully returns `in_progress` through the same `StartCallResult` contract a real provider may return at create time.
2. Preserve fake-provider defaults. `queued` remains the normal deterministic mode so existing demo timing and established acceptance behavior do not change unless a test explicitly asks for `in_progress`.
3. Provider idempotency includes the accepted state, not only the provider call id. Retrying one logical create must reproduce the same accepted result rather than changing local lifecycle state.
4. `in_progress` remains ordinary durable `CallAttempt` state. Owner/browser surfaces receive only the existing privacy-safe projection; provider ids, replayable tasks, callback prompts, and recovery material remain server-side.
5. Auditability remains metadata-only. The operator can learn that a provider accepted an in-progress call, but the audit log does not become a second transcript/task store.
6. Human steering semantics are unchanged. Completion may enqueue structured steering, but it remains durable queued state for a later safe checkpoint; no mid-token interruption behavior was introduced.
7. A distinct follow-on gap is now clearer: when a provider create initially returns `queued` and a later poll reports `in_progress`, the current provider polling contract returns `null` for both active states, so the control plane cannot durably distinguish that queued-to-in-progress observation. That should be solved through an explicit provider observation/read contract, not by guessing in the UI.

## Verification performed

The code/test-bearing state `6c090d56302c11e110f605d8aa11cdcc68a2745f` passed all repository verification paths:

- CI run `34189059427` — `completed` / `success`; the normal Node 24 locked-install, TypeScript typecheck, build, and full Node test suite passed, including the new `in-progress-callback` acceptance.
- Container run `34189059389` — `completed` / `success`; production image build and fake-provider runtime smoke passed.
- Compose deployment run `34189059461` — `completed` / `success`; Compose validation, fake-provider deployment boot/health, durable API-state creation, named-volume restart, and post-restart persistence checks passed.

`package.json` has no separate lint script and no standalone migration/schema command. The available repository verification path remains CI typecheck/build/test plus Container and Compose deployment workflows.

No live CALL-E phone call was attempted or claimed.

## CALL-E integration status

- Fake provider: implemented and tested across owner decisions, callbacks, branch-scoped blocking, durable steering, exact acknowledgement, idempotency, lifecycle recovery, auditability, deterministic demos, HTTP/MCP integration, credential separation, branch-safe visualization, privacy-safe callback status, SQLite restart persistence, privacy-safe callback creation/read responses, and now truthful immediate `in_progress` provider acceptance plus idempotent preservation of that state.
- Production CALL-E adapter: implemented with server-only `CALLE_API_KEY`, idempotent create requests, structured outcomes, create-time `queued`/`in_progress` support, polling/webhook convergence for terminal results, bounded requests, duplicate-call prevention, exact-key ambiguous replay, and fail-closed stalled handling.
- HTTP + TypeScript SDK + MCP: implemented over shared control-plane semantics. Owner/operator callback reads remain narrow/privacy-safe; trusted reconciliation remains separate.
- Live CALL-E success: unverified; no real authorized phone call was made.

## Current blockers / external prerequisites

No repository-development blocker currently prevents further useful work.

Live CALL-E verification still requires user-controlled prerequisites: a valid/authorized CALL-E credential, an authorized owner destination, and stable public HTTPS webhook ingress with the configured webhook capability token.

Real Claude Code host acceptance still requires running the documented stdio MCP registration/workflow in an actual Claude Code environment. Repository-side MCP behavior is tested, but host acceptance must not be invented.

## Highest-value next actions

1. Extend the provider read/reconciliation contract so a later provider poll can distinguish active `queued` from `in_progress` (instead of returning `null` for both), persist a truthful `queued -> in_progress` observation without creating a new phone side effect, and audit it with privacy-safe metadata. Keep terminal polling/webhook convergence on the same domain transition path and verify lifecycle stale-age semantics are not accidentally refreshed forever by repeated identical observations.
2. Review the owner-decision read boundary (`GET /v1/escalations/:id`) for equivalent least-privilege concerns: it intentionally returns structured owner decision data to agent readers, so document and test which roles may see answer text rather than narrowing it blindly.
3. Consider a trusted internal/admin callback diagnostic surface only if real operations require it; do not broaden the ordinary owner/read DTO for troubleshooting convenience.
4. Continue improving the one-command judge flow only where it communicates already-tested semantics rather than adding demo-only state.
5. When an actual Claude Code host is available, run the documented stdio MCP host acceptance flow with the deterministic fake provider.
6. When user-only CALL-E prerequisites are available, perform a bounded live provider acceptance test and record only the observed result.
