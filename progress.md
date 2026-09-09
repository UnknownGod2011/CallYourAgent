# CallYourAgent progress

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. Agents can escalate important decisions without freezing unrelated scopes; owners can independently request callbacks for progress/questions/steering; human input is persisted as structured state and consumed only at explicit safe checkpoints rather than pretending to interrupt in-flight model generation.

The repository includes deterministic fake and production CALL-E providers, SQLite persistence, replayable/idempotent call attempts, polling/webhook convergence, branch-scoped blocking, owner decision persistence, durable per-run instruction queues, exact instruction acknowledgement, quiet hours/call budgets, bounded lifecycle recovery, fail-closed ambiguous/stalled handling, privacy-aware audit history, scoped HTTP authentication, a typed TypeScript client, a real stdio MCP adapter, deterministic end-to-end/demo flows, an operator console, a Claude Code host-acceptance runbook, and a single-instance persistent-volume Compose reference deployment.

This run strengthened the full Docker + SQLite + generated scoped-credential + real stdio MCP deployment acceptance so an owner callback is now observed through the same long-lived MCP session before a control-plane restart, observed again while still non-terminal after restart, reconciled exactly once into durable steering, observed as completed through MCP, and correlated through the audit timeline from the exact callback call attempt to the exact instruction later consumed at a safe checkpoint.

## Exact repo state inspected this run

The run started from `main` HEAD `3676f2e0a95ceee10aa4bbc4529e9dca17a2b4f3`.

Before any change, inspected the complete recursive repository tree and current architecture. The recursive Git tree response was complete (`truncated: false`). Inspected recent commits and searched repository issues and pull requests; there were no issues and no PRs.

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

Also inspected the relevant implementation and verification surfaces, especially `tests/mcp-stdio-deployment-acceptance.ts`, `src/control-plane.ts`, `src/call-provider.ts`, and `package.json`.

The automation container still could not clone the repository because DNS resolution for `github.com` failed, so repository mutation used the connected GitHub integration and executable verification used GitHub Actions. No unsupported local-execution claim is made.

## Changes made this run

### Full deployment callback restart + causal acceptance

Implementation commit: `1f93b180b3b76e93f7628821fd638c64e45657b3` (`test: prove callback restart causality in compose MCP acceptance`).

Updated `tests/mcp-stdio-deployment-acceptance.ts` so the strongest deployed acceptance now:

1. requires discovery of the privacy-safe `get_callback_status` MCP tool;
2. creates the owner callback using the separate owner credential, not agent authority;
3. observes that callback as `queued`/`in_progress` through the existing long-lived stdio MCP session;
4. restarts the Docker control plane while the callback is still non-terminal;
5. keeps the same MCP child/client alive and observes the same callback id as non-terminal after readiness returns;
6. proves no owner steering is visible at a checkpoint before terminal callback evidence exists;
7. reconciles the restored callback with the separately scoped reconciler credential and deliberately retries reconciliation;
8. observes the same callback as `completed` through MCP;
9. performs the existing post-callback restart and then receives exactly one durable steering item at an explicit safe checkpoint;
10. acknowledges exactly that instruction id and retries acknowledgement idempotently;
11. proves one ordered callback audit chain: `call_attempt_created -> call_attempt_started -> owner_callback_requested -> call_attempt_completed -> owner_instruction_queued`;
12. bridges that phone interaction to safe-checkpoint consumption using the queued event's durable `instructionId`, then proves exactly one `owner_instruction_consumed` event for that same id;
13. proves successful restart/reconciliation creates no duplicate provider-start/completion/steering state and no fabricated ambiguous/failed transition.

The earlier decision-path restart assertions remain intact, including branch-specific blocking where `documentation` can continue while `release-approval` alone waits for owner judgment.

### Claude Code host runbook aligned with tested behavior

Documentation commit: `d678923ace34ee2bbb898360a470fc18aca2316c` (`docs: require callback lifecycle observation in Claude acceptance`).

Updated `docs/CLAUDE_CODE_ACCEPTANCE.md` so a future genuine Claude Code host acceptance must discover `get_callback_status`, observe an owner callback before terminal reconciliation, optionally prove the same callback remains visible through the same host session across control-plane restart, observe completion after idempotent reconciliation, consume steering only at a safe checkpoint, and verify the same `callAttemptId -> instructionId` causal chain in audit output.

The runbook continues to keep owner callback creation and provider reconciliation outside the normal agent credential and does not claim that a real Claude Code host has already been exercised.

## Verification performed

The substantive implementation at `1f93b180b3b76e93f7628821fd638c64e45657b3` passed every repository verification surface:

