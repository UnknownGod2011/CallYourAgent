# CallYourAgent progress

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. Agents can escalate important decisions without freezing unrelated scopes; owners can independently request callbacks for progress/questions/steering; human input is persisted as structured state and consumed only at explicit safe checkpoints rather than pretending to interrupt in-flight model generation.

The repository currently includes deterministic fake and production CALL-E providers, SQLite persistence, replayable/idempotent call attempts, polling/webhook convergence, branch-scoped blocking, owner decision persistence, durable per-run instruction queues, exact instruction acknowledgement, call policy/quiet hours/budgets, bounded lifecycle recovery, fail-closed ambiguous/stalled handling, privacy-aware audit history, scoped HTTP authentication, a typed TypeScript client, a real stdio MCP adapter, deterministic end-to-end/demo flows, an operator console, a Claude Code real-host acceptance runbook, and a single-instance persistent-volume Compose reference deployment.

This run closed a practical MCP observability gap: an MCP host could already request an owner callback, but it had no thin MCP-native read surface for that callback's lifecycle. The stdio MCP adapter now exposes `get_callback_status`, delegating to the existing typed client and privacy-safe authenticated HTTP callback view. A regression proves the MCP -> typed client -> HTTP control-plane path returns active callback lifecycle state while withholding callback prompt/task/provider metadata.

## Exact repo state inspected this run

The run started from `main` HEAD `d97befeebb5157c940af7ebbb200b21298331a5b`.

Before making any change, inspected the complete recursive repository tree and current architecture, recent commits, repository issues, and pull requests. There were no open issues or pull requests.

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

Also inspected relevant implementation, test, and deployment surfaces, especially:

- `src/client.ts`, including the existing typed `getCallback` HTTP client contract;
- `src/mcp-server.ts`, including current MCP tool/authorization boundaries and model-facing error redaction;
- `src/http-server.ts`, including the `GET /v1/callbacks/:id` privacy-safe `agent:read` route;
- `tests/mcp-server.test.ts`;
- `tests/mcp-stdio-deployment-acceptance.ts`;
- `tests/callback-call-audit-restart.test.ts`;
- `.github/workflows/compose.yml`, including its active decision and active callback restart paths;
- the full current test-file inventory and recent callback audit/restart commits.

The local automation container still could not clone the public repository because outbound DNS/network access to github.com was unavailable. Repository reads/writes therefore used the connected GitHub integration and executable verification used the repository's GitHub Actions workflows. No unsupported local execution claim is made.

## Changes made this run

### Added privacy-safe callback lifecycle observation to MCP

Implemented in commit `61bea843f7efb1154d401aa6e179ed5f49d91fd1` (`feat: expose callback lifecycle status over MCP`).

`src/mcp-server.ts` now registers `get_callback_status` with a single durable `callbackId` input. The tool delegates to `CallYourAgentClient.getCallback`, so it reuses the existing authenticated `GET /v1/callbacks/:id` contract rather than introducing an MCP-specific state machine or provider lookup.

The tool is deliberately observational. With an `agent:read` credential it exposes the existing `OwnerCallbackView` lifecycle data but does not expose callback prompt text, raw phone task contents, CALL-E/provider metadata, transcripts, or queued owner instruction text.

### Added MCP -> HTTP callback lifecycle regression

Implemented in commit `ce6732f3e06b483b466bf6a17457e6a4c3427883` (`test: cover callback status MCP tool`).

Extended `tests/mcp-server.test.ts` so the official MCP client connected to the CallYourAgent MCP server over the in-memory MCP transport and real HTTP control-plane boundary now:

1. discovers `get_callback_status`;
2. registers/starts a run;
3. creates an owner callback through the MCP adapter;
4. reads that callback back through `get_callback_status`;
5. requires the callback to remain in a legitimate active `queued`/`in_progress` state before reconciliation;
6. verifies the MCP-returned lifecycle view contains no `prompt`, `task`, or `metadata` properties.

Existing MCP upstream-error redaction coverage remains intact.

### Documented the new shared integration surface

Implemented in commit `1d3310dd746da57fafd304ca57191294ecf2815e` (`docs: document callback lifecycle MCP surface`).

`docs/INTEGRATIONS.md` now lists and explains `get_callback_status`, including its `agent:read` authorization boundary, privacy guarantees, Claude/Claude Code callback-observation role, and compatibility with the same checkpoint/acknowledgement steering semantics used by Codex and generic agents.

## Verification performed

The substantive code/test state at commit `ce6732f3e06b483b466bf6a17457e6a4c3427883` passed every repository verification surface:

