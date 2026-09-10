# CallYourAgent progress

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. Agents can escalate important decisions without freezing unrelated scopes; owners can independently request callbacks for progress/questions/steering; human input is persisted as structured state and consumed only at explicit safe checkpoints rather than pretending to interrupt in-flight model generation.

The repository includes deterministic fake and production CALL-E providers, SQLite persistence, replayable/idempotent call attempts, polling/webhook convergence, branch-scoped blocking, owner decision persistence, durable per-run instruction queues with exact acknowledgement, quiet hours/call budgets, bounded lifecycle recovery, fail-closed ambiguous/stalled handling, privacy-aware audit history, scoped HTTP authentication, a typed TypeScript client, a real stdio MCP adapter, deterministic end-to-end/demo flows, an operator console, a Claude Code host-acceptance runbook, and a single-instance persistent-volume Compose reference deployment.

This run strengthened request-level idempotency with deterministic SQLite race coverage. PR #33 proves that while the winning owner-callback or owner-decision provider start is deliberately still in flight, a second request reusing the same idempotency key with a different logical payload cannot replace the durable binding, mutate the winning request, or trigger a second provider call. The existing synchronous SQLite reservation transaction already provides the required single-instance invariant, so no speculative lock layer was added.

## Exact repo state inspected this run

The run started from `main` HEAD `1608ad5f98f109813fcaccc7910efffdf3888700`, the progress handoff after PR #32 (`b01aeff664dcc7f32974bde3e46dfd517075efa4`).

Before changing code, inspected the complete recursive repository tree at that exact HEAD with GitHub's recursive tree API and confirmed it was not truncated. This covered root configuration, all GitHub Actions workflows, the `deploy` reference deployment, every document under `docs`, the full `src` implementation inventory, and the complete test inventory. Recent commits through PR #32 and current issue/PR state were also inspected; there were no pre-existing open repository-development blockers relevant to this increment.

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

Also inspected the implementation and regression paths most relevant to the increment: `src/control-plane.ts`, `src/sqlite-store.ts`, `tests/decision-idempotency-concurrency.test.ts`, and `tests/sqlite-call-reservation-concurrency.test.ts`. `package.json` was rechecked at the end to confirm the repository's available verification scripts.

The inspection confirmed that PR #32 already performs replay-equivalence checks before returning an existing idempotency binding, and that creation re-checks the mapping inside the synchronous store transaction before provider I/O. The remaining gap was executable proof that this contract still holds when a conflicting payload arrives after the winning local reservation has committed but before its asynchronous provider `start()` has returned.

## Changes made this run

PR #33, `Prove SQLite idempotency winner under competing payloads`, added `tests/sqlite-idempotency-payload-race.test.ts`.

The new deterministic regressions cover both primary real-world side-effect surfaces:

1. **Owner callback race**
   - starts a callback request against SQLite;
   - deliberately gates the fake provider after the durable local reservation but before provider start completes;
   - submits a second callback with the same idempotency key but a different owner prompt;
   - proves the second request receives `IDEMPOTENCY_CONFLICT_MESSAGE`;
   - proves the original callback id remains the sole durable key binding;
   - proves the replayable provider task contains the winning prompt and not the losing prompt;
   - proves there is exactly one call attempt, one provider start, one `owner_callback_requested`, one `call_attempt_created`, and one `call_attempt_started` event.

2. **Owner-decision race**
   - starts a blocking decision request against SQLite and gates provider start in the same post-reservation window;
   - submits a different scope/question/context/blocking/priority payload under the same idempotency key;
   - proves the conflicting request is rejected without provider I/O;
   - proves the winning escalation remains the only escalation/call chain;
   - proves branch-scoped blocking remains attached only to the winning `production-release` scope;
   - proves exactly one escalation-created/call-created/call-started causal chain exists.

No production code changed. The existing `BEGIN IMMEDIATE` synchronous SQLite transaction plus the control plane's in-transaction idempotency re-check already establish the local winner before asynchronous phone-provider I/O begins. Adding another mutex/single-flight layer would duplicate an invariant already supplied by the supported single-process topology.

PR #33 was squash-merged into `main` as `63c766cb7c2f101d840e73274cb777091fa34b82`.

## Verification performed

Authoritative PR #33 verification ran against head `dd38abfa73ccb5c621233722e4d8e8699951b36d`:

- CI run `34505818032` — **success** on Node 24.20.0. Locked dependency installation succeeded; TypeScript typecheck succeeded; build succeeded; **173/173 tests passed**, 0 failures. Both new SQLite competing-payload race regressions passed.
- Container run `34505817822` — **success**. The production image and deterministic fake-provider runtime smoke path remained green.
- Compose deployment run `34505817951` — **success**. Every acceptance stage passed: scoped credential generation, Compose validation/boot/readiness, credential capability checks, compiled stdio MCP against the deployed control plane, durable branch-blocking decision creation, restart while the decision call remained active, branch-specific decision release, context-aware owner callback, restart while callback active, exactly-once callback steering, another restart after steering became durable, and safe-checkpoint instruction consumption.

