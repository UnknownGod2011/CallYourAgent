# CallYourAgent progress

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. Agents can escalate important decisions without freezing unrelated scopes; owners can independently request callbacks for progress/questions/steering; human input is persisted as structured state and consumed only at explicit safe checkpoints rather than pretending to interrupt in-flight model generation.

The repository currently includes deterministic fake and production CALL-E providers, SQLite persistence, replayable/idempotent call attempts, polling/webhook convergence, branch-scoped blocking, owner decision persistence, durable per-run instruction queues, exact instruction acknowledgement, call policy/quiet hours/budgets, bounded lifecycle recovery, fail-closed ambiguous/stalled handling, privacy-aware audit history, scoped HTTP authentication, a typed TypeScript client, a real stdio MCP adapter, deterministic end-to-end/demo flows, an operator console, and a single-instance persistent-volume Compose reference deployment.

This run hardened the MCP host boundary and made real Claude Code host verification reproducible. MCP tool failures no longer forward arbitrary upstream HTTP error bodies or raw unexpected exception messages to Claude/Codex/model hosts; HTTP failures expose only a generic CallYourAgent message plus status code. A regression deliberately places bearer-token, phone, webhook-token, and owner-instruction-like secrets in an upstream HTTP error payload and proves none reach the MCP tool result. The repository now also contains `docs/CLAUDE_CODE_ACCEPTANCE.md`, a concrete least-privilege real-host runbook defining the exact MCP tool sequence, branch-safe decision semantics, callback/checkpoint flow, negative authorization checks, pass/fail criteria, and the limits of what such a host acceptance proves.

## Exact repo state inspected this run

The run started from `main` HEAD `714323d1bce892868b2422bce25532a8b82b17d7`.

Before making any change, inspected the complete recursive repository tree and current architecture, recent commits, repository issues, and pull requests. There were no open issues or pull requests.

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

Also inspected the relevant implementation/test surfaces, especially:

- `src/mcp-server.ts`, including the stdio adapter's tool-result/error projection;
- `src/client.ts`, including `CallYourAgentHttpError` and the fact that the typed HTTP client intentionally retains parsed response bodies for trusted programmatic callers;
- `tests/mcp-server.test.ts`;
- `tests/mcp-scope-boundary.test.ts`;
- the existing stdio MCP restart/deployment acceptance surfaces and recent commits covering exact call-attempt correlation.

The automation runtime still could not execute a local Git clone/network checkout, so repository reads/writes used the connected GitHub integration and executable verification used the repository's own GitHub Actions workflows. No unsupported local execution claim is made.

## Changes made this run

### 1. Redacted MCP upstream error payloads

Implemented across commits `523849358467ceb9e4ef4cb9c459b8b2ff656783` (`fix: redact MCP upstream error payloads`) and `a3c69b6379ff57eb7eecf884aaef13bef6c0016a` (`test: prove MCP errors redact upstream bodies`).

`src/mcp-server.ts` no longer emits `CallYourAgentHttpError.body` into MCP tool errors. It also no longer forwards arbitrary raw unexpected exception messages to the model host.

The host-visible error contract is now deliberately narrow:

- HTTP failure: `{ message: "CallYourAgent request failed with HTTP <status>", status: <status> }`;
- unexpected adapter failure: `{ message: "CallYourAgent request failed" }`.

This keeps detailed HTTP response bodies available inside the typed HTTP client for trusted application code while preventing a downstream MCP host/model from receiving arbitrary server/provider error payloads.

Added a focused regression in `tests/mcp-server.test.ts` that creates an upstream 403 payload containing representative bearer-token, owner-phone, webhook-capability, and owner-instruction-like secrets. The test requires the MCP result to contain only the generic HTTP failure/status and verifies none of the supplied secret values appear in serialized tool output.

### 2. Preserved scoped authorization tests under the redacted boundary

The first CI execution exposed one stale test expectation in `tests/mcp-scope-boundary.test.ts`: that test correctly expected an owner-scoped MCP client to receive HTTP 403 for the decision-consumption tool, but it additionally expected the internal HTTP response body `{ error: "forbidden", requiredScope: "decision:read" }` to be forwarded through MCP.

That expectation conflicted with the new privacy boundary, while the underlying authorization behavior remained correct.

Implemented commit `9fa856cf34a8cf1ff1fa2cadb1d77481940d4e1a` (`test: align MCP scope errors with redacted boundary`). The test now requires the same 403 authorization failure but asserts the host receives only the generic HTTP error/status and explicitly verifies `requiredScope` / `decision:read` response-body detail is not exposed through MCP. The agent credential still successfully consumes the owner decision, so least-privilege semantics are unchanged.

### 3. Added a real Claude Code host acceptance runbook

Added `docs/CLAUDE_CODE_ACCEPTANCE.md` in commit `996de873eee8ddb594497b9b6ce49861df915460` (`docs: add Claude Code host acceptance runbook`).

The runbook defines a reproducible external-host acceptance without claiming it has already run inside Claude Code. It requires:

1. Node 24+, a built repository, and a durable fake-provider control plane;
2. only the standard least-privilege `agent` bearer token in the Claude Code/MCP environment;
3. registration with `claude mcp add callyouragent -- node dist/src/mcp-server.js`;
4. real MCP tool discovery;
5. agent registration/run creation;
6. a blocking `release-approval` decision while unrelated `documentation` work continues;
7. decision completion through the separately privileged reconciler path;
8. owner callback creation through the separate owner credential;
9. durable steering consumption only through `checkpoint(consume=false)` followed by exact instruction acknowledgement;
10. negative checks proving the normal agent credential cannot perform owner-callback or provider-reconciliation operations;
11. audit inspection and explicit MCP error-redaction expectations;
12. a ten-item pass/fail definition plus explicit exclusions (no mid-token interruption claim, no live CALL-E claim, no distributed-safety claim).

