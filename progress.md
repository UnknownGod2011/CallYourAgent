# CallYourAgent progress

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. Agents can raise important owner decisions without freezing unrelated scopes; owners can independently request callbacks for progress/questions/steering; human input is persisted and consumed only at explicit safe checkpoints rather than pretending to interrupt in-flight model generation.

The repository includes SQLite persistence, deterministic fake and production CALL-E providers, replayable/idempotent call attempts, polling/webhook convergence, scoped authenticated HTTP APIs, a typed TypeScript client, stdio MCP, branch-scoped blocking, call policy/quiet hours/budgets, privacy-aware audit history, bounded lifecycle recovery, fail-closed ambiguous/stalled handling, API abuse controls, graceful shutdown, readiness/liveness surfaces, deterministic demos, and a single-instance persistent-volume Compose deployment.

This run strengthened the real stdio MCP deployment path across a control-plane process restart. The same external MCP child now survives a restart of the Dockerized control plane after callback steering is durably queued in SQLite, reconnects through the stable HTTP boundary on its next tool call, receives that persisted steering at a safe checkpoint, and acknowledges the exact instruction idempotently. The stronger acceptance also exposed and fixed a real restart bug in the deterministic fake provider: provider call ids were process-local sequence numbers and could collide with durable SQLite rows after restart.

## Exact repo state inspected this run

The run started from `main` HEAD `a7f8c3690f437d931f95b8151346d84eca58b606`.

Before making any change, inspected the complete recursive repository tree and current architecture, recent commits, and repository issues/pull requests. There were no open issues or pull requests.

Read in full before implementation:

- `AGENTS.md`
- `progress.md`
- `README.md`
- `docs/ARCHITECTURE.md`
- `docs/INTEGRATIONS.md`
- `docs/API_SECURITY.md`
- `docs/CALL_POLICY.md`
- `docs/DEPLOYMENT.md`
- `docs/OPERATOR_CONSOLE.md`
- `deploy/README.md`

Also inspected the relevant implementation/test/deployment surfaces before and during the change:

- `tests/mcp-stdio-deployment-acceptance.ts`
- `.github/workflows/compose.yml`
- `src/call-provider.ts`
- `tests/fake-provider-auto-completion.test.ts`
- `tests/mcp-work-loop.test.ts`
- `src/mcp-server.ts`
- `src/control-plane.ts`

The previous run already proved the actual built stdio MCP subprocess against the separately running Compose control plane, but the MCP acceptance consumed callback steering before any server restart. The highest-value remaining gap was proving that the external host process could remain alive while the durable control plane restarted underneath it, then continue from persisted human steering.

## Changes made this run

### Stdio MCP host survives a control-plane restart

Updated `tests/mcp-stdio-deployment-acceptance.ts` so the acceptance can opt into restarting the real Compose control-plane service while the actual `dist/src/mcp-server.js` stdio child remains alive externally.

When `CYA_RESTART_CONTROL_PLANE=true` is set, the acceptance now:

1. drives the normal MCP decision flow while unrelated `documentation` work continues;
2. obtains the durable owner decision through the separately scoped reconciler;
3. has the owner request a callback through the owner-only HTTP credential;
4. reconciles the callback and lets normal terminal handling create one durable queued instruction;
5. runs `docker compose -f deploy/compose.yml restart callyouragent` while the MCP child remains connected to its host process;
6. waits on the normal `/ready` surface for the restarted control plane;
7. calls MCP `checkpoint` from the same child after restart and proves the SQLite-persisted instruction is still queued;
8. acknowledges exactly that instruction id;
9. retries the same exact acknowledgement and proves it remains idempotently consumed;
10. proves the audit timeline contains exactly one `owner_instruction_consumed` event for the instruction.

The workflow now sets `CYA_RESTART_CONTROL_PLANE=true` for the deployed stdio acceptance, so this is exercised by the real Compose job rather than remaining a dormant harness option.

