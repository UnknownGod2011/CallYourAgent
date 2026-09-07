# CallYourAgent progress

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. Agents can raise important owner decisions without freezing unrelated scopes; owners can independently request callbacks for progress/questions/steering; human input is persisted and consumed only at explicit safe checkpoints rather than pretending to interrupt in-flight model generation.

The repository includes SQLite persistence, deterministic fake and production CALL-E providers, replayable/idempotent call attempts, polling/webhook convergence, scoped authenticated HTTP APIs, a typed TypeScript client, stdio MCP, branch-scoped blocking, call policy/quiet hours/budgets, privacy-aware audit history, bounded lifecycle recovery, fail-closed ambiguous/stalled handling, API abuse controls, graceful shutdown, hard CALL-E HTTP deadlines, reproducible dependencies, readiness/liveness surfaces, deterministic end-to-end and operator demos, production Docker image, and single-instance persistent-volume Compose deployment.

This run completed the next owner-surface security increment: standard least-privilege credential roles are now explicit exported code, and the deterministic operator demo now provides a separate owner callback credential instead of requiring either a full-access token or widening the observational browser token.

## Exact repo state inspected this run

Before making changes, inspected the complete recursive `main` tree at HEAD `75b847ff0e0b481a66cb8ac15d98a0bd94b96035`, including source, tests, workflows, deployment assets, and documentation paths.

Read `AGENTS.md`, this file, `README.md`, `docs/ARCHITECTURE.md`, `docs/INTEGRATIONS.md`, `docs/API_SECURITY.md`, `docs/CALL_POLICY.md`, `docs/DEPLOYMENT.md`, `docs/OPERATOR_CONSOLE.md`, and `deploy/README.md` before editing. Inspected recent commits through the least-privilege operator-browser-token work. Checked repository issues and pull requests; there were no open issues or PRs.

Inspected the implementation/test surfaces relevant to this increment, especially `src/http-server.ts`, `src/operator-demo.ts`, `src/operator-ui.ts`, `src/index.ts`, `tests/operator-demo.test.ts`, and the complete tests directory listing. Confirmed the HTTP server already enforced the desired `owner:callback` scope separately from `agent:write` and `calls:reconcile`, so no new authorization mechanism or callback path was needed.

Repository mutation used the connected GitHub API. The automation runtime could not clone the public repository directly because its container had no outbound DNS access, so no unsupported local test result is claimed; verification used GitHub Actions.

## Changes made this run

### Standard credential role presets

Added `src/credential-roles.ts` with exported least-privilege presets:

- `agent` → `agent:read`, `agent:write`, `audit:read`;
- `operator-read` → `agent:read`, `audit:read`;
- `owner` → `agent:read`, `audit:read`, `owner:callback`;
- `reconciler` → `calls:reconcile`.

The helpers intentionally never return `*`, return fresh scope arrays so callers cannot mutate shared presets, and remain convenience helpers over the existing HTTP authorization model rather than creating a second permission system.

Exported these helpers from `src/index.ts` so SDK/adapters and deployment code can use the same role definitions.

Added `tests/credential-roles.test.ts` covering exact role scopes, wildcard exclusion, owner-role isolation from `agent:write` / `calls:reconcile`, and defensive array copying.

### Separate owner credential in the deterministic operator demo

Updated `startOperatorDemoServer(...)` so the demo now registers two browser-usable credentials:

1. `operator-demo-browser` using the `operator-read` role (`agent:read` + `audit:read`);
2. `operator-demo-owner` using the `owner` role (`agent:read` + `audit:read` + `owner:callback`).

The owner credential is independently configurable through `ownerToken` / `CYA_OPERATOR_DEMO_OWNER_TOKEN`. Read and owner token strings must be different, preventing accidental role collapse.

The CLI output now prints the owner callback token and exact owner scopes separately. It explicitly states that neither browser credential has agent-write or reconciliation authority. The trusted demo process still owns decision reconciliation, safe checkpoint pull, exact steering acknowledgement, and branch resume.

Added `tests/operator-owner-credential.test.ts` proving across the real HTTP boundary that:

- the owner token can read the privacy-safe run overview;
- the observational read token still gets `403` for `POST /v1/callbacks`;
- the owner token can create a callback through the existing normal callback endpoint;
- the owner token gets `403` for agent checkpoint/mutation;
- the owner token gets `403` for call reconciliation;
- accidental reuse of the same token for read and owner roles is rejected before server start.

### Security documentation

Updated `docs/API_SECURITY.md` to document the exported role presets and make clear they are least-privilege defaults layered on the existing server enforcement boundary, not a replacement authorization system.

