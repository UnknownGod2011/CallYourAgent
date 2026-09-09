# CallYourAgent progress

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. Agents can escalate important decisions without freezing unrelated scopes; owners can independently request callbacks for progress/questions/steering; human input is persisted as structured state and consumed only at explicit safe checkpoints rather than pretending to interrupt in-flight model generation.

The repository currently includes deterministic fake and production CALL-E providers, SQLite persistence, replayable/idempotent call attempts, polling/webhook convergence, branch-scoped blocking, owner decision persistence, durable per-run instruction queues, exact instruction acknowledgement, call policy/quiet hours/budgets, bounded lifecycle recovery, fail-closed ambiguous/stalled handling, privacy-aware audit history, scoped HTTP authentication, a typed TypeScript client, a real stdio MCP adapter, deterministic end-to-end/demo flows, an operator console, a Claude Code real-host acceptance runbook, and a single-instance persistent-volume Compose reference deployment.

This run added a new external-process regression proving that the same long-lived stdio MCP session can observe an owner callback before and after a complete HTTP control-plane + SQLite-store + fake-provider reconstruction while the callback is still non-terminal, then consume the resulting steering only at a safe checkpoint after terminal reconciliation. The test also proves exactly-once callback call-attempt causality and privacy-safe audit behavior across that restart.

## Exact repo state inspected this run

The run started from `main` HEAD `8d623ac595779d5e2e3fff2b81e20a3a5291c1e3`.

Before making any change, inspected the complete recursive repository tree and current architecture, recent commits, repository issues, and pull requests. The recursive tree response was complete (`truncated: false`). There were no open issues and no pull requests.

Read in full before implementation:

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
- `deploy/README.md`

Also inspected the relevant current implementation/test/deployment surfaces, especially:

- `tests/mcp-stdio-deployment-acceptance.ts` — real built stdio MCP + deployed control-plane acceptance;
- `.github/workflows/compose.yml` — scoped Docker/SQLite decision and callback restart acceptance;
- `tests/mcp-stdio-call-audit-restart.test.ts` — long-lived MCP decision-call restart precedent;
- `tests/callback-call-audit-restart.test.ts` — callback call-attempt restart/audit precedent;
- `package.json` — available verification scripts and Node 24 requirement.

The automation container still cannot clone the public repository because DNS resolution for `github.com` fails, so repository mutation used the connected GitHub integration and executable verification used GitHub Actions. No unsupported local execution claim is made.

## Changes made this run

### Added long-lived stdio MCP callback restart acceptance

Initial implementation commit: `77a912f4843f3f8f41ed7908dc7ea9fe38887b3f` (`test: prove callback recovery through long-lived MCP session`).

Added `tests/mcp-stdio-callback-audit-restart.test.ts`. The regression:

1. starts SQLite + deterministic fake provider + the real HTTP control plane;
2. launches the compiled `dist/src/mcp-server.js` as a separate child using the official MCP stdio client;
3. registers an agent and starts a run through MCP with `documentation` active;
4. creates an owner-requested callback through the shared control-plane service, deliberately outside the agent/MCP authority path;
5. observes that same callback through MCP `get_callback_status` while it is still `queued`/`in_progress`;
6. verifies the running agent remains unblocked and has no steering before the callback is terminal;
7. closes the HTTP server/store and reconstructs SQLite, a new `FakeCallProvider`, `ControlPlane`, and HTTP server on the same address while keeping the same MCP child/client session alive;
8. observes the same durable callback through that unchanged MCP session after restart while it is still active;
9. reconciles the original callback after restart and retries reconciliation to prove idempotency;
10. observes the callback as `completed` through MCP;
11. pulls exactly one durable steering instruction at a safe checkpoint, acknowledges exactly that instruction id, retries acknowledgement idempotently, and proves the queue is then empty;
12. reads the audit timeline through MCP and proves one ordered callback chain: `call_attempt_created -> call_attempt_started -> owner_callback_requested -> call_attempt_completed -> owner_instruction_queued`, followed by exactly one `owner_instruction_consumed` for the resulting instruction;
13. proves provider rehydration does not fabricate another start, terminal retries do not duplicate completion/steering, successful recovery creates no ambiguous/failed transition, and audit metadata does not contain the callback prompt or steering text.

### Corrected the audit-correlation assertion exposed by CI

CI for the first implementation correctly failed 1 of 101 tests. The production behavior was not failing: the test incorrectly expected `owner_instruction_consumed` to carry the originating `callAttemptId`.

That event is intentionally instruction-correlated rather than phone-attempt-correlated. The callback-originated `owner_instruction_queued` event carries both `callAttemptId` and `instructionId`; later consumption is correlated by that durable `instructionId` because consumption is an agent checkpoint action, not a provider-call transition.

Fix commit: `a3a7accf41aad8345f147bfababd45734b5bd9fe` (`test: correlate callback consumption by instruction id`). The regression now follows the correct causal bridge: callback `callAttemptId` -> queued event `instructionId` -> consumed event with the same `instructionId`, while preserving exact sequence assertions.

No production contract was weakened to make the test pass.

## Verification performed

