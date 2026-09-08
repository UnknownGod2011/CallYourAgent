# CallYourAgent progress

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. Agents can raise important owner decisions without freezing unrelated scopes; owners can independently request callbacks for progress/questions/steering; human input is persisted and consumed only at explicit safe checkpoints rather than pretending to interrupt in-flight model generation.

The repository includes SQLite persistence, deterministic fake and production CALL-E providers, replayable/idempotent call attempts, typed active-provider observations, polling/webhook convergence, scoped authenticated HTTP APIs, a typed TypeScript client, stdio MCP, branch-scoped blocking, call policy/quiet hours/budgets, privacy-aware audit history, bounded lifecycle recovery, fail-closed ambiguous/stalled handling, API abuse controls, graceful shutdown, bounded CALL-E HTTP requests, readiness/liveness surfaces, deterministic end-to-end and operator demos, a production Docker image, and a single-instance persistent-volume Compose deployment.

This run connected the deterministic fake provider's opt-in observation-driven completion to the real runtime and reference Compose deployment, then upgraded the Compose acceptance from a persistence/auth smoke into a complete public-boundary product story. The actual container now proves that an agent can create a blocking owner decision while an independent scope remains active; the reconciler alone can obtain terminal provider evidence; the agent can consume the durable owner decision; the owner can independently request a callback; callback steering becomes durable queued state; that steering survives a SQLite/container restart; and the agent receives and acknowledges the exact instruction only at a later safe checkpoint. No fake-provider mutation HTTP endpoint was added.

## Exact repo state inspected this run

The run started from `main` HEAD `48c2137459965bb788771261048b5658a07b841f`.

Before making changes, inspected the complete recursive repository tree and current architecture. The recursive Git tree response was complete (`truncated: false`) and covered root configuration, all GitHub Actions workflows, deployment assets, documentation, source modules, scripts, and the complete test inventory. Inspected recent commit history through the deterministic fake auto-completion work. Checked open repository issues and pull requests; there were no open issues or pull requests.

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

Also inspected the relevant implementation/deployment surfaces before editing, including:

- `src/call-provider.ts`
- `src/server.ts`
- `src/http-server.ts`
- `tests/fake-provider-auto-completion.test.ts`
- `tests/server-runtime.test.ts`
- `deploy/compose.yml`
- `.github/workflows/compose.yml`
- `.env.example`

The previous run had already added opt-in deterministic terminal outcomes inside `FakeCallProvider`, but `src/server.ts` always constructed `new FakeCallProvider()` with no environment configuration. Therefore a separately running reference container still could not use the new capability. The prior `Compose deployment` workflow also stopped after scoped-auth/persistence checks and never proved the actual branch-scoped decision + owner-callback + restart + checkpoint story.

## Changes made this run

### Fake-only runtime configuration

Updated `src/server.ts` so fake mode accepts:

- `CYA_FAKE_AUTO_COMPLETE_AFTER_OBSERVATIONS=<positive integer>`

When configured, the value is validated with the same positive-integer environment parsing used elsewhere and passed to `FakeCallProvider({ autoCompleteAfterObservations })`.

The setting is deliberately fake-only. If it is present while `CYA_CALL_PROVIDER=calle`, runtime construction fails immediately with an explicit error instead of silently accepting a demo/test behavior in live provider mode.

Added runtime tests proving:

1. a fake runtime with threshold `1` becomes terminal on its first provider observation;
2. non-positive thresholds are rejected;
3. the fake-only setting is rejected in `calle` mode before any live provider configuration can be mistaken for a supported use of it.

### Reference Compose wiring

Updated `deploy/compose.yml` to pass `CYA_FAKE_AUTO_COMPLETE_AFTER_OBSERVATIONS` into the container as an optional value. Its default remains empty, so normal fake-provider semantics are unchanged unless a deployment/test explicitly opts in.

Updated `.env.example` to document the variable as a deterministic fake/testing aid, note that it is disabled by default, and state that the runtime rejects it in live CALL-E mode.

### Full public-boundary Compose acceptance

Reworked `.github/workflows/compose.yml` so the real Docker + SQLite deployment proves the core two-way CallYourAgent product under the standard four generated least-privilege credentials.

The workflow now sets the fake completion threshold to `1` only for the acceptance and lengthens the lifecycle sweep interval so explicit reconciliation remains deterministic rather than racing the background worker.

