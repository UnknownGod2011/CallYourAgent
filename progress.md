# CallYourAgent progress

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. Agents can raise important owner decisions without freezing unrelated scopes; owners can independently request callbacks for progress/questions/steering; human input is persisted and consumed only at explicit safe checkpoints rather than pretending to interrupt in-flight model generation.

The repository includes SQLite persistence, deterministic fake and production CALL-E providers, replayable/idempotent call attempts, typed active-provider observations, polling/webhook convergence, scoped authenticated HTTP APIs, a typed TypeScript client, stdio MCP, branch-scoped blocking, call policy/quiet hours/budgets, privacy-aware audit history, bounded lifecycle recovery, fail-closed ambiguous/stalled handling, API abuse controls, graceful shutdown, bounded CALL-E HTTP requests, readiness/liveness surfaces, deterministic end-to-end and operator demos, a production Docker image, and a single-instance persistent-volume Compose deployment.

This run closed the deployment-authorization acceptance gap left by the previous credential-generator work. The generated standard four-role credential bundle is now exercised end-to-end through `CYA_API_CREDENTIALS_JSON`, the real runtime environment parser, an actually listening fake-provider HTTP server, capability discovery, successful least-privilege operations, and explicit cross-role denials.

## Exact repo state inspected this run

The run started from `main` HEAD `0872cbfedd6284beef2881c876aa68ad05b5bae7`.

Before making changes, inspected the complete recursive repository tree and current architecture, including root configuration, all GitHub Actions workflows, deployment assets, every documentation file, all source modules, and all tests. Inspected recent commit history through the scoped credential generator/deployment hardening work. Checked repository issues and pull requests; there were no current open issues or pull requests.

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

Also inspected the relevant runtime/authentication implementation and existing verification surfaces, including `src/server.ts`, `src/http-server.ts`, `src/credential-roles.ts`, `tests/server-runtime.test.ts`, and `tests/credential-capabilities-http.test.ts`.

The previous run's highest-value next action was to connect the generated four-role bundle to the actual runtime boundary: generate credentials, pass them through `CYA_API_CREDENTIALS_JSON`, boot the fake-provider server, inspect effective capabilities, and prove cross-role denials through HTTP. Inspection confirmed the role presets, env parser, and route-level authorization each had focused tests, but no acceptance covered their composition as one deployed runtime.

## Changes made this run

### Generated credential runtime HTTP acceptance

Added `tests/generated-credential-runtime-http.test.ts`.

The test deterministically builds the same standard four-role bundle exposed by the credential generator, serializes it into `CYA_API_CREDENTIALS_JSON`, and starts the actual runtime with:

- `CYA_CALL_PROVIDER=fake`;
- `CYA_STORE=memory`;
- no legacy `CYA_API_TOKEN`;
- an ephemeral TCP port.

It then exercises the real authenticated HTTP boundary and proves:

1. every generated credential survives env parsing and reports exactly its expected effective scopes through `GET /v1/auth/capabilities` without returning token material;
2. the `agent` credential can create an agent and run;
3. the standard `owner` and `operator-read` credentials can read run state;
4. the owner credential cannot perform `agent:write` operations;
5. the operator credential cannot request an owner callback;
6. the agent credential also cannot use the owner-callback surface merely because it can write agent state;
7. the owner credential can request a callback through the real callback route;
8. the owner credential cannot reconcile that callback;
9. the reconciler credential cannot read ordinary run state or audit history;
10. the reconciler credential can reconcile the already-created callback;
11. the operator credential can read the privacy-aware audit timeline.

The test shuts the owned runtime down in `finally`, so the acceptance also uses the normal runtime lifecycle rather than constructing a detached HTTP adapter fixture.

No production authorization behavior was widened or rewritten in this run. The value of the increment is executable proof that the generator, JSON env parser, runtime bootstrap, capability projection, and route-level scope checks agree in one real server process.

## Verification performed

The automation environment did not provide a local repository checkout suitable for running Node tooling directly, so no local build/test claim was fabricated. Executable verification was performed through the repository's existing GitHub Actions workflows.

The code/test-bearing state at commit `6c701de62034d707b7e36bda40220eac0071ba85` passed every available verification path:

