# CallYourAgent progress

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. Agents can raise important owner decisions without freezing unrelated scopes; owners can independently request callbacks for progress/questions/steering; human input is persisted and consumed only at explicit safe checkpoints rather than pretending to interrupt in-flight model generation.

The repository includes SQLite persistence, deterministic fake and production CALL-E providers, replayable/idempotent call attempts, polling/webhook convergence, scoped authenticated HTTP APIs, a typed TypeScript client, stdio MCP, branch-scoped blocking, call policy/quiet hours/budgets, privacy-aware audit history, bounded lifecycle recovery, fail-closed ambiguous/stalled handling, API abuse controls, graceful shutdown, readiness/liveness surfaces, deterministic demos, and a single-instance persistent-volume Compose deployment.

This run elevated the previous fake-provider rehydration work from SQLite/domain tests into the actual container deployment path. The Compose acceptance now restarts the Dockerized control plane while an accepted owner-decision phone attempt is still non-terminal, then independently does the same for an accepted owner callback. After each restart, normal reconciliation restores only process-local fake-provider state from the durable `CallAttempt` and completes the original logical phone attempt without creating a replacement call. The workflow also proves exactly-once decision/instruction side effects and preserves safe-checkpoint steering semantics across an additional SQLite-backed restart.

## Exact repo state inspected this run

The run started from `main` HEAD `7c7aae4eb2d10d28b8d13b5feea3e62b6532db8a`.

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

Also inspected the relevant implementation/deployment surfaces before and during the change:

- `src/control-plane.ts`, especially escalation/callback reconciliation, terminal outcome handling, provider rehydration, call creation, and audit events;
- `src/escalation-view.ts` for the privacy-safe active-call lifecycle projection;
- `.github/workflows/compose.yml` in full;
- the prior fake-provider restart implementation and recent commit history.

The prior run had already added the correct production/domain mechanism: durable `queued`/`in_progress` fake calls can rehydrate provider-local state after process reconstruction, while real CALL-E remains a remote durable provider and does not use that hook. The remaining evidence gap was deployment-level: Compose still restarted only after callback steering had already become terminal/durable. That meant the real container path had not yet proved a restart while the provider call itself was accepted but still active.

## Changes made this run

### Compose now restarts during an active owner-decision call

Strengthened `.github/workflows/compose.yml` so the deployment acceptance now:

1. creates a running agent whose independent scope is `documentation`;
2. creates a blocking `release-approval` owner-decision escalation;
3. verifies the privacy-safe lifecycle is `calling` with an active `queued`/`in_progress` call;
4. verifies the checkpoint still reports `documentation` as current work and only `release-approval` as blocked;
5. restarts the Dockerized control plane **before** decision reconciliation;
6. verifies the escalation remains active and the same branch remains blocked after restart;
7. reconciles the already-accepted call using only the reconciler credential;
8. verifies the durable structured owner decision resolves exactly once and releases only that branch.

The audit assertion follows the `owner_decision_recorded` event to the exact call-attempt id and then proves exactly one `call_attempt_created`, one `call_attempt_started`, and one `call_attempt_completed` event for that specific logical phone call. It therefore does not accidentally count the separate stdio MCP acceptance that runs earlier in the same persistent deployment.

### Compose now restarts during an active owner callback

The owner callback path is now split around a real container restart:

1. the owner credential creates a context-aware callback while the run remains active;
2. the callback is verified as `queued`/`in_progress` and the owner credential is still denied reconciliation authority;
3. the control plane is restarted while that callback call is still non-terminal;
4. the owner can still observe the same privacy-safe active callback and the agent still has no queued steering yet;
5. only the reconciler credential completes the restored call through normal reconciliation;
6. reconciliation is retried to prove terminal idempotency;
7. exactly one durable owner instruction is queued;
8. the audit timeline proves one create, one provider start, one completion, and one queue event for the exact callback/instruction ids.

No demo-only provider mutation endpoint, replacement call, new idempotency key, or privileged browser behavior was added.

### Safe-checkpoint behavior remains durable after another restart

After the callback completes and steering is durable, Compose performs another control-plane restart. The agent then:

- receives the same exact instruction id only at a normal non-consuming checkpoint;
- acknowledges that exact id;
- retries the acknowledgement and receives the already-consumed instruction without a duplicate transition;
- sees an empty queue on the next checkpoint;
- has exactly one `owner_instruction_queued` and one `owner_instruction_consumed` audit event for that instruction.

This keeps the product model explicit: provider completion can happen asynchronously, but human steering is incorporated only at the agent's safe work boundary.

### Transient harness failure corrected without changing production logic

The first workflow commit, `bc7e7b5928c05803183d47518e16a2f4cad2ab2d` (`ci: verify in-flight fake calls across compose restarts`), successfully passed the new restart-while-decision-active stage and the actual post-restart decision reconciliation, but failed at a newly added audit assertion.

The assertion incorrectly filtered `call_attempt_created` by `escalationId`. That audit event intentionally carries `runId` + `callAttemptId`, not `escalationId`. It also risked counting the earlier stdio MCP decision call because both flows share the same persistent Compose database. Production behavior was correct.