The acceptance executes these real HTTP/control-plane transitions:

1. Generate independent `agent`, `owner`, `operator-read`, and `reconciler` credentials and verify their exact capabilities.
2. Register an agent and start a run with `currentScope = documentation`.
3. Create a blocking owner-decision escalation for `release-approval`.
4. Checkpoint the run and prove `documentation` remains active while only `release-approval` appears in `unresolvedBlockingScopes`.
5. Prove the owner credential cannot reconcile the provider call.
6. Reconcile the decision with the dedicated reconciler credential; the fake provider returns its deterministic structured `proceed` result through the normal provider observation path.
7. Read the durable decision with the agent credential and prove the owner credential still cannot read the private decision result.
8. Checkpoint again and prove the blocking scope is released while the independent current scope remains unchanged.
9. Prove the agent credential cannot request an owner callback.
10. Request a callback with the owner credential using the real `POST /v1/callbacks` contract.
11. Prove the owner credential cannot reconcile that callback; reconcile it with the reconciler credential.
12. Let the deterministic callback result create one durable queued steering instruction through normal terminal reconciliation.
13. Restart the actual Compose service over the same named SQLite volume **before** any agent checkpoint consumes the instruction.
14. After restart, prove run state survives and a non-consuming checkpoint returns exactly one queued instruction with the expected deterministic text.
15. Acknowledge exactly that returned instruction id through `/v1/runs/:id/instructions/ack`.
16. Checkpoint again and prove the queue is empty and no blocking scope remains.
17. Recheck operator/audit access, reconciler read denial, and role capabilities after restart so persistence cannot accidentally widen authorization.

This acceptance uses the real HTTP boundary, the real control-plane state machine, the deterministic provider port, SQLite persistence, scoped credentials, and the production container. It adds no fake/admin endpoint and no alternate state machine.

### CI credential-log hardening

The Compose workflow now stores generated role tokens in shell variables, registers each token with the GitHub Actions `add-mask` command, and only then writes them to `GITHUB_ENV`. The generated credential JSON itself is not printed. This reduces the risk that an expanded bearer value appears in later command/error output while preserving the same tested role model.

Implementation/hardening commits before this progress update:

- `1d4fc974016a5a91251a3f32e413f2fdb2dd94b0` — `feat: configure fake provider auto completion from runtime env`
- `51fc80c68452e6014a8cecfac2440dd2dacf5b55` — `test: validate fake auto completion runtime env`
- `d37672e6b032e270b8dbbd47da1749c6d5792879` — `deploy: expose fake auto completion setting`
- `b8aa823e8e509d0e6594cceb858063fb97bced1e` — `test: prove branch decision and callback steering in compose`
- `d97f5420340477d814fa4fa4b45b30f295de7dbc` — `ci: mask generated scoped credentials`
- `b303a2fbcaf0a5ce1e216826fd1b165dcaa3745b` — `docs: document fake auto completion runtime setting`

## Verification performed

The automation environment did not provide a local repository checkout suitable for running Node/Docker tooling directly, so no local test/build claim was fabricated. Executable verification used the repository's GitHub Actions workflows.

The substantive implementation state at commit `b8aa823e8e509d0e6594cceb858063fb97bced1e` passed every available verification surface:

- CI run `34248972851` — **success**. Node 24 locked install, TypeScript typecheck, build, and complete test suite passed, including the new runtime environment validation tests.
- Container run `34248972855` — **success**. The production Docker image built and the deterministic fake-provider runtime smoke passed.
- Compose deployment run `34248972902` — **success**. The real scoped-only Docker + SQLite deployment completed the strengthened branch-blocking decision, owner decision consumption, owner callback, reconciler-only provider progression, durable queued steering, container restart, safe checkpoint, exact acknowledgement, audit, and post-restart authorization checks.

The later credential-mask-only commit `d97f5420340477d814fa4fa4b45b30f295de7dbc` triggered a fresh CI/Container/Compose cycle. At the time this progress entry was written those runs had started and the Compose run `34249252797` was still in progress; no success claim is made for an unfinished run. The immediately preceding substantive behavior is already verified by the three successful runs above.

`package.json` still has no separate lint script and no standalone migration/schema-check command. Available executable verification remains the CI typecheck/build/test workflow plus the Container and Compose deployment workflows.

No live CALL-E phone call was attempted or claimed.