## Verification performed

The first complete CI run after the MCP redaction change exposed one stale assertion rather than a production/state-machine regression:

- CI run `34301595931` — **failure** with 98/99 tests passing. Typecheck and build succeeded. The new secret-redaction regression passed. The only failing test was `scoped MCP clients separate lifecycle observation from owner decision consumption`, because it still expected the forbidden HTTP response body to appear in MCP output.
- The stale expectation was corrected in commit `9fa856cf34a8cf1ff1fa2cadb1d77481940d4e1a` without widening permissions or reintroducing response-body exposure.

The final substantive state at commit `9fa856cf34a8cf1ff1fa2cadb1d77481940d4e1a` passed every repository verification surface:

- CI run `34301714949` / `check` job — **success**. Locked dependency install, TypeScript typecheck, build, and all **99/99 tests** passed.
- Container run `34301715018` / `build-container` job — **success**. Production image build and deterministic fake-provider runtime smoke passed.
- Compose deployment run `34301714957` / `compose-smoke` job — **success**. The complete Docker/SQLite/scoped-credential path passed, including generated credential capabilities, the real built stdio MCP child, active owner-decision restart recovery, branch-specific release, owner callback restart recovery, exactly-once queued steering, another SQLite restart, safe checkpoint consumption, and exact acknowledgement.

`package.json` still has no separate lint script and no standalone migration/schema-check command. The available `npm run check` path covers TypeScript typechecking, build, and tests; Container and Compose cover production-runtime/deployment verification.

No live CALL-E phone call was attempted or claimed.

## Architecture decisions made this run

1. The typed HTTP client may retain parsed error bodies for trusted programmatic callers, but the MCP adapter is a separate model-facing trust boundary and must not automatically project those bodies into tool output.
2. A host/model generally needs to know that an operation failed and, for HTTP errors, the status code; it does not need arbitrary server/provider response bodies, owner phone data, webhook data, instruction text, or detailed internal authorization metadata.
3. Unexpected MCP adapter exceptions are also rendered generically rather than forwarding arbitrary exception strings that could contain transport/runtime secrets.
4. HTTP authorization remains the source of truth. Redacting `requiredScope` from MCP output does not widen or weaken the actual 403 enforcement.
5. Claude Code host compatibility should be judged by an explicit external-host checklist over the already-tested stdio adapter, not inferred merely from official MCP-client tests.
6. The Claude Code/MCP process should receive only the agent credential. Owner callback and provider reconciliation remain separate capabilities even if those MCP tools are discoverable.
7. Host acceptance must prove safe-checkpoint semantics rather than pretending Claude Code can interrupt an in-flight model/token generation.
8. Fake-provider/Claude-host success is not evidence of live CALL-E success.

## CALL-E integration status

- **Fake provider:** deterministic, credential-free, restart-stable provider identities, provider-local rehydration for durable accepted `queued`/`in_progress` calls, optional observation-driven completion, duplicate prevention, exact call-attempt audit-chain coverage, and deployment-tested decision/callback recovery across SQLite/control-plane restart.
- **Production CALL-E adapter:** implemented against the asynchronous Calls API with server-only `CALLE_API_KEY`, stable idempotency, structured result schemas, bounded create/poll requests, persisted metadata/correlation, polling/webhook convergence, duplicate prevention, fail-closed ambiguous/stalled handling, and privacy-safe non-2xx provider error reporting.
- **Shared surfaces:** HTTP, TypeScript SDK, stdio MCP, lifecycle worker, and deployment workflows share the same persistent `ControlPlane` semantics rather than adapter-specific state machines.
- **MCP host boundary:** now redacts arbitrary upstream HTTP bodies and unexpected exception detail before tool errors reach Claude/Codex/model hosts.
- **Claude Code:** a concrete real-host acceptance procedure now exists, but an actual Claude Code host run has not yet been observed and must not be claimed.
- **Live status:** no authorized real CALL-E phone call has been performed, so live provider success remains unverified.

## Current blockers / external prerequisites

No repository-development blocker prevents further useful work.

A true Claude Code host acceptance still requires an actual Claude Code environment with the CLI/host available to register and exercise the built stdio MCP server. The repository now defines exactly what that session must prove and what credentials it may receive.

Live CALL-E verification still requires user-controlled prerequisites: a valid/authorized CALL-E credential, an authorized owner phone destination, and stable public HTTPS webhook ingress configured with the application-owned webhook capability token.

## Highest-value next actions

1. Add exact callback `callAttemptId` `created -> started -> completed` correlation to the full Compose path, complementing the already-proven decision-call chain and keeping callback provider completion distinct from later instruction consumption.
2. Document fake-provider `rehydrate` behavior more explicitly in `docs/ARCHITECTURE.md`, clearly separating deterministic local provider reconstruction from production CALL-E's remote durable call identity.
3. Continue auditing model-/operator-facing diagnostics for accidental task-context, owner-phone, bearer-token, webhook-token, or instruction disclosure, now that MCP HTTP error bodies are explicitly redacted.
4. Run `docs/CLAUDE_CODE_ACCEPTANCE.md` in a genuine Claude Code host when that external prerequisite is available and record only observed results/version details.
5. When the user-controlled CALL-E prerequisites are available, perform one tightly bounded live provider acceptance and record only observed behavior.