- CI run `34322203099` — **success**. Node `24.20.0`; `npm run check` completed TypeScript typecheck, build, and **101/101 tests passed**, 0 failures.
- Container run `34322203271` — **success**. Production image build and fake-provider runtime smoke passed.
- Compose deployment run `34322203102` — **success**. Generated least-privilege credentials, Compose validation, fake-provider deployment, real stdio MCP verification, restart while the owner-decision call was active, branch-specific release, owner callback creation, **restart while the owner callback was active**, exactly-once restored callback reconciliation/steering, another restart after steering was durable, and safe-checkpoint exact acknowledgement all passed.

The follow-up documentation commit `d678923ace34ee2bbb898360a470fc18aca2316c` also triggered the normal workflows; the observed CI and Container runs completed successfully, with the remaining workflow status checked before this progress update where available.

`package.json` has no separate lint script and no standalone migration/schema-check command. The available `check` path covers typechecking, build, and tests; Container and Compose provide the production runtime/deployment checks.

No live CALL-E phone call was attempted or claimed.

## Architecture decisions made this run

1. Owner callbacks are first-class durable interactions that a long-lived agent host must be able to observe across backend restart without requesting a replacement call or restarting the MCP host.
2. `get_callback_status` remains observation-only and privacy-safe; it exposes lifecycle state, not callback prompt/task contents, provider recovery material, transcripts, or owner steering text.
3. Callback creation remains owner authority and reconciliation remains trusted backend authority; the agent may observe lifecycle and later consume durable steering but cannot widen itself into those real-world side-effect roles.
4. Terminal callback evidence must exist before steering becomes visible to the agent. A backend restart while the callback is active cannot create premature queued instructions.
5. Callback call causality is correlated by `callAttemptId` through provider transitions; the transition into agent work is explicitly bridged by the queued event's `instructionId`; later consumption is correlated by `instructionId`, because a safe checkpoint is not a phone-provider transition.
6. Reconciliation retries and acknowledgement retries must be idempotent and are now asserted in the full deployment path rather than only lower-level tests.
7. Human steering remains queued until an explicit safe checkpoint; no integration path pretends to inject instructions into in-flight token generation.
8. Deterministic fake-provider evidence remains separate from live CALL-E evidence.

## CALL-E integration status

- **Fake provider:** deterministic, credential-free, restart-stable provider identity, process-local rehydration from durable accepted-call state, duplicate prevention, decision/callback restart recovery, and exact causal audit correlation. The full Compose + scoped-auth + external stdio MCP path now exercises the active callback restart behavior directly.
- **Production CALL-E adapter:** implemented against the asynchronous Calls API with server-only `CALLE_API_KEY`, stable idempotency, structured result schemas, bounded create/poll requests, persisted correlation, polling/webhook convergence, duplicate prevention, fail-closed ambiguous/stalled handling, and privacy-safe provider errors.
- **Shared surfaces:** HTTP, TypeScript SDK, stdio MCP, lifecycle worker, and deployment verification share the same persistent control-plane semantics rather than adapter-specific state machines.
- **Claude Code:** the built stdio MCP process is exercised as a real external child and the host runbook now matches the tested callback lifecycle. An actual Claude Code host session still has not been observed and must not be claimed.
- **Live status:** no authorized real CALL-E phone call has been performed, so live provider/phone/webhook success remains unverified.

## Current blockers / external prerequisites

No repository-development blocker prevents further useful work.

A true Claude Code host acceptance requires an actual Claude Code environment/CLI to register and exercise the built stdio MCP server.

Live CALL-E verification still requires user-controlled prerequisites: a valid/authorized CALL-E credential, an authorized owner phone destination, and stable public HTTPS webhook ingress configured with the application-owned webhook capability token.

## Highest-value next actions

1. Fix the remaining callback idempotency concurrency window in `ControlPlane.requestOwnerCallback`: the current idempotency map is populated only after the awaited provider-start path returns, so two concurrent requests with the same logical key can race into separate local `CallAttempt`/audit records even though provider-side idempotency protects the physical call. Reserve/persist the logical callback identity before the external await and add a deterministic concurrent-request regression.
2. Re-audit `requestOwnerDecision` and any other async side-effect creation paths for the same check-then-await race class, preserving SQLite uniqueness/transaction semantics rather than relying only on provider idempotency.
3. Document fake-provider `rehydrate` behavior more explicitly in `docs/ARCHITECTURE.md`, separating deterministic process-local reconstruction from production CALL-E's remotely durable provider call identity.
4. Continue auditing model-/operator-facing diagnostics and read projections for accidental task-context, owner-phone, bearer-token, webhook-token, callback-prompt, or instruction disclosure.
5. Run the documented acceptance in a genuine Claude Code host when that external prerequisite is available and record only observed host/version behavior.
6. When the user-controlled CALL-E prerequisites are available, perform one tightly bounded live provider acceptance and record only observed behavior.
