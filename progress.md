# CallYourAgent progress

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. Agents can raise important owner decisions without freezing unrelated scopes; owners can independently request callbacks for progress/questions/steering; human input is persisted and consumed only at explicit safe checkpoints rather than pretending to interrupt in-flight model generation.

The repository includes SQLite persistence, deterministic fake and production CALL-E providers, replayable/idempotent call attempts, polling/webhook convergence, scoped authenticated HTTP APIs, a typed TypeScript client, stdio MCP, branch-scoped blocking, call policy/quiet hours/budgets, privacy-aware audit history, bounded lifecycle recovery, fail-closed ambiguous/stalled handling, API abuse controls, graceful shutdown, hard CALL-E HTTP deadlines, readiness/liveness surfaces, deterministic end-to-end and operator demos, production Docker image, and single-instance persistent-volume Compose deployment.

This run completed the next owner/operator security and usability increment: the typed client now exposes authenticated credential capabilities, and `/operator` uses the same capability contract to make callback authority explicit without weakening the existing server-side scope boundary.

## Exact repo state inspected this run

Before making changes, inspected the complete recursive `main` tree at HEAD `c431a32a7c82d28512e441e694923d9d7c13a275`. The recursive GitHub tree covered root files, GitHub Actions workflows, deployment assets, every docs file, all `src` files, and the tests directory.

Read `AGENTS.md` in full, this file in full, `README.md` in full, and the architecture/integration/operations documentation before editing: `docs/ARCHITECTURE.md`, `docs/INTEGRATIONS.md`, `docs/API_SECURITY.md`, `docs/CALL_POLICY.md`, `docs/DEPLOYMENT.md`, `docs/OPERATOR_CONSOLE.md`, and `deploy/README.md`.

Inspected the latest commits through the credential-capabilities increment. Checked repository issues and pull requests; there were no open issues and no open PRs.

Inspected implementation/test surfaces relevant to the increment, especially `src/http-server.ts`, `src/client.ts`, `src/operator-ui.ts`, `tests/client.test.ts`, `tests/operator-ui.test.ts`, and the tests directory inventory. Confirmed that `GET /v1/auth/capabilities` is already an authenticated projection of the active HTTP credential and that `POST /v1/callbacks` independently enforces `owner:callback`.

Repository mutation used the connected GitHub API. Verification used GitHub Actions; no unsupported local clone/test result is claimed.

## Changes made this run

### Typed capability discovery

Updated `src/client.ts` with:

```ts
await client.getCredentialCapabilities()
```

The method calls the existing authenticated `GET /v1/auth/capabilities` endpoint through the same bearer-authenticated request path as the rest of the TypeScript SDK. It returns the existing `CredentialCapabilities` contract and adds no client-side authorization semantics.

Added client regression coverage proving the legacy trusted token is projected as the five concrete effective scopes and never as `*`.

### Capability-aware operator callback controls

Updated `src/operator-ui.ts` so `/operator` now loads credential capabilities alongside the run overview and audit timeline.

Behavior:

- the callback button starts disabled;
- a credential badge shows `Read-only` or `Owner callback enabled` based only on the server-reported effective scopes;
- only a response containing `owner:callback` enables callback creation;
- changing the token immediately resets capability state and disables the callback button until the new credential is revalidated;
- load/auth failures also reset to the disabled state;
- the UI explicitly explains that capability discovery is convenience/clarity only and that the server independently enforces `owner:callback` on `POST /v1/callbacks`.

The browser still receives no `CALLE_API_KEY`, webhook secret, owner instruction text, callback transcript, or decision answer. The existing privacy-safe overview and metadata-only audit timeline remain unchanged.

Updated `tests/operator-ui.test.ts` to lock in the new safety behavior: the static shell references `/v1/auth/capabilities`, starts the callback control disabled, checks for `owner:callback`, resets capabilities when the token changes, and still contains no configured server secrets or queued instruction payloads.

Code/test commit:

- `76bda3f55fe277a341744736943311a6d4b8e8cd` — `feat: make operator callback controls capability-aware`