The corrected substantive state at commit `a3a7accf41aad8345f147bfababd45734b5bd9fe` passed every repository verification surface:

- CI run `34317843384` — **success**. Node 24.20.0, TypeScript typecheck, build, and **101/101 tests passed**, 0 failures. This includes the new long-lived stdio MCP callback restart regression.
- Container run `34317843387` — **success**. Production image/runtime smoke passed.
- Compose deployment run `34317843393` — **success**. The full Docker + SQLite + generated scoped-credential deployment passed. Its job completed the real stdio MCP verification, restart while an owner decision call was active, branch-specific decision release, owner callback creation, restart while that callback call was active, exactly-once restored callback reconciliation/steering, another restart after steering became durable, and safe-checkpoint exact acknowledgement.

The earlier first-test CI run `34317581279` failed **100/101** only because of the incorrect audit correlation described above. That failure was inspected through the exact GitHub Actions job log and fixed before this progress update. The first implementation's Container run `34317581342` had already passed, further confirming the failure was test-assertion-specific rather than a production-image regression.

`package.json` has no separate lint script and no standalone migration/schema-check command. The available `check` path covers typechecking, build, and tests; Container and Compose provide production runtime and deployment verification.

No live CALL-E phone call was attempted or claimed.

## Architecture decisions made this run

1. A long-lived agent integration must survive control-plane/provider process restart without restarting the MCP host merely to rediscover durable callback state.
2. `get_callback_status` remains a thin privacy-safe observation surface. It is sufficient for an agent host to observe an owner callback across restart without exposing the callback prompt, replayable phone task, provider metadata, transcript, or steering text.
3. Owner callback creation remains an owner/control-plane concern, not ordinary agent authority. The regression intentionally creates the callback outside MCP and only lets MCP observe it and later consume durable steering.
4. Fake-provider reconstruction must preserve the durable logical call identity and must not emit a second `call_attempt_started` event merely because provider process-local memory was rebuilt.
5. Audit causality crosses subsystem boundaries by stable durable references: callback provider transitions use `callAttemptId`; callback-produced steering records both `callAttemptId` and `instructionId`; later agent consumption is correctly correlated by `instructionId` rather than pretending a checkpoint action is itself a provider-call event.
6. Human steering remains queued until an explicit safe checkpoint. Neither callback completion nor MCP lifecycle observation is treated as mid-generation interruption.
7. Deterministic fake-provider evidence remains separate from live CALL-E evidence.

## CALL-E integration status

- **Fake provider:** deterministic, credential-free, restart-stable provider identities, provider-local rehydration for durable accepted calls, duplicate prevention, decision/callback restart recovery, and causal audit correlation. The new regression now proves callback rehydration is observable from the same external stdio MCP session across control-plane reconstruction.
- **Production CALL-E adapter:** implemented against the asynchronous Calls API with server-only `CALLE_API_KEY`, stable idempotency, structured result schemas, bounded create/poll requests, persisted correlation, polling/webhook convergence, duplicate prevention, fail-closed ambiguous/stalled handling, and privacy-safe provider error reporting.
- **Shared surfaces:** HTTP, TypeScript SDK, stdio MCP, lifecycle worker, and deployment workflows share the same persistent control-plane semantics rather than adapter-specific state machines.
- **Claude Code:** the built stdio MCP process is exercised as a real external child and now survives callback observation across backend restart; a concrete real-host acceptance procedure exists. An actual Claude Code host session still has not been observed and must not be claimed.
- **Live status:** no authorized real CALL-E phone call has been performed, so live provider/phone/webhook success remains unverified.

## Current blockers / external prerequisites

No repository-development blocker prevents further useful work.

A true Claude Code host acceptance still requires an actual Claude Code environment with the CLI/host available to register and exercise the built stdio MCP server.

Live CALL-E verification still requires user-controlled prerequisites: a valid/authorized CALL-E credential, an authorized owner phone destination, and stable public HTTPS webhook ingress configured with the application-owned webhook capability token.

## Highest-value next actions

1. Fold the new `get_callback_status` observations and exact callback `callAttemptId -> instructionId` causality directly into `tests/mcp-stdio-deployment-acceptance.ts`, so the full Docker/scoped-credential path itself keeps the same MCP session alive while the owner callback is non-terminal across restart and verifies the causal chain end-to-end.
2. Update `docs/CLAUDE_CODE_ACCEPTANCE.md` to explicitly include `get_callback_status` in required tool discovery and to observe the owner callback lifecycle before consuming steering, matching the now-tested adapter behavior.
3. Document fake-provider `rehydrate` behavior more explicitly in `docs/ARCHITECTURE.md`, separating deterministic local provider-process reconstruction from production CALL-E's remotely durable provider call identity.
4. Continue auditing model-/operator-facing diagnostics and read views for accidental task-context, owner-phone, bearer-token, webhook-token, callback-prompt, or instruction disclosure.
5. Run the Claude Code acceptance procedure in a genuine Claude Code host when that external prerequisite is available and record only observed results/version details.
6. When the user-controlled CALL-E prerequisites are available, perform one tightly bounded live provider acceptance and record only observed behavior.
