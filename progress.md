# progress.md

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. The product model remains unchanged: autonomous agents may request genuinely important owner judgment without freezing unrelated branches/scopes; owners may independently request callbacks for progress/questions/steering; human decisions and instructions become durable structured state consumed at explicit safe checkpoints rather than being represented as impossible mid-generation interruption.

The repository includes SQLite persistence, deterministic fake and production CALL-E providers, replayable/idempotent call attempts, polling/webhook convergence, scoped authenticated HTTP APIs, a typed TypeScript client, stdio MCP, branch/checkpoint semantics, decision-call policy, privacy-aware audit history, bounded lifecycle recovery, fail-closed ambiguous/stalled handling, API abuse controls, graceful shutdown, hard provider HTTP deadlines, reproducible dependencies, an operator console, production Docker/Compose deployment, restart-persistence verification, an assertion-backed deterministic end-to-end demo, and now a side-effect-free readiness/configuration endpoint distinct from process liveness.

## Exact repo state inspected this run

Before changing code, inspected the complete recursive `main` Git tree at HEAD `55e27d247852ae2541a513ae3b09dce6db2522a9`. The tree included source, tests, workflows, package metadata, Docker/deployment assets, and all documentation paths.

Read `AGENTS.md`, this file, `README.md`, `docs/ARCHITECTURE.md`, `docs/INTEGRATIONS.md`, `docs/CALL_POLICY.md`, `docs/API_SECURITY.md`, `docs/DEPLOYMENT.md`, `docs/OPERATOR_CONSOLE.md`, and `deploy/README.md` in full. Inspected recent commits through the deterministic product-demo work. Checked repository issues and pull requests; both collections were empty.

Inspected the implementation surfaces relevant to the selected increment: `src/server.ts`, `src/http-server.ts`, and `tests/http-server.test.ts`. The highest-value unblocked item from the previous run was the documented readiness/configuration endpoint.

## Changes made this run

### Side-effect-free readiness/configuration endpoint

Added unauthenticated `GET /ready`, deliberately separate from `GET /health`.

`/health` remains simple process liveness (`{ ok: true }`). `/ready` reports only non-secret deployment facts that were already validated while constructing the selected runtime:

- `ready`;
- `providerMode` (`fake` or `calle`);
- `storeMode` (`memory` or `sqlite`);
- whether live-call configuration is applicable/configured;
- whether public-webhook configuration is applicable/configured;
- `providerNetworkChecked: false`.

The endpoint never calls CALL-E, never probes the network, never creates/reconciles a phone call, and never exposes `CALLE_API_KEY`, bearer credentials, owner phone number, public URL, or webhook token.

`buildRuntimeFromEnv` now constructs the readiness snapshot only after existing environment validation has succeeded and passes that immutable snapshot into the HTTP adapter. In live mode, “configured” means the required server-side CALL-E key, owner destination, public base URL, and webhook token were present and accepted by startup validation. It explicitly does **not** mean CALL-E is reachable, the phone destination is authorized, public ingress is externally routable, or a real call has succeeded.

### Regression coverage

Extended `tests/http-server.test.ts` to verify that:

- `/health` is unauthenticated and retains its narrow liveness response;
- `/ready` is unauthenticated;
- a live-mode readiness snapshot returns the expected selected provider/store configuration;
- `providerNetworkChecked` remains `false`, preventing the readiness surface from being misread as live CALL-E verification.

### Deployment documentation

Updated `docs/DEPLOYMENT.md` with the health/readiness distinction and fake-first deployment guidance. The deployment docs now explicitly state:

- `/health` answers whether the process is serving;
- `/ready` answers whether the selected runtime mode passed local startup configuration validation;
- neither endpoint proves provider reachability or successful real phone behavior.

## Architecture decisions made this run

1. Readiness must remain a pure snapshot of already-validated local configuration. It must not introduce a hidden provider side effect merely because an orchestrator polls an endpoint.
2. Provider reachability is intentionally represented as unchecked. This avoids turning readiness polling into phone-provider traffic and prevents accidental claims of live verification.
3. The readiness response is safe to leave unauthenticated because it exposes only coarse provider/store mode and configuration-state enums/booleans, never secret values or user/run state.
4. Live-mode startup remains fail-fast for required server-side configuration. A runtime that reaches `ready: true` in `calle` mode has complete local configuration, but external reachability/authorization remains a separate operational concern.
5. MCP, HTTP, SDK, branch-scoped blocking, durable owner instruction semantics, and provider idempotency behavior are unchanged.

## Verification performed

Code-bearing commits this run:

- `9e79fa71f48d82cf4ed96abd72225ef8e1bd2cb4` — `feat: add side-effect-free readiness endpoint`
- `3f6f9d9781a50f16149f3b3c455f530557fd57c2` — `feat: expose validated deployment readiness`
- `f5d97f2b805d08f8dd804ecb3afab6829d6f6d7f` — `test: cover readiness endpoint semantics`
- `cf03568ff401206f0c8c81e427a142ecc45bc204` — `docs: document readiness semantics`

GitHub Actions standard CI run `34103798817` on code-bearing commit `f5d97f2b805d08f8dd804ecb3afab6829d6f6d7f` completed successfully. This workflow uses the committed dependency lock with `npm ci` and runs the repository `npm run check` pipeline, covering TypeScript typechecking, build, and the compiled Node test suite including the new readiness regression test.

Container and Compose workflows were also triggered for the resulting main-branch states; the existing production-container and restart-persistence architecture was not changed by this increment.

No live CALL-E call was attempted or claimed.

## CALL-E integration status

- Deterministic fake provider: implemented and tested across decision calls, callbacks, branch-scoped blocking, queued steering, safe checkpoint consumption, idempotency, policy/lifecycle handling, auditability, SQLite restart, operator visualization, production container boot, Compose persistence, and the assertion-backed `npm run demo` story.
- Production CALL-E adapter: implemented with server-only API key, structured result schemas, provider idempotency, asynchronous polling, terminal webhook reconciliation, bounded create/poll requests, duplicate-call prevention, ambiguous replay with the exact original key, and fail-closed stalled handling.
- HTTP + TypeScript SDK + MCP: implemented.
- Scoped credentials plus callback/reconciliation rate limits: implemented and tested.
- Graceful runtime shutdown and persistent-volume deployment: implemented and tested.
- Liveness/readiness separation: implemented and tested. Readiness is local-configuration evidence only and never a provider probe.
- Live CALL-E call: **not attempted and not claimed**.

## Current blockers

There is no blocker to continued repository development.

Live CALL-E verification still requires a valid CALL-E credential, authorized owner phone destination, and stable public HTTPS deployment/webhook path. Real Claude Code host acceptance still requires an actual Claude Code installation/session. Those external prerequisites do not block further control-plane work.

## Highest-value next actions

1. Strengthen owner-instruction delivery semantics with explicit per-instruction acknowledgement/consumption so a worker can acknowledge exactly the instructions it incorporated, without consuming a later-arriving instruction in the same checkpoint window. Preserve the existing simple checkpoint API where possible.
2. Add read-only unresolved blocking-scope and queued-instruction counts to the operator console/API surface for a clearer hackathon demonstration, without consuming state or creating a second business-state layer.
3. Exercise the documented Claude Code stdio MCP registration path in a real Claude Code host when such an environment becomes available and record exact acceptance evidence.
4. Keep broader Codex/ChatGPT adapters thin and capability-honest; add them only where current platform tool/checkpoint semantics genuinely support the shared control plane.