- CI run `34229604827` — success. Node 24 setup, locked dependency install, and the repository's combined TypeScript typecheck/build/test step completed successfully, including the new generated-credential runtime HTTP acceptance.
- Container run `34229604891` — success. Production image build and deterministic fake-provider runtime smoke completed successfully.
- Compose deployment run `34229604809` — success. Compose validation, fake-provider boot/health, durable authenticated API state creation, named-volume restart, post-restart persistence verification, and cleanup all completed successfully.

Implementation commit before this progress update:

- `6c701de62034d707b7e36bda40220eac0071ba85` — `test: verify generated credentials through runtime HTTP boundary`

`package.json` still has no separate lint script and no standalone migration/schema-check command. The available executable verification remains CI typecheck/build/test plus Container and Compose deployment workflows.

No live CALL-E phone call was attempted or claimed.

## Architecture decisions made this run

1. Least-privilege deployment roles must be verified as a composed runtime path, not only as independent role, parser, and HTTP-unit tests.
2. `CYA_API_CREDENTIALS_JSON` is now acceptance-tested as the real exposed-deployment credential input; the legacy wildcard token is intentionally absent from the new acceptance.
3. The HTTP control plane remains the authorization source of truth. Capability discovery is descriptive only and never substitutes for route-level checks.
4. The standard agent role has agent read/write plus durable decision-read authority, but does not inherit owner-callback authority.
5. The standard owner role can observe state and request a callback, but cannot mutate agent state or reconcile provider calls.
6. The read-only operator can observe run/audit state but cannot initiate phone side effects.
7. The reconciler can reconcile provider calls but cannot read run or audit state merely because it is a trusted backend worker.
8. No branch-scoped blocking, owner-decision persistence, callback steering, CALL-E reconciliation semantics, idempotency, or safe-checkpoint behavior changed in this run.
9. Human steering still becomes durable queued state and is consumed only at explicit safe checkpoints; no mid-generation interruption capability is claimed.

## CALL-E integration status

- Fake provider: deterministic and tested for decisions, callbacks, branch-scoped blocking, durable steering, idempotency, ambiguous recovery, active-state progress, stale downgrade rejection, bounded stale detection, restart durability, auditability, HTTP/TypeScript/MCP integration, operator demos, privacy boundaries, least-privilege role generation, and now generated-role runtime/env authorization composition.
- Production CALL-E adapter: implemented with server-only `CALLE_API_KEY`, idempotent create, structured result schemas, active-state observation, terminal polling/webhook convergence, bounded requests, exact-key ambiguous recovery, duplicate prevention, and fail-closed stalled handling.
- HTTP + TypeScript SDK + MCP continue to share the same control-plane services and durable state machine. The new acceptance validates deployment credential wiring without bypassing that architecture.
- Live CALL-E success remains unverified; no real authorized phone call was made.

## Current blockers / external prerequisites

No repository-development blocker prevents further useful work.

Live CALL-E verification still requires user-controlled prerequisites: a valid/authorized CALL-E credential, authorized owner phone destination, and stable public HTTPS webhook ingress configured with the application-owned webhook capability token.

Real Claude Code host acceptance still requires running the documented stdio MCP workflow in an actual Claude Code environment. Repository-side MCP behavior is tested through the official MCP client/server packages and the real authenticated HTTP boundary; host acceptance must not be fabricated.

## Highest-value next actions

1. Upgrade the Compose deployment smoke so the deployed container itself boots from a scoped `CYA_API_CREDENTIALS_JSON` bundle rather than relying only on the backwards-compatible full-access token, and prove after SQLite restart that separate agent/operator/owner/reconciler credentials retain their intended capabilities and denials. This would extend today's in-process runtime acceptance to the actual reference deployment recipe.
2. Keep capability-aware MCP/operator UX as presentation only; do not move authorization out of the HTTP control plane.
3. When an actual Claude Code host is available, run the documented stdio MCP host acceptance path with the deterministic fake provider and verify tool discovery plus checkpoint behavior from the real host.
4. When user-only CALL-E prerequisites are available, perform one bounded live provider acceptance test and record only observed results.
