# CallYourAgent progress

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. Agents can raise important owner decisions without freezing unrelated scopes; owners can independently request callbacks for progress/questions/steering; human input is persisted and consumed only at explicit safe checkpoints rather than pretending to interrupt in-flight model generation.

The repository includes SQLite persistence, deterministic fake and production CALL-E providers, replayable/idempotent call attempts, polling/webhook convergence, scoped authenticated HTTP APIs, a typed TypeScript client, stdio MCP, branch-scoped blocking, call policy/quiet hours/budgets, privacy-aware audit history, bounded lifecycle recovery, fail-closed ambiguous/stalled handling, API abuse controls, graceful shutdown, hard CALL-E HTTP deadlines, reproducible dependencies, readiness/liveness surfaces, deterministic end-to-end and operator demos, production Docker image, and single-instance persistent-volume Compose deployment.

This run completed the next owner/operator security increment: an authenticated privacy-safe credential-capabilities contract now lets a client learn the effective permissions of the credential it is already using without exposing bearer material or probing side-effecting endpoints.

## Exact repo state inspected this run

Before making changes, inspected the complete recursive `main` tree at HEAD `c449189e1a54976b354e307ae2cfc1852f5f7076`. The recursive GitHub tree response reported `truncated: false`, covering root files, GitHub Actions workflows, deployment assets, every docs file, all `src` files, and the complete tests directory.

Read `AGENTS.md` in full, this file in full, `README.md` in full, and the architecture/integration/operations documentation before editing: `docs/ARCHITECTURE.md`, `docs/INTEGRATIONS.md`, `docs/API_SECURITY.md`, `docs/CALL_POLICY.md`, `docs/DEPLOYMENT.md`, `docs/OPERATOR_CONSOLE.md`, and `deploy/README.md`.

Inspected recent commits through the owner-callback credential split. Checked repository issues and pull requests; there were no open issues or open PRs.

Inspected the implementation/test surfaces relevant to this increment, especially `src/http-server.ts`, `src/operator-ui.ts`, `tests/operator-ui.test.ts`, `src/credential-roles.ts`, and `package.json`. Confirmed that authentication and route scope enforcement already live in `createControlPlaneHttpServer`, so capability introspection could be a projection of the existing authenticated credential rather than a new authorization system.

Repository mutation used the connected GitHub API. A direct local clone was not available in the automation container because outbound GitHub DNS resolution was unavailable, so no unsupported local test result is claimed; verification used the repository's GitHub Actions workflows.

## Changes made this run

### Authenticated credential-capabilities endpoint

Updated `src/http-server.ts` with an authenticated side-effect-free endpoint:

```text
GET /v1/auth/capabilities
```

The response contains:

- `credentialId` — the stable configured credential id;
- `scopes` — only the effective concrete API scopes available to that credential.

The endpoint never returns bearer-token material. For the backwards-compatible legacy full-access `*` token, the response expands wildcard authority into the five concrete capabilities (`agent:read`, `agent:write`, `audit:read`, `owner:callback`, `calls:reconcile`) instead of returning `*`.

Added the exported `CredentialCapabilities` type and a canonical list of concrete API scopes. Existing route-level authorization remains authoritative; this endpoint only describes the already-authenticated credential and cannot widen its privileges.

### HTTP security regression coverage

Added `tests/credential-capabilities-http.test.ts` over the real HTTP server boundary. It proves:

- unauthenticated capability reads return `401`;
- a read-only credential reports only `agent:read` + `audit:read`;
- an owner credential additionally reports `owner:callback`;
- responses are `Cache-Control: no-store`;
- bearer-token strings are absent from returned payloads;
- ungranted write/reconciliation scopes are not leaked into read/owner capability projections;
- the legacy wildcard credential is represented by concrete effective permissions instead of `*`.

### Security documentation

Updated `docs/API_SECURITY.md` with the capability endpoint contract and its intended use: owner/operator surfaces can determine whether a supplied credential can request callbacks without guessing from token labels or intentionally hitting a side-effecting endpoint and interpreting `403`.

Commits from this increment:

- `1215ab51c0381174a25af1b215a84ba94e6649dc` — expose authenticated credential capabilities.
- `31c5f2456cf9570b2d8a79db2be92711f45d83e2` — HTTP regression coverage for the capability boundary.
- `834aabed8282e666e4ec600ca51b1db5f53ffac8` — document the capability endpoint.