## Architecture decisions made this run

1. Deterministic fake auto-completion is runtime-configurable only in fake mode. A test convenience must never be silently accepted in the live CALL-E path.
2. The fake completion threshold remains opt-in and empty by default in Compose. Existing precise queued/in-progress/ambiguous tests and manual fake-provider demos keep their prior behavior.
3. A credible deployment acceptance should progress provider state through `observe()`/reconciliation, not through a production HTTP endpoint that mutates fake-provider internals.
4. Branch blocking remains scope-specific. The Compose acceptance explicitly proves `documentation` continues while `release-approval` waits and that resolving the decision releases only the blocked scope.
5. Provider reconciliation remains a distinct trusted responsibility. The owner can request a callback but cannot reconcile it; the agent can consume a decision but cannot initiate an owner callback; the reconciler cannot read ordinary run state.
6. Owner steering is not treated as a mid-generation interrupt. The workflow deliberately restarts the container after steering is durably queued and before the agent checkpoint, then proves the agent receives it only at the later explicit safe boundary.
7. Exact acknowledgement remains two-phase. The agent reads a non-consuming checkpoint, incorporates that specific durable item, and acknowledges only its exact id; a subsequent checkpoint proves it is no longer queued.
8. Restart durability is part of the product story, not only a storage smoke. The full callback-to-steering path now crosses an actual SQLite/container restart.
9. CI bearer credentials are masked as soon as they are generated. Authorization still lives entirely at the HTTP control-plane boundary; masking does not introduce a second credential system.
10. No production CALL-E create/poll/webhook schema, provider idempotency semantics, persistence schema, policy budgets/quiet hours, ambiguity recovery, stale-call handling, MCP semantics, or operator privacy projection changed in this run.

## CALL-E integration status

- Fake provider: deterministic and tested for decisions, callbacks, branch-scoped blocking, durable steering, idempotency, ambiguous recovery, active-state progress, stale downgrade rejection, bounded stale detection, restart durability, auditability, HTTP/TypeScript/MCP integration, operator demos, privacy boundaries, generated least-privilege roles, scoped-only Compose deployment, observation-driven terminal completion, and now the complete real-container decision → callback → restart → safe-checkpoint acceptance.
- Production CALL-E adapter: implemented with server-only `CALLE_API_KEY`, idempotent create, structured result schemas, active-state observation, terminal polling/webhook convergence, bounded HTTP requests, exact-key ambiguous recovery, duplicate prevention, and fail-closed stalled handling.
- HTTP, TypeScript SDK, and MCP continue to delegate to the same persistent control-plane semantics. No browser-agent architecture or demo-only state machine was introduced.
- Live CALL-E success remains unverified; no real authorized phone call was made.

## Current blockers / external prerequisites

No repository-development blocker prevents further useful work.

Live CALL-E verification still requires user-controlled prerequisites: a valid/authorized CALL-E credential, an authorized owner phone destination, and stable public HTTPS webhook ingress configured with the application-owned webhook capability token.

Real Claude Code host acceptance still requires running the documented stdio MCP workflow in an actual Claude Code environment. Repository-side MCP behavior is already tested through the official MCP client/server packages and authenticated HTTP control plane, but host-level acceptance must not be fabricated.

## Highest-value next actions

1. Add a deployment-level stdio MCP acceptance against the running Compose control plane: launch the built `mcp-server` process with the standard agent credential and prove tool discovery + register/start/report/request-decision/checkpoint/ack operations cross the real MCP → TypeScript client → authenticated HTTP → SQLite control-plane path. Keep provider reconciliation on its separate reconciler credential rather than giving MCP phone-side authority merely for the test.
2. Keep the MCP acceptance checkpoint-based and explicitly verify that queued owner steering is observed only between work units; do not create any claim of mid-token host interruption.
3. Audit the Compose workflow's generated credential JSON handling for any remaining accidental exposure paths (for example diagnostic dumps) while preserving the current `add-mask` protection and not logging secret values.
4. Consider adding a small operator-visible deployment/demo status artifact that consumes only existing privacy-safe APIs if it materially improves judging, without moving business state into the UI.
5. When an actual Claude Code host is available, run the documented host registration (`claude mcp add ...`) and verify the same stdio tools from the real host.
6. When user-only CALL-E prerequisites are available, perform one bounded live provider acceptance test and record only observed results.