`package.json` has no separate lint script and no standalone migration/schema-check command. `npm run check` covers typechecking, build, and the test suite; SQLite tests exercise schema and transaction durability; Container and Compose cover the production image/runtime/deployment paths.

No live CALL-E phone call was attempted or claimed.

## Architecture decisions made this run

1. In the supported single-process SQLite topology, the durable transaction is the idempotency winner-selection boundary. Provider/network I/O remains outside the transaction.
2. A same-key/different-payload loser must be side-effect free even when the winner's phone-provider request is currently in flight: no second call attempt, no second provider start, no mutation of the winner, and no competing audit chain.
3. Request-level idempotency and provider-level idempotency remain separate defenses. This test protects the local logical-request binding; CALL-E's provider idempotency key separately protects remote call creation/replay.
4. The callback's persisted replayable task is part of recovery truth and must continue representing only the winning logical callback request.
5. A losing decision payload must not change branch semantics. The winning blocking scope remains the only unresolved blocked scope while independent work can continue.
6. No additional async mutex was introduced because it would add complexity without strengthening the currently supported one-process SQLite topology. A future multi-instance/Postgres adapter must independently preserve equivalent uniqueness and atomic winner-selection guarantees.
7. The regressions deliberately overlap with asynchronous provider dispatch rather than merely issuing sequential mismatches, making the transaction-before-provider-I/O invariant executable and resistant to future refactors.

## CALL-E integration status

- **Fake provider:** deterministic, credential-free, idempotent, restart-rehydratable from durable accepted-call state, and still the primary full-flow development/acceptance provider. The new tests use a gated fake provider only to hold provider dispatch in flight while inspecting the already-committed SQLite binding.
- **Production CALL-E adapter:** implemented against the asynchronous Calls API with server-only `CALLE_API_KEY`, stable provider `Idempotency-Key`, structured result schemas, bounded create/poll requests, persisted correlation, polling/webhook convergence, duplicate prevention, restart-by-provider-id semantics, privacy-safe provider diagnostics, and fail-closed ambiguous/stalled handling.
- **Control-plane idempotency:** decision and callback keys are payload-bound, exact retries remain no-op replays, changed-payload reuse is rejected, and the SQLite race regressions now prove the durable first binding survives a conflicting request while provider dispatch is still active.
- **Public webhook configuration:** live runtime requires an exact HTTPS origin and constructs the tokenized webhook target structurally. Application request handling strips the capability token from `IncomingMessage.url` immediately after extraction. Reverse-proxy/CDN/APM query-string redaction remains mandatory because those layers may see the raw request first.
- **Shared surfaces:** HTTP, TypeScript SDK, stdio MCP, lifecycle worker, operator console, and deployment flows continue sharing one persistent control-plane state machine.
- **Claude Code:** compiled stdio MCP behavior remains covered by automated and Compose acceptance. A genuine Claude Code host session has still not been observed and is not claimed.
- **Live status:** no authorized real CALL-E phone call has been performed, so live provider connectivity, owner-phone authorization, and externally reachable webhook delivery remain unverified.

## Current blockers / external prerequisites

No repository-development blocker prevents further useful work.

A true Claude Code host acceptance requires an actual Claude Code environment/CLI to register and exercise the compiled stdio MCP server.

Live CALL-E verification still requires user-controlled prerequisites: a valid/authorized CALL-E credential, an authorized owner phone destination, and a stable externally reachable HTTPS origin whose ingress is configured not to log the webhook capability query string.

The current SQLite reference topology remains intentionally single-instance. This run does not claim that two independent control-plane processes sharing SQLite, or a future distributed store, inherit the same concurrency guarantee automatically.

## Highest-value next actions

1. Continue the HTTP input-validation audit, especially owner-decision `priority` and `expiresAt`, so malformed enum/date inputs receive stable privacy-safe 4xx responses before entering policy/lifecycle state transitions.
2. Review pure live-runtime environment validation ordering for settings that can still fail only after durable storage opens, and move safe validation earlier where doing so does not duplicate domain rules.
3. Continue least-privilege review of owner/operator/reconciler surfaces without widening browser or normal agent credentials.
4. Add distributed-store contract tests before introducing any Postgres/multi-instance deployment so the winner-selection/idempotency semantics proven here remain explicit rather than assumed.
5. Run the documented acceptance in a genuine Claude Code host when that external prerequisite is available and record only observed host/version behavior.
6. When the user-controlled CALL-E prerequisites are available, perform one tightly bounded live provider acceptance and record only observed behavior.