- CI run `34313057537` — **success**. The standard Node 24 CI workflow completed successfully, covering locked dependency install, TypeScript typecheck, build, and the full test suite including the extended MCP callback-status regression.
- Container run `34313057517` — **success**. Production image build and deterministic fake-provider runtime smoke passed.
- Compose deployment run `34313057510` — **success**. The complete Docker + SQLite + generated scoped-credential deployment acceptance passed, including the real built stdio MCP process and the existing active decision/callback restart recovery, branch-specific release, durable steering, safe-checkpoint consumption, and exact acknowledgement paths.

`package.json` still has no separate lint script and no standalone migration/schema-check command. The available CI `check` path covers TypeScript typechecking, build, and tests; Container and Compose cover production-runtime/deployment verification.

No live CALL-E phone call was attempted or claimed.

## Architecture decisions made this run

1. Callback lifecycle observation is a read concern distinct from callback creation or provider reconciliation. An agent/MCP host may need to know whether a requested callback is still active or terminal without acquiring `owner:callback` or `calls:reconcile` authority.
2. MCP remains a thin integration layer. `get_callback_status` reuses `CallYourAgentClient.getCallback` and the existing HTTP authorization/view contract rather than adding adapter-owned state.
3. `agent:read` is sufficient for privacy-safe callback lifecycle observation; adding the tool does not broaden owner or reconciler privileges.
4. Callback lifecycle views must remain content-minimized. Prompt text, call-task contents, provider metadata, transcripts, and steering text do not belong in this observation surface.
5. Lifecycle observation does not alter safe-checkpoint semantics: callback-derived steering still becomes durable queued state and is incorporated/acknowledged only at a later explicit agent work boundary.
6. Deterministic fake-provider and deployment evidence remains distinct from live CALL-E evidence.

## CALL-E integration status

- **Fake provider:** deterministic, credential-free, restart-stable provider identities, provider-local rehydration for durable accepted `queued`/`in_progress` calls, optional observation-driven completion, duplicate prevention, decision/callback restart recovery, and causal audit correlation.
- **Production CALL-E adapter:** implemented against the asynchronous Calls API with server-only `CALLE_API_KEY`, stable idempotency, structured result schemas, bounded create/poll requests, persisted correlation, polling/webhook convergence, duplicate prevention, fail-closed ambiguous/stalled handling, and privacy-safe provider error reporting.
- **Shared surfaces:** HTTP, TypeScript SDK, stdio MCP, lifecycle worker, and deployment workflows share the same persistent `ControlPlane` semantics rather than adapter-specific state machines. MCP now supports both escalation lifecycle observation and callback lifecycle observation.
- **Claude Code:** a concrete real-host acceptance procedure exists and the built stdio MCP process is exercised automatically, but an actual Claude Code host run has not yet been observed and must not be claimed.
- **Live status:** no authorized real CALL-E phone call has been performed, so live provider success remains unverified.

## Current blockers / external prerequisites

No repository-development blocker prevents further useful work.

A true Claude Code host acceptance still requires an actual Claude Code environment with the CLI/host available to register and exercise the built stdio MCP server.

Live CALL-E verification still requires user-controlled prerequisites: a valid/authorized CALL-E credential, an authorized owner phone destination, and stable public HTTPS webhook ingress configured with the application-owned webhook capability token.

## Highest-value next actions

1. Extend `tests/mcp-stdio-deployment-acceptance.ts` to include `get_callback_status`, create the callback through the separately scoped owner HTTP credential, and observe the same callback from the long-lived external stdio MCP agent session before and after a control-plane restart while the call is still non-terminal.
2. In that same deployment acceptance, reconcile the restored original callback only after restart and correlate exactly one `call_attempt_created -> call_attempt_started -> owner_callback_requested -> call_attempt_completed -> owner_instruction_queued` chain by durable `callAttemptId`, then prove the same MCP session receives and acknowledges the resulting steering at a safe checkpoint.
3. Document fake-provider `rehydrate` behavior more explicitly in `docs/ARCHITECTURE.md`, separating deterministic local provider-process reconstruction from production CALL-E's remotely durable call identity.
4. Continue auditing model-/operator-facing diagnostics and read views for accidental task-context, owner-phone, bearer-token, webhook-token, callback-prompt, or instruction disclosure.
5. Run `docs/CLAUDE_CODE_ACCEPTANCE.md` in a genuine Claude Code host when that external prerequisite is available and record only observed results/version details.
6. When the user-controlled CALL-E prerequisites are available, perform one tightly bounded live provider acceptance and record only observed behavior.