## Architecture decisions made this run

1. Capability-aware UI behavior must consume the already-existing authenticated HTTP capability projection; `/operator` must not infer privilege from token names or duplicate the credential-role definitions in browser code.
2. Capability discovery is advisory UX only. `POST /v1/callbacks` remains the authoritative authorization boundary and still independently requires `owner:callback`.
3. Callback controls fail closed in the browser: disabled before validation, disabled on token change, and disabled after any capability/run load error.
4. The typed SDK should expose the same capability contract so future owner/operator adapters do not hand-roll fetch/auth logic.
5. The capability endpoint remains run-independent and side-effect free; loading it does not touch control-plane business state or CALL-E.
6. No new state machine, callback path, or browser-side persistence was introduced.
7. No Claude/Codex/ChatGPT mid-token interruption capability is claimed, and deterministic fake-provider behavior is not treated as live CALL-E evidence.

## Verification performed

The code/test-bearing commit `76bda3f55fe277a341744736943311a6d4b8e8cd` triggered all repository verification paths and all completed successfully:

- CI run `34165296964` — successful. This path performs locked dependency installation plus the repository TypeScript check/test command; the test script builds before executing compiled Node tests.
- Container run `34165296983` — successful. Production image build and fake-provider runtime smoke path passed.
- Compose deployment run `34165296974` — successful. The single-instance SQLite deployment/persistence restart path passed.

The repository has no separate lint script or migration command in `package.json`; therefore no available standard lint/migration command was omitted.

No live CALL-E call was attempted or claimed.

## CALL-E integration status

- Fake provider: implemented and tested across owner decisions, callbacks, branch-scoped blocking, durable steering, exact acknowledgement, idempotency, policy/lifecycle recovery, auditability, SQLite restart, deterministic product demo, MCP work-loop acceptance, privacy-safe run overview, operator visualization, one-command fixture, real HTTP-boundary fixture acceptance, complete seeded-state progression, least-privilege observational access, separately scoped owner-callback access, credential capability introspection, and now capability-aware operator controls.
- Production CALL-E adapter: implemented with server-only `CALLE_API_KEY`, provider idempotency, structured result handling, polling/webhook convergence, bounded HTTP requests, duplicate-call prevention, exact-key ambiguous replay, and fail-closed stalled handling.
- HTTP + TypeScript SDK + MCP: implemented over shared control-plane semantics. The typed client now wraps credential capabilities as well as run, audit, escalation, checkpoint, acknowledgement, and callback contracts.
- Live CALL-E success: unverified; no real authorized phone call was made.

## Current blockers / external prerequisites

No repository-development blocker currently prevents further useful work.

Live CALL-E verification still requires user-controlled prerequisites: a valid/authorized CALL-E credential, authorized owner destination, and stable public HTTPS webhook ingress with the configured webhook capability token.

Real Claude Code host acceptance still requires running the documented stdio MCP registration/workflow in an actual Claude Code environment. Repository-side MCP behavior is CI-tested, but host acceptance must not be invented.

## Highest-value next actions

1. Extend the deterministic owner-callback demo so an owner-scoped browser credential can request a *new* callback, then let the trusted demo process deterministically complete/reconcile that exact callback so judges can watch new steering enter the durable queue without exposing its text.
2. Add focused HTTP acceptance coverage for the capability-aware operator credential split using the deterministic demo server: read token remains observational, owner token reports `owner:callback` and can create a callback, both remain unable to use agent-write/reconciliation authority they do not possess.
3. Add a visual explanation card for “independent branch kept running” versus “blocked branch resumed” using only existing overview/audit state.
4. Document `getCredentialCapabilities()` in `docs/INTEGRATIONS.md` and the capability-aware callback state in `docs/OPERATOR_CONSOLE.md` on the next documentation-focused increment.
5. When an actual Claude Code host is available, run the documented stdio MCP host acceptance flow with the deterministic fake provider.
6. When the user-only CALL-E prerequisites are available, perform a bounded live provider acceptance test and record only the observed result.