The corrected commit `9c1c4d317dd329f71b16f8c7099fec7eb376a631` (`test: scope decision restart audit assertions`) derives the exact call-attempt id from the unique `owner_decision_recorded` event for the target escalation, then scopes all exactly-once call assertions to that id.

## Verification performed

The execution environment did not provide a local repository checkout suitable for running Node/Docker commands directly, so no local execution claim is made. Executable verification used the repository's GitHub Actions workflows.

Corrected implementation commit `9c1c4d317dd329f71b16f8c7099fec7eb376a631` passed all three verification surfaces:

- CI run `34272901050` — **success**. Node 24 locked dependency install, TypeScript typecheck, build, and the complete test suite passed: **94 tests, 94 passed, 0 failed**.
- Container run `34272900836` — **success**. Production image build and fake-provider runtime smoke passed.
- Compose deployment run `34272900988` — **success**. Every stage passed, including generated least-privilege credentials, the existing real stdio MCP subprocess acceptance, restart while the owner-decision call was still active, post-restart decision reconciliation, restart while the owner callback was still active, exactly-once restored callback completion/steering, a further SQLite-backed restart, exact safe-checkpoint acknowledgement, idempotent acknowledgement retry, and authorization boundaries.

The earlier Compose run `34272640702` for commit `bc7e7b5928c05803183d47518e16a2f4cad2ab2d` is intentionally recorded as a **test-harness failure**. Its new active-decision restart stage passed, as did actual decision reconciliation; only the incorrect audit-filter assertion failed. That assertion was corrected rather than weakening production contracts.

`package.json` still has no separate lint script and no standalone migration/schema-check command. Available executable verification remains `npm run check` through CI plus the Container and Compose workflows.

No live CALL-E phone call was attempted or claimed.

## Architecture decisions made this run

1. In-flight restart evidence belongs at the real deployment boundary, not only in unit/SQLite tests. The reference Compose path must prove that durable state is sufficient after a whole container/process reconstruction.
2. Restart must happen before provider terminal evidence is applied. Restarting only after a decision/instruction is already durable proves persistence but does not prove accepted-call recovery.
3. Branch-scoped semantics remain observable throughout restart: the affected `release-approval` scope stays blocked while independent `documentation` work remains active.
4. Rehydration remains provider-local reconstruction, not provider re-creation. Exactly one call-create/start/completion audit chain is required for the logical attempt across restart.
5. Exactly-once assertions are correlated through durable ids rather than broad event-type counts, because the same deployment deliberately exercises multiple independent MCP/HTTP calls in one database.
6. Callback completion and instruction consumption remain separate transitions. A restored callback can finish after restart, but the resulting owner instruction is still queued until the agent explicitly checkpoints and acknowledges it.
7. Reconciliation and acknowledgement retries must remain idempotent and are now deployment-tested after restart.
8. The production CALL-E adapter remains unchanged by this fake-provider deployment evidence; live CALL-E continues to rely on the remote provider's durable call identity and normal polling/webhook reconciliation.

## CALL-E integration status

- Fake provider: deterministic, credential-free, restart-stable for provider identity, able to restore durable accepted `queued`/`in_progress` fake calls after provider-process reconstruction, and now proven at the actual Docker Compose + persistent SQLite boundary for both owner-decision and owner-callback calls.
- Production CALL-E adapter: implemented with server-only `CALLE_API_KEY`, idempotent create, structured results, active-state observation, polling/webhook terminal convergence, bounded HTTP requests, exact-key ambiguous recovery, duplicate prevention, and fail-closed stalled handling. It does not use fake-provider rehydration.
- HTTP, SDK, stdio MCP, and lifecycle reconciliation continue to share the same persistent `ControlPlane` semantics.
- Live CALL-E success remains unverified; no authorized real phone call was made.

## Current blockers / external prerequisites

No repository-development blocker prevents further useful work.

Live CALL-E verification still requires user-controlled prerequisites: a valid/authorized CALL-E credential, an authorized owner phone destination, and stable public HTTPS webhook ingress configured with the application-owned webhook capability token.

Actual Claude Code host acceptance still requires executing the documented host registration in a real Claude Code environment. The repository proves the built stdio subprocess, official MCP protocol, authenticated HTTP boundary, SQLite durability, control-plane restarts, and now in-flight provider-call restart behavior, but this is not represented as a real Claude Code host run.

## Highest-value next actions

1. Extend the external stdio MCP deployment acceptance so the **MCP host remains alive while a decision call it raised is still non-terminal across a control-plane restart**, then consumes the single durable owner decision afterward. This would connect the newly proven provider rehydration path directly to the primary agent integration surface.
2. Add a compact Claude Code real-host runbook/fixture using the existing least-privilege agent credential and current stdio MCP tools, with explicit expected checkpoints and no unsupported mid-generation claims.
3. Continue auditing restart/provider diagnostics and CI output for bearer/webhook secret exposure and fail-closed behavior.
4. Consider a small architecture note documenting the optional provider-local rehydration port now that both domain and Compose deployment evidence exist; keep it explicitly separate from remote CALL-E semantics.
5. When the user-controlled CALL-E prerequisites are available, perform one bounded live provider acceptance and record only observed behavior.