## Architecture decisions made this run

1. Credential capability discovery belongs at the existing HTTP authentication boundary, not in `ControlPlane`, because it describes transport authorization rather than agent business state.
2. The endpoint is a read-only projection of existing authorization state; it does not introduce roles, permissions, or a second source of truth.
3. Token material must never be returned. The stable credential id and effective scopes are sufficient for an owner/operator UI to explain what the current session can do.
4. Wildcard access is expanded into concrete capabilities rather than echoed as `*`, keeping the browser-facing response explicit and avoiding dependence on internal wildcard semantics.
5. Capability introspection must not require any run id and must not invoke the control plane or CALL-E provider.
6. Normal route-level checks remain the enforcement boundary. A UI may disable a button based on capabilities, but the server still independently verifies `owner:callback` before creating a callback.
7. No Claude/Codex/ChatGPT mid-token interruption capability is claimed, and deterministic fake-provider behavior is not treated as live CALL-E evidence.

## Verification performed

The final code/test-bearing commit `31c5f2456cf9570b2d8a79db2be92711f45d83e2` triggered all repository verification paths and they completed successfully:

- CI run `34161745165` — successful. The `check` job completed locked dependency installation plus `Typecheck and test`; the repository `check` script runs TypeScript typechecking and the full test command, whose test script performs a build before running all compiled Node tests.
- Container run `34161745179` — successful. Production image build and fake-provider runtime smoke test both completed successfully.
- Compose deployment run `34161745230` — successful, including the existing single-instance SQLite persistence/restart verification path.

The repository has no separate lint script or migration command in `package.json`; therefore no lint/migration command is omitted from the available standard project scripts. No local clone-based verification is claimed because the automation container could not resolve GitHub directly.

No live CALL-E call was attempted or claimed.

## CALL-E integration status

- Fake provider: implemented and tested across owner decisions, callbacks, branch-scoped blocking, durable steering, exact acknowledgement, idempotency, policy/lifecycle recovery, auditability, SQLite restart, deterministic product demo, MCP work-loop acceptance, privacy-safe run overview, operator visualization, one-command fixture, real HTTP-boundary fixture acceptance, complete seeded-state progression, least-privilege observational access, separately scoped owner-callback access, and now credential capability introspection at the HTTP auth boundary.
- Production CALL-E adapter: implemented with server-only `CALLE_API_KEY`, provider idempotency, structured result handling, polling/webhook convergence, bounded HTTP requests, duplicate-call prevention, exact-key ambiguous replay, and fail-closed stalled handling.
- HTTP + TypeScript SDK + MCP: implemented over shared control-plane semantics. HTTP now exposes credential capabilities, but the typed client does not yet wrap that endpoint.
- Live CALL-E success: unverified; no real authorized phone call was made.

## Current blockers / external prerequisites

No repository-development blocker currently prevents further useful work.

Live CALL-E verification still requires user-controlled prerequisites: a valid/authorized CALL-E credential, authorized owner destination, and stable public HTTPS webhook ingress with the configured webhook capability token.

Real Claude Code host acceptance still requires running the documented stdio MCP registration/workflow in an actual Claude Code environment. Repository-side MCP behavior is CI-tested, but host acceptance must not be invented.

## Highest-value next actions

1. Wire `GET /v1/auth/capabilities` into `/operator`: show a concise credential/capability badge and disable owner-callback controls when `owner:callback` is absent, while retaining server-side enforcement.
2. Add a typed `CallYourAgentClient.getCredentialCapabilities()` wrapper so owner/operator adapters can use the same contract without hand-written fetch logic.
3. Extend the deterministic owner-callback demo so a newly owner-requested callback can be deterministically completed/reconciled and its resulting steering appears as a new pending-count/audit transition without exposing instruction text.
4. Add a visual explanation card for “unrelated branch kept running” versus “blocked branch resumed” using only existing overview/audit state.
5. When an actual Claude Code host is available, run the documented stdio MCP host acceptance flow with the deterministic fake provider.
6. When the user-only CALL-E prerequisites are available, perform a bounded live provider acceptance test and record only the observed result.
