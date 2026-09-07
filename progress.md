# CallYourAgent progress

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. Agents can raise important owner decisions without freezing unrelated scopes; owners can independently request callbacks for progress/questions/steering; human input is persisted and consumed only at explicit safe checkpoints rather than pretending to interrupt in-flight model generation.

The repository includes SQLite persistence, deterministic fake and production CALL-E providers, replayable/idempotent call attempts, polling/webhook convergence, scoped authenticated HTTP APIs, a typed TypeScript client, stdio MCP, branch-scoped blocking, call policy/quiet hours/budgets, privacy-aware audit history, bounded lifecycle recovery, fail-closed ambiguous/stalled handling, API abuse controls, graceful shutdown, hard CALL-E HTTP deadlines, reproducible dependencies, readiness/liveness surfaces, a deterministic end-to-end demo, operator console, production Docker image, and single-instance persistent-volume Compose deployment.

This run extended the privacy-safe `RunOverview` projection through the authenticated HTTP API and typed TypeScript client, with an end-to-end regression proving that blocked scopes and queued-steering counts are visible without leaking steering text or consuming queued instructions.

## Exact repo state inspected this run

Before making changes, inspected the complete recursive `main` tree at HEAD `865aecd969eaa5d932d0e27993e4944f3e0651ea`, including source, tests, workflows, package/deployment assets, and documentation paths.

Read `AGENTS.md`, this file, `README.md`, `docs/ARCHITECTURE.md`, and `docs/INTEGRATIONS.md` in full before editing. Inspected recent commits through the privacy-safe run-overview work. Checked repository issues and pull requests; there were none.

Inspected the implementation/test surfaces relevant to this increment: `src/run-overview.ts`, `src/http-server.ts`, `src/client.ts`, `src/operator-ui.ts`, `src/call-provider.ts`, `src/domain.ts`, `tests/http-server.test.ts`, and `tests/operator-ui.test.ts`.

A direct local clone was attempted only for convenience, but outbound DNS to github.com remains unavailable in this runtime. Repository mutation used the connected GitHub API and verification used GitHub Actions; no local result was fabricated.

## Changes made this run

### Authenticated run-overview HTTP contract

Added `GET /v1/runs/:runId/overview` to `src/http-server.ts` under the existing `agent:read` scope. The route delegates directly to shared `getRunOverview(...)`; it does not reimplement state filtering in the HTTP layer.

The response contains only:

- current run snapshot;
- unresolved blocking scope ids;
- queued owner-instruction count.

It does not return owner instruction objects or instruction text, and the underlying projection uses `checkpoint(..., false)`, so reading it does not acknowledge or consume steering.

### Typed TypeScript client support

Added `CallYourAgentClient.getRunOverview(runId): Promise<RunOverview>` so generic/custom-agent adapters and future platform integrations can consume the same stable sanitized contract without hand-building URLs or parsing ad hoc JSON.

### HTTP/client acceptance regression

Added `tests/run-overview-http.test.ts`. It starts the real authenticated HTTP server with a deterministic fake provider, creates a run with independent current work plus a blocking production scope, completes an owner callback with two sensitive steering instructions, and verifies:

1. the overview route rejects unauthenticated access;
2. the typed client returns the independent current scope and unresolved blocked scope;
3. only the queued steering count is returned;
4. serialized overview output contains neither steering instruction nor a `queuedInstructions` field;
5. reading the overview does not consume the instructions, which remain queued at the next agent checkpoint.

The first test revision failed because the callback test credential intentionally lacked the separate `calls:reconcile` scope required to reconcile the fake provider result. GitHub Actions exposed the permission error. The test credential was corrected to include that explicit scope; production authorization behavior was not weakened.

Code-bearing commits this run:

- `7aecd482df77345594307b16a3e8d990c882782c` — expose privacy-safe run overview HTTP API;
- `a2728d76c19c435a6b2eab551e256a7f72e40f54` — add typed run overview client;
- `77a45300a611e05e93c1e83660862a20d0896837` — add HTTP/client privacy regression;
- `d4fae29cbbf9e51d8e1b0d4e9afb23e2896bdcc3` — fix test credential scope after CI surfaced the mismatch.

## Architecture decisions made this run

1. The HTTP layer exposes the shared sanitized projection rather than duplicating checkpoint/privacy logic.
2. `agent:read` is the correct scope for the overview because the operation is observational and non-consuming; it does not grant access to audit history or owner callback mutation.
3. Instruction text remains available only through the agent checkpoint/instruction contract, not operator-style overview reads.
4. Reading run status must remain free of checkpoint acknowledgement side effects.
5. The typed client is the canonical adapter boundary; future operator/MCP/platform surfaces should consume the same route/client semantics where appropriate rather than creating another business-state path.
6. This run still does not claim mid-token interruption or any new first-party platform capability.

## Verification performed

GitHub Actions CI run `34127435069` on the first acceptance-test revision completed with typecheck/build succeeding and 52/53 tests passing. The sole failure was the new test attempting callback reconciliation with a credential missing the required `calls:reconcile` scope. The failure was inspected from the job log and fixed without changing production authorization semantics.

The corrected commit `d4fae29cbbf9e51d8e1b0d4e9afb23e2896bdcc3` triggered the repository's standard CI, Container, and Compose workflows. At the time this progress entry was written those fresh workflows had started but had not yet all reached terminal status, so no success is fabricated here.

No live CALL-E call was attempted or claimed.

## CALL-E integration status

- Fake provider: implemented and tested across owner decisions, callbacks, branch-scoped blocking, durable steering, exact acknowledgement, idempotency, policy/lifecycle recovery, auditability, SQLite restart, deterministic demo, MCP work-loop acceptance, and privacy-safe run overview semantics. This run adds the real HTTP/client path for that overview.
- Production CALL-E adapter: implemented with server-only `CALLE_API_KEY`, provider idempotency, structured result handling, polling/webhook convergence, bounded HTTP requests, duplicate-call prevention, exact-key ambiguous replay, and fail-closed stalled handling.
- HTTP + TypeScript SDK + MCP: implemented over shared control-plane semantics. `RunOverview` is now available through HTTP and the typed client; operator wiring remains next.
- Live CALL-E success: unverified; no real authorized phone call was made.

## Current blockers / external prerequisites

No repository-development blocker currently prevents further useful work.

Live CALL-E verification still requires user-controlled prerequisites: a valid/authorized CALL-E credential, authorized owner destination, and stable public HTTPS webhook ingress with the configured webhook capability token.

Real Claude Code host acceptance still requires running the documented stdio MCP registration/workflow in an actual Claude Code environment. Repository-side MCP behavior is CI-tested, but host acceptance must not be invented.

## Highest-value next actions

1. Wire `/operator` to `GET /v1/runs/:runId/overview` so the hackathon console visibly distinguishes the independent active scope, unresolved blocked scopes, and queued-steering count without receiving steering text.
2. Add operator-console regression coverage for those indicators and preserve the current no-credentials-in-page guarantees.
3. Confirm the corrected commit's CI, Container, and Compose workflows reach terminal success; fix any newly surfaced failure before further feature work.
4. When an actual Claude Code host is available, run the documented stdio MCP host acceptance flow with the deterministic fake provider.
5. When the user-only CALL-E prerequisites are available, perform a bounded live provider acceptance test and record only the observed result.