Commits from this increment:

- `54511ed4d5c67cb65d6a853076f95506383aa75f` — add credential role presets.
- `1fcaf593445a05d97690af0bf63939ba05753b9d` — credential-role boundary tests.
- `557214db52e88433103cb7af7c365138f423490a` — export credential role helpers.
- `9ff603869aef8fd56c474f33055d16c88b95d145` — document credential role presets.
- `2040362acbe863f16c39dbb553f10658c6d3970b` — add separately scoped owner demo credential.
- `ae68b5a63a5c33633dcb0f3c877653e035d75caa` — HTTP acceptance coverage for the owner demo credential boundary.

## Architecture decisions made this run

1. Standard integration roles should be expressed once in exported typed code so adapters do not casually reproduce or widen scope lists.
2. Standard roles must never include wildcard access. The legacy `CYA_API_TOKEN` remains available for trusted compatibility but is not a role preset.
3. The hackathon operator demo should demonstrate owner → agent callback capability with a credential distinct from the observational token rather than widening the read token.
4. The owner-facing credential may read overview/audit because the existing operator UI needs those surfaces, but it must not have `agent:write` or `calls:reconcile`.
5. Trusted decision reconciliation and instruction checkpoint/acknowledgement remain inside the agent/backend process. An owner callback token is not an agent-control token.
6. Callback creation continues through the same `POST /v1/callbacks` HTTP contract and normal callback rate limit; no demo-only side-effect endpoint was introduced.
7. No Claude/Codex/ChatGPT mid-token interruption capability is claimed, and deterministic fake-provider completion is not treated as live CALL-E evidence.

## Verification performed

The final code/test-bearing commit `ae68b5a63a5c33633dcb0f3c877653e035d75caa` triggered all repository workflows and all completed successfully:

- CI run `34158092545` — successful; locked dependency install, TypeScript typecheck, build, and the full Node test suite including the new credential-role and owner-demo HTTP acceptance coverage.
- Container run `34158092448` — successful.
- Compose deployment run `34158092393` — successful.

The repository still has no separate lint script or migration command in `package.json`; the available standard verification remains typecheck/build/test via CI plus Container and Compose workflow checks.

No live CALL-E call was attempted or claimed.

## CALL-E integration status

- Fake provider: implemented and tested across owner decisions, callbacks, branch-scoped blocking, durable steering, exact acknowledgement, idempotency, policy/lifecycle recovery, auditability, SQLite restart, deterministic product demo, MCP work-loop acceptance, privacy-safe run overview, operator visualization, one-command fixture, real HTTP-boundary fixture acceptance, complete seeded-state progression, least-privilege observational access, and now a separately scoped owner-callback path.
- Production CALL-E adapter: implemented with server-only `CALLE_API_KEY`, provider idempotency, structured result handling, polling/webhook convergence, bounded HTTP requests, duplicate-call prevention, exact-key ambiguous replay, and fail-closed stalled handling.
- HTTP + TypeScript SDK + MCP: implemented over shared control-plane semantics. Credential role helpers are now exported for adapters, but authorization enforcement still lives in the HTTP server.
- Live CALL-E success: unverified; no real authorized phone call was made.

## Current blockers / external prerequisites

No repository-development blocker currently prevents further useful work.

Live CALL-E verification still requires user-controlled prerequisites: a valid/authorized CALL-E credential, authorized owner destination, and stable public HTTPS webhook ingress with the configured webhook capability token.

Real Claude Code host acceptance still requires running the documented stdio MCP registration/workflow in an actual Claude Code environment. Repository-side MCP behavior is CI-tested, but host acceptance must not be invented.

## Highest-value next actions

1. Add a privacy-safe authenticated credential-capabilities endpoint (credential id/role-relevant scopes only, never token material) so `/operator` can visibly identify read-only versus callback-capable sessions instead of making the presenter infer capability from which token they pasted.
2. Wire that endpoint into `/operator` to disable the callback button for a read-only credential and show a concise role/capability badge for an owner token.
3. Extend the deterministic owner-callback demo so a newly owner-requested callback can be deterministically completed/reconciled and its steering shown as a new pending-count/audit transition without exposing instruction text.
4. Add a visual explanation card for “unrelated branch kept running” vs “blocked branch resumed” using existing overview/audit state only.
5. When an actual Claude Code host is available, run the documented stdio MCP host acceptance flow with the deterministic fake provider.
6. When the user-only CALL-E prerequisites are available, perform a bounded live provider acceptance test and record only the observed result.