### Restart-safe deterministic fake provider identities

The stronger acceptance passed, but its restart exposed a real fake-provider persistence mismatch in the subsequent existing Compose flow.

`FakeCallProvider` previously generated provider ids from in-memory call count (`fake_call_1`, `fake_call_2`, ...). SQLite correctly preserves provider call ids across control-plane restarts, while a new fake-provider process reset its counter to zero. A new logical call after restart could therefore reuse `fake_call_1` and collide with an older durable call attempt.

Changed fake provider identity generation to derive the provider call id deterministically from the stable provider idempotency key using SHA-256, truncated to a 24-hex-character suffix. This gives each logical fake call a stable identity across process recreation and prevents unrelated post-restart calls from reusing sequence ids.

Added regression coverage proving:

- the same idempotency key produces the same fake provider call id across separate `FakeCallProvider` instances;
- different logical idempotency keys produce different ids even when each provider instance begins empty;
- the id format is deterministic and independent of in-memory call ordering.

This change improves the fake provider's restart/replay fidelity without adding a fake mutation HTTP endpoint or changing production CALL-E behavior.

### Removed a stale sequential-id assumption from the Claude-style MCP work-loop test

The provider-id fix correctly broke one test that had reached into the fake provider with hard-coded `fake_call_1` / `fake_call_2` values.

Updated `tests/mcp-work-loop.test.ts` to obtain each real `providerCallId` from the control plane's created call attempt before completing it. The test now verifies behavior rather than depending on a fake implementation detail.

No production contract or state transition was weakened to satisfy that test.

Commits made before this progress update:

- `415155acd879c4707d8b82001ae1f277ad3dce1b` — `test: keep stdio MCP host alive across control-plane restart`
- `d35a1144ac49d8a9e5ee932d249e64d8d9f5115a` — `ci: restart control plane during stdio MCP acceptance`
- `bdab3e860779d5453df3c76b2ac91ff2693bb3b4` — `fix: make fake provider ids restart-stable`
- `042dded15b697761943d7cbdebbb7fb1cc063cfa` — `test: cover fake provider ids across restart`
- `9e198a0869817578e88399ff89648444c10d216b` — `test: stop assuming sequential fake provider ids`

## Verification performed

The automation environment did not provide a local repository checkout suitable for running the repository's Node/Docker commands directly, so no local execution claim is made. Executable verification used the repository's GitHub Actions workflows.

### First strengthened Compose run

Commit `d35a1144ac49d8a9e5ee932d249e64d8d9f5115a` triggered Compose run `34260550340`.

The new `Verify stdio MCP against deployed control plane` step **passed**. Its output explicitly reported `restartedControlPlane: true`, proving the same stdio MCP child survived the real Compose service restart, resumed over HTTP, received the persisted queued instruction, and completed the exact acknowledgement assertions.

The run then failed in the older, independent HTTP acceptance at `Reconcile owner decision and prove only blocked branch releases`. Investigation showed the restart had reset the in-memory fake provider's sequential provider-id counter while SQLite retained prior provider ids. This was a real fake-provider restart bug surfaced by the stronger acceptance, not a reason to remove the restart test.

### Provider-id fix and transient stale-test failure

After making fake provider ids restart-stable and adding regression coverage, Compose run `34260912200` passed every step, including:

- generated credential capability checks;
- stdio MCP host across control-plane restart;
- the subsequent HTTP branch-blocking owner decision flow;
- owner callback and steering;
- a second SQLite/container restart;
- safe-checkpoint consumption and authorization checks.

CI run `34260912225` on the same state failed one pre-existing test because `tests/mcp-work-loop.test.ts` still hard-coded `fake_call_1`. The new restart-id regression itself passed. The stale test was corrected to read the actual provider call id from the control plane instead of reverting the production fix.

### Final substantive implementation state

