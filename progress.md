# progress.md

## Current status

CallYourAgent now has a durable Node 24 TypeScript control plane, SQLite persistence, deterministic fake and production CALL-E provider adapters, ambiguous-call recovery, polling/webhook convergence, an authenticated HTTP runtime, a typed TypeScript HTTP client, and a working stdio MCP adapter built on the official MCP TypeScript v2 SDK.

The core product semantics remain unchanged: an agent may call its owner for an important decision without unnecessarily freezing unrelated work; the owner may independently request a callback to hear current agent state and steer the run; human answers/instructions become durable structured state consumed at safe checkpoints rather than being injected into an in-flight model generation.

A protocol-level Claude-style work-loop fixture now proves the complete core story through MCP: a branch-scoped decision blocks only that scope, another scope continues and reports progress, the owner decision later resolves the blocked scope, an owner-requested callback captures steering instructions, and those instructions remain queued until the agent deliberately consumes them at a safe checkpoint.

## Inspected this run

Before changing code, inspected:

- full recursive repository tree on `main`;
- `AGENTS.md` in full;
- `progress.md` in full;
- `README.md` in full;
- `docs/ARCHITECTURE.md` in full;
- `docs/INTEGRATIONS.md` in full;
- recent commits on `main`;
- open GitHub issues endpoint: none;
- current MCP integration test;
- fake call-provider behavior;
- domain outcome/instruction types;
- HTTP routes used by MCP/client adapters;
- MCP tool schemas and reconciliation contracts;
- checkpoint implementation semantics;
- package scripts and GitHub Actions CI path.

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
- End-to-end domain tests for non-blocking continuation, scoped blocking, callback steering, checkpoint consumption, idempotency, persistence, rollback, webhook races, and HTTP ingress.
- GitHub Actions Node 24 CI running `npm run check`.
- Typed `CallYourAgentClient` over the authenticated HTTP API.
- Official MCP v2 stdio adapter exposing registration, run/status, escalation, checkpoint, callback, and reconciliation tools.
- Protocol-level MCP client -> MCP server -> HTTP server -> ControlPlane -> FakeCallProvider integration test.
- Claude Code stdio MCP launch/configuration documentation.

## Implemented this run

### Full Claude-style MCP work-loop fixture

Added `tests/mcp-work-loop.test.ts` to exercise the product the way a long-running Claude-style agent should actually use it rather than testing isolated tools.

The fixture drives the official MCP client through the real CallYourAgent MCP adapter, authenticated HTTP server, control plane, and deterministic fake phone provider. It proves this sequence:

1. register a Claude-style agent and start a run with parallel work;
2. raise a **blocking** owner decision scoped only to `checkout-provider`;
3. verify the checkpoint exposes only that unresolved blocking scope;
4. switch to an independent `documentation` scope and successfully report completed unrelated work while the phone decision is still pending;
5. complete the fake owner-decision call with structured output and reconcile it through the MCP tool;
6. verify the escalation becomes `resolved`, the decision is readable, and no blocking scopes remain;
7. resume the previously blocked checkout work and publish current state;
8. request an owner-initiated callback through MCP;
9. complete the callback with two steering instructions;
10. reconcile the callback and verify both instructions appear durably as `queued` at a non-consuming checkpoint;
11. consume them deliberately at a safe checkpoint;
12. verify a later checkpoint has an empty instruction queue and no unresolved blocking scope.

This is now the strongest automated proof in the repository of the core product differentiator: voice escalation does not freeze the whole agent, and human steering is asynchronous/durable rather than fake mid-generation interruption.

### CI-discovered fixture correction

The first version of the new fixture made an incorrect assertion that the *returned snapshot* from `checkpoint(consume=true)` should already contain `status: "consumed"` values. The current control-plane contract gathers the queued instructions, marks their persisted records consumed, and returns the delivered snapshot from that checkpoint.

GitHub Actions correctly failed that assertion. The fixture was corrected to test the durable semantic that matters: the consuming checkpoint returns the instructions delivered to the agent, and the following checkpoint returns no queued instructions. No production behavior was weakened or bypassed to make CI green.

## Architecture decisions confirmed this run

1. The integration story remains checkpoint-based and does not require undocumented host interruption.
2. A blocking escalation is branch/scope-local: the fixture explicitly changes the run's active scope and continues unrelated work while the decision call is pending.
3. Reconciliation remains explicit and safe for environments where webhook delivery is unavailable or delayed.
4. Owner callback instructions are durable queue items, not ephemeral prompt text.
5. `checkpoint(consume=true)` is treated as delivery/acknowledgement of the queued snapshot; durable consumption is observable on subsequent checkpoints.
6. MCP remains a thin transport adapter over the same HTTP/control-plane state machine used by generic clients.

## Verification performed

- Initial new work-loop commit `cb580b93889a810c3144668a87f97ca177d7ab07` ran GitHub Actions CI run `34050263469`.
- TypeScript typechecking and build succeeded in that run; 23 existing tests passed and the new test failed only on the incorrect consumed-snapshot assertion.
- Read the complete failing GitHub Actions job log and corrected the fixture based on actual checkpoint semantics.
- Corrected commit `03a4f3c649535609a76ce888e2c835a5679c7dd4` ran GitHub Actions CI run `34050318813`.
- That CI job completed successfully: checkout, Node 24 setup, dependency installation, and the full `Typecheck and test` step all passed.
- No live CALL-E call was attempted because this run has no authorized CALL-E credential/destination phone/public deployment.
- No actual Claude Code process was launched in this automation environment; the integration path is protocol-tested and documented, but host-level Claude Code acceptance still requires a real Claude Code installation/session.

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
- Provider event-id integrity validation: implemented.
- Application-owned webhook secret capability token: implemented.
- Environment-selectable live/fake provider: implemented.
- Typed HTTP agent SDK: implemented and integration-tested.
- MCP agent adapter: implemented and protocol-integration-tested.
- Full MCP work-loop proving decision + unrelated work + callback steering + safe consumption: implemented and CI-tested.
- Claude Code launch/config path: documented; actual host attachment still requires a Claude Code environment.
- Live CALL-E call: not attempted because no credential/authorized phone/public HTTPS URL is available to this run.

## Current blockers

No blocker to continued repository development.

Live CALL-E verification requires a valid `CALLE_API_KEY`, an authorized owner destination phone number, and a publicly reachable HTTPS deployment URL. Actual Claude Code host acceptance requires a Claude Code installation/session capable of registering the local stdio process. These are external/runtime prerequisites and do not block further policy, lifecycle, audit, deployment, or generic integration development.

## Highest-value next actions

1. Implement explicit call policy before broad UI work: quiet hours, per-run/per-owner call budgets, escalation priority gates, retry bounds, and expiry sweep behavior.
2. Add a durable audit-event timeline covering run status, escalation/call transitions, owner decisions, callbacks, queued instructions, and checkpoint consumption. This will support both the hackathon demo and production debugging.
3. Add graceful shutdown and production deployment documentation; validate SQLite file persistence assumptions for the chosen hosting target.
4. Add API rate limiting and credential scoping before exposing the control plane beyond a trusted single-owner deployment.
5. Generate and commit a lockfile once dependency choices stabilize, then use `npm ci` in CI.
6. Exercise the documented `claude mcp add` path in a real Claude Code installation and record exact host-level results.
7. After the Claude path is host-proven, add thin Codex/OpenAI integration guidance only for capabilities that are actually supported at that time.
8. Once policy/audit hardening is sound, build a small demo/status UI over the same APIs rather than creating another state machine.
