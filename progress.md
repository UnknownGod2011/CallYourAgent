# progress.md

## Current status

CallYourAgent now has a durable Node 24 TypeScript control plane, SQLite persistence, fake and production CALL-E provider adapters, ambiguous-call recovery, polling/webhook convergence, an authenticated HTTP runtime, a typed TypeScript HTTP client, and a working stdio MCP adapter built on the official MCP TypeScript v2 SDK.

The core product semantics remain unchanged: an agent may ask its owner for an important decision without unnecessarily freezing unrelated work; the owner may independently request a callback to hear current agent state and steer the run; human answers/instructions become durable structured state consumed at safe checkpoints rather than being injected into an in-flight model generation.

## Inspected this run

- Full recursive repository tree before changes.
- `AGENTS.md` in full.
- `progress.md` in full.
- `README.md` in full.
- `docs/ARCHITECTURE.md` in full.
- `docs/INTEGRATIONS.md` in full.
- Recent commits on `main`.
- Open GitHub issues endpoint: none.
- Existing HTTP/control-plane/domain contracts needed by client/MCP adapters.
- Existing HTTP tests and package/CI configuration.
- Current official Model Context Protocol TypeScript v2 documentation and current 2026-07-28 protocol behavior.
- Current official MCP host instructions for Claude Code stdio registration.
- Current npm package versions for `@modelcontextprotocol/server`, `@modelcontextprotocol/client`, and Zod.
- GitHub Actions state after each code-bearing MCP increment.

## Previously implemented

- Typed agent/run/escalation/decision/instruction/call-attempt domain model.
- `ControlPlaneStore` abstraction and deterministic in-memory store.
- Durable Node `node:sqlite` store with transactional webhook reconciliation and SQL uniqueness guarantees.
- `CallProvider` abstraction plus deterministic fake provider.
- Production CALL-E Calls API adapter with server-side auth, idempotency keys, structured results, polling, and webhook URL support.
- Persisted ambiguous create-call recovery using the exact same provider idempotency key.
- Shared terminal transition path for polling and webhooks.
- CALL-E terminal webhook parser and provider-event deduplication.
- Authenticated HTTP control-plane API and environment-selectable fake/live provider + memory/SQLite store bootstrap.
- Application-owned CALL-E webhook capability token plus provider event-id consistency validation.
- End-to-end tests for non-blocking continuation, scoped blocking, callback steering, checkpoint consumption, idempotency, persistence, rollback, webhook races, and HTTP ingress.
- GitHub Actions Node 24 CI running `npm run check`.

## Implemented this run

### Typed TypeScript HTTP client

Added `src/client.ts` with `CallYourAgentClient`, a thin reusable client over the existing HTTP API. It now provides typed methods for:

- health;
- agent registration;
- run start/read/status reporting;
- checkpoint/pull-owner-instructions;
- owner-decision escalation creation/status/reconciliation;
- owner callback creation/read/reconciliation.

The client owns bearer auth, path encoding, JSON parsing, and typed `CallYourAgentHttpError` failures. It intentionally owns no business state so MCP, Claude, Codex, and custom adapters can share the exact same control-plane semantics.

Added `tests/client.test.ts`, which drives the client against the real local HTTP server instead of mocking REST responses. Coverage includes register -> run -> status -> non-blocking escalation -> checkpoint, owner callback creation/read, and typed unauthorized failures.

### Official MCP v2 stdio adapter

Added `src/mcp-server.ts` using current `@modelcontextprotocol/server` v2 and Zod v4 schemas. The adapter talks to CallYourAgent through `CallYourAgentClient`, so CALL-E credentials remain isolated to the backend.

Exposed MCP tools:

- `register_agent`
- `start_run`
- `report_status`
- `request_owner_decision`
- `get_escalation_status`
- `checkpoint`
- `request_owner_callback`
- `reconcile_escalation`
- `reconcile_callback`

Added `npm run start:mcp` plus `CYA_BASE_URL` configuration. The MCP adapter needs only `CYA_BASE_URL` and `CYA_API_TOKEN`; it does not receive `CALLE_API_KEY`.

The MCP implementation deliberately uses the official SDK instead of hand-rolling JSON-RPC lifecycle behavior. Current MCP v2 targets the 2026-07-28 stateless protocol while preserving SDK compatibility with legacy hosts.

### MCP integration verification

Added `@modelcontextprotocol/client` as a development harness and `tests/mcp-server.test.ts`.

The main test uses the official linked in-memory MCP transports and a real MCP client. A tool call therefore travels:

`MCP Client -> MCP server tool -> CallYourAgent typed HTTP client -> real authenticated HTTP server -> ControlPlane -> FakeCallProvider`

The test verifies tool discovery and runs the real register -> start -> non-blocking escalation -> checkpoint path through that stack. It also verifies backend/network failures are returned as MCP tool errors instead of crashing the MCP host.

This is substantially stronger than merely compiling the MCP tool definitions.

### Claude Code integration documentation

Updated `docs/INTEGRATIONS.md` with:

- typed SDK usage;
- MCP environment and launch instructions;
- current MCP tool list;
- Claude Code registration command (`claude mcp add callyouragent -- node dist/src/mcp-server.js`);
- checkpoint-based agent workflow;
- explicit statement that correctness does not depend on undocumented mid-token interruption.

The official current MCP host documentation confirms Claude Code supports registering a stdio MCP server using `claude mcp add <name> -- <command> ...` and exposes connected tools through `/mcp`.

### Package/configuration changes

- Added runtime dependency `@modelcontextprotocol/server` v2.
- Added runtime dependency Zod v4.
- Added development dependency `@modelcontextprotocol/client` v2 for protocol-level tests.
- Exported the typed HTTP client and MCP server factory from `src/index.ts`.
- Added `CYA_BASE_URL` to `.env.example`.

## Architecture decisions

1. MCP is an adapter over the typed HTTP client, which is itself an adapter over the existing `ControlPlane`; there is still only one business state machine.
2. The MCP process receives only control-plane credentials (`CYA_API_TOKEN`) and never receives the CALL-E API key.
3. Official MCP v2 libraries are used rather than implementing the protocol manually, avoiding lifecycle/version drift as MCP evolves.
4. Agent integrations use safe checkpoints. No integration claims to inject owner instructions into an in-flight model generation.
5. `request_owner_decision` explicitly carries scope and blocking semantics so models can continue unrelated work.
6. Tool descriptions tell the model when idempotency keys must remain stable on retries.
7. MCP tool failures are returned with `isError: true` and model-readable details rather than terminating the server process.

## Verification performed

- GitHub Actions run for commit `aab6ba4f221f2bf4ae4758c2a586b378598a4c4a` completed successfully; its `Typecheck and test` step passed with the MCP server compiled and the existing full suite green.
- The newer MCP protocol-integration test run for commit `f4cf6d8b65381f9f22522c85553e23cb766e5891` completed its `Typecheck and test` step successfully in GitHub Actions, including the new real MCP-client -> MCP-server -> HTTP-control-plane test.
- Dependency installation under Node 24 succeeded in CI with the official MCP v2 packages.
- Current official MCP documentation was checked before implementation: v2 is the stable SDK line for the 2026-07-28 spec, `serveStdio` is the supported stdio entry point, and Claude Code can launch stdio MCP servers.
- No live CALL-E call was attempted because this run has no authorized CALL-E credential/destination phone/public deployment.
- No actual Claude Code process was launched in this automation environment; the integration path is protocol-tested and documented, but host-level Claude Code acceptance remains to be exercised in a real Claude Code installation.

## CALL-E integration status

- Fake provider: implemented and tested.
- Production CALL-E HTTP provider: implemented.
- Server-only API key handling: implemented.
- Stable provider idempotency key propagation: implemented.
- Polling terminal reconciliation: implemented.
- Purpose-specific structured decision/callback results: implemented.
- Ambiguous create-call persistence and same-key recovery: implemented.
- Terminal webhook parser: implemented.
- Webhook event-id deduplication + shared terminal reconciliation: implemented.
- Durable webhook transaction boundary: implemented.
- Durable SQLite state across restart: implemented and tested.
- HTTP webhook receiver: implemented.
- Current provider event-id integrity validation: implemented.
- Application-owned webhook secret capability token: implemented.
- Environment-selectable live/fake provider: implemented.
- Typed HTTP agent SDK: implemented and integration-tested.
- MCP agent adapter: implemented and protocol-integration-tested.
- Claude Code launch/config path: documented; actual host attachment still requires a Claude Code environment.
- Live CALL-E call: not attempted because no credential/authorized phone/public HTTPS URL is available to this run.

## Current blockers

No blocker to continued repository development.

Live CALL-E verification requires a valid `CALLE_API_KEY`, an authorized owner destination phone number, and a publicly reachable HTTPS deployment URL. Actual Claude Code host acceptance requires a Claude Code installation/session capable of registering the local stdio process. These are external/runtime prerequisites and do not block further policy, lifecycle, deployment, or generic integration development.

## Highest-value next actions

1. Add an end-to-end Claude-style work-loop fixture that performs multiple independent work units, raises a branch-scoped decision, keeps another scope moving, and consumes owner steering on the next checkpoint. This should exercise the MCP tools as an agent would use them rather than only single calls.
2. Add quiet hours, per-run/per-owner call budgets, retry bounds, escalation expiry sweep behavior, and explicit call-policy decisions before broad UI work.
3. Add audit events for agent status changes, escalation/call transitions, owner decisions, and instruction consumption so the demo and production troubleshooting have one coherent timeline.
4. Add graceful shutdown and production deployment documentation; validate SQLite file persistence on the chosen host.
5. Add rate limiting / credential scoping before exposing the API beyond a trusted single-owner deployment.
6. Generate and commit a lockfile once dependency choices stabilize, then switch CI back to `npm ci`.
7. Exercise the documented `claude mcp add` path in a real Claude Code installation and record exact host-level results.
8. After the Claude path is proven, add thin Codex/OpenAI integration guidance only for capabilities that are actually supported at that time.