Commit `9e198a0869817578e88399ff89648444c10d216b` passed every available verification surface:

- CI run `34261066574` — **success**. Locked dependency install, TypeScript typecheck, build, and the complete **91-test** suite passed.
- Container run `34261066587` — **success**. Production image build and fake-provider runtime smoke passed.
- Compose deployment run `34261066685` — **success**. Both the external stdio MCP restart path and the existing public HTTP + SQLite persistence path completed successfully, including two control-plane restarts in the overall workflow.

`package.json` still has no separate lint script and no standalone migration/schema-check command. Available executable verification remains CI typecheck/build/test plus Container and Compose workflows.

No live CALL-E phone call was attempted or claimed.

## Architecture decisions made this run

1. A normal MCP host should tolerate temporary control-plane unavailability and continue through the same stable HTTP contract after the durable service returns; no second MCP-side state machine was introduced.
2. Human steering remains durable server-side state. The MCP process does not cache or synthesize owner instructions across restart; it asks the control plane at the next explicit safe checkpoint.
3. Exact instruction acknowledgement remains idempotent across retries. The acceptance now verifies repeated acknowledgement does not create duplicate consumption audit state.
4. The fake provider's externally visible call identity must be derived from the provider idempotency key rather than process-local sequence position. This better models a durable external provider and prevents collisions with SQLite state after server restart.
5. Tests must obtain provider ids from actual created call attempts rather than depending on fake-provider sequence numbering.
6. The fake provider remains deterministic and credential-free, but its behavior is not represented as live CALL-E success.
7. Production CALL-E provider code, server-only `CALLE_API_KEY` handling, webhook contracts, call policy, authorization scopes, and branch/safe-checkpoint semantics were not weakened or bypassed for this acceptance.

## CALL-E integration status

- Fake provider: deterministic and now restart-stable for logical provider call identity. Tested across domain, HTTP, TypeScript SDK, in-process MCP, real stdio MCP subprocess, scoped credentials, branch-scoped decisions, callbacks, safe checkpoints, exact acknowledgement, SQLite persistence, and control-plane restart.
- Production CALL-E adapter: implemented with server-only `CALLE_API_KEY`, idempotent create, structured results, active-state observation, polling/webhook terminal convergence, bounded HTTP requests, exact-key ambiguous recovery, duplicate prevention, and fail-closed stalled handling.
- HTTP, SDK, and MCP continue to share the same persistent control-plane semantics.
- Live CALL-E success remains unverified; no authorized real phone call was made.

## Current blockers / external prerequisites

No repository-development blocker prevents further useful work.

Live CALL-E verification still requires user-controlled prerequisites: a valid/authorized CALL-E credential, an authorized owner phone destination, and stable public HTTPS webhook ingress configured with the application-owned webhook capability token.

Actual Claude Code host acceptance still requires executing the documented host registration in a real Claude Code environment. The repository now proves the built stdio subprocess, official MCP protocol, authenticated HTTP boundary, SQLite durability, and control-plane restart behavior, but it must not be described as a real Claude Code host run.

## Highest-value next actions

1. Add explicit coverage for a **non-terminal fake provider call already in flight when the control plane restarts**. Durable call-attempt identity is now safe, but the fake provider itself is intentionally in-memory; define and test a principled fake-only rehydration/recovery behavior rather than letting an active fake call become an unexplained `Unknown fake call` after restart.
2. Keep that recovery fake-only and reuse the existing durable call-attempt/idempotency data; do not add a second state machine or a production mutation endpoint.
3. Add a compact real-host runbook/fixture for Claude Code that exercises the already-proven stdio tools with the least-privilege agent credential, then run it in an actual Claude Code environment when available.
4. Continue auditing deployment/restart diagnostics for bearer/webhook secret exposure and fail-closed behavior.
5. When the user-controlled CALL-E prerequisites are available, perform one bounded live provider acceptance and record only observed behavior.
