# CallYourAgent progress

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. Agents can raise important owner decisions without freezing unrelated scopes; owners can independently request callbacks for progress/questions/steering; human input is persisted and consumed only at explicit safe checkpoints rather than pretending to interrupt in-flight model generation.

The repository includes SQLite persistence, deterministic fake and production CALL-E providers, replayable/idempotent call attempts, typed active-provider observations, polling/webhook convergence, scoped authenticated HTTP APIs, a typed TypeScript client, stdio MCP, branch-scoped blocking, call policy/quiet hours/budgets, privacy-aware audit history, bounded lifecycle recovery, fail-closed ambiguous/stalled handling, API abuse controls, graceful shutdown, bounded CALL-E HTTP requests, readiness/liveness surfaces, deterministic end-to-end and operator demos, a production Docker image, and a single-instance persistent-volume Compose deployment.

This run hardened deployment credential ergonomics so an exposed deployment can generate the recommended agent, owner, read-only operator, and reconciler credentials from the same canonical least-privilege role definitions used by the application, rather than hand-copying scope arrays and risking accidental `decision:read` or `calls:reconcile` exposure to browser-facing clients.

## Exact repo state inspected this run

The run started from `main` HEAD `acf2ff2257453f91daf7e89341ebda7cf00b9157`.

Before making changes, inspected the complete recursive repository tree and current architecture, including root configuration, GitHub Actions workflows, deployment assets, every documentation file, all source modules, and all tests. Inspected recent commit history through the scoped MCP escalation-boundary work. Checked repository issues and pull requests; there were no current issues or pull requests.

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

Also inspected the relevant implementation/configuration and verification surfaces, including `.env.example`, `src/server.ts`, `src/credential-roles.ts`, `package.json`, and `tests/credential-roles.test.ts`.

The previous run's highest-value next action was to strengthen scoped `CYA_API_CREDENTIALS_JSON` deployment examples so the agent, owner, read-only operator, and reconciler credentials can be configured without accidentally granting sensitive decision-read or provider-reconciliation authority to browser-facing surfaces. Inspection confirmed the canonical role presets were already correct and tested, but deployment setup still relied on users manually composing JSON scope arrays; `.env.example` also omitted `decision:read` from its supported-scope comment.

## Changes made this run

### Canonical standard credential bundle

Extended `src/credential-roles.ts` with `standardCredentialBundle(tokenFactory)`.

The helper builds exactly four stable credential roles using the existing canonical `credentialForRole` / `scopesForCredentialRole` definitions:

- `agent` -> `agent:read`, `agent:write`, `decision:read`, `audit:read`;
- `owner` -> `agent:read`, `audit:read`, `owner:callback`;
- `operator-read` -> `agent:read`, `audit:read`;
- `reconciler` -> `calls:reconcile`.

It rejects empty generated tokens and duplicate generated tokens. It deliberately does not introduce a second scope map for deployment, so changes to the tested role definitions cannot silently diverge from generated deployment credentials.

### Copy-safe credential generator CLI

Added `src/generate-credentials.ts` and the package script:

```text
npm run --silent credentials:generate
```

The generator uses Node's `crypto.randomBytes` and emits a single JSON array suitable for the existing `CYA_API_CREDENTIALS_JSON` environment variable. Each standard invocation creates four independent 32-byte random bearer tokens. The exported generator rejects token sizes below 16 bytes.

The generator only prints the credential bundle; it does not persist secrets, alter runtime state, contact CALL-E, or create phone side effects.

### Regression coverage

Extended `tests/credential-roles.test.ts` to prove the generated standard bundle preserves all four exact least-privilege role boundaries and rejects empty/duplicate token factories.

Added `tests/generate-credentials.test.ts` to prove the real generator emits:

- the exact four stable role ids;
- four unique high-entropy token strings;
- no wildcard scopes;
- `decision:read` only where the standard agent needs it;
- no `decision:read` or `calls:reconcile` on the owner credential;
- only `calls:reconcile` on the reconciler credential;
- rejection of an explicitly weak token-size request.

### Deployment/configuration guidance

Updated `.env.example` so its supported-scope comment now includes `decision:read` and points users to the standard generator instead of encouraging hand-authored JSON.

Updated `docs/DEPLOYMENT.md`, `docs/API_SECURITY.md`, and `deploy/README.md` with a copy-safe setup path such as:

```bash
npm ci
export CYA_API_CREDENTIALS_JSON="$(npm run --silent credentials:generate)"
```

The docs explicitly require generated output to be treated as secret material, kept out of browser/client bundles and source control, and regenerated if exposed. They preserve the backwards-compatible full-access `CYA_API_TOKEN` for tightly trusted/local bring-up while recommending scoped credentials for exposed deployments.

## Verification performed

The automation environment did not provide a local repository checkout suitable for running Node tooling directly, so no local build/test claim was fabricated. Executable verification was performed through the repository's existing GitHub Actions workflows.

The code/test-bearing state at commit `d0db4449250c01305f5a617baec46ceb19c78dae` passed every available verification path:

- CI run `34224142694` — success. The repository's Node 24 locked-install/typecheck/build/test workflow completed successfully, including the new credential-bundle and generator tests.
- Container run `34224142764` — success. Production image build and deterministic fake-provider runtime smoke completed successfully.
- Compose deployment run `34224142673` — success. Compose validation, fake-provider boot/health, durable authenticated API state, named-volume restart, post-restart persistence verification, and cleanup completed successfully.

Implementation/documentation commits in this run before this progress update:

- `cf5c56c4875809f0c78b006f8f48ce959be95ded` — `feat: generate standard scoped credential bundle`
- `99b65cc96b86ec39178b8a7fbaeb0d146346d2dc` — `feat: add scoped credential generator CLI`
- `01ea9b31fdff31eb86222e6ff945e0462dc1c19b` — `test: cover standard credential bundle`
- `dd1510587c6c73f57713cce537b67a19904274d1` — `chore: expose scoped credential generator`
- `21b11656fa72d763df137b8338c40f487f9e8c13` — `docs: make scoped credential setup copy-safe`
- `d0db4449250c01305f5a617baec46ceb19c78dae` — `test: validate generated deployment credentials`
- `659ea91b602a2d9e654ff8f5b96485d5c1973074` — `docs: add copy-safe scoped credential deployment`
- `b359148d5d7f8fdf73f77b0f1ba4ee9424b06ae8` — `docs: use generated scoped credentials in compose deployment`
- `dd5ff9703e5079ebdec58166818e4771af1f72e3` — `docs: document standard credential generator`

`package.json` still has no separate lint script and no standalone migration/schema-check command. The available executable verification remains CI typecheck/build/test plus Container and Compose deployment workflows.

No live CALL-E phone call was attempted or claimed.

## Architecture decisions made this run

1. Standard deployment credentials should be generated from the same canonical role presets used by application code/tests, not from a duplicated deployment-only scope map.
2. Least privilege should be an executable setup path, not only prose. A copy-safe generator reduces the chance that a real deployment widens owner/operator authority for convenience.
3. `decision:read` remains agent-consumption authority. The standard owner and operator credentials intentionally do not receive it merely to render lifecycle state.
4. `calls:reconcile` remains isolated to the reconciler role. Browser-facing credentials do not receive provider reconciliation authority.
5. The credential generator is only a secret-generation/configuration helper. HTTP authorization remains authoritative in `createControlPlaneHttpServer`; no new permission system was introduced.
6. The backwards-compatible wildcard/full-access token remains available for tightly trusted local use, but is not the recommended exposed deployment boundary.
7. No branch-scoped blocking, owner-decision persistence, callback steering, CALL-E reconciliation, idempotency, or safe-checkpoint semantics changed in this run.
8. Human steering still becomes durable queued state and is consumed only at explicit safe checkpoints; no mid-generation interruption capability is claimed.

## CALL-E integration status

- Fake provider: deterministic and tested for decisions, callbacks, branch-scoped blocking, durable steering, idempotency, ambiguous recovery, active-state progress, stale downgrade rejection, bounded stale detection, restart durability, auditability, HTTP/TypeScript/MCP integration, operator demos, credential/privacy boundaries, and the generated least-privilege deployment-role definitions added this run.
- Production CALL-E adapter: implemented with server-only `CALLE_API_KEY`, idempotent create, structured result schemas, active-state observation, terminal polling/webhook convergence, bounded requests, exact-key ambiguous recovery, duplicate prevention, and fail-closed stalled handling.
- HTTP + TypeScript SDK + MCP continue to share the same control-plane services and durable state machine. Credential generation changes deployment setup only; they do not bypass HTTP authorization.
- Live CALL-E success remains unverified; no real authorized phone call was made.

## Current blockers / external prerequisites

No repository-development blocker prevents further useful work.

Live CALL-E verification still requires user-controlled prerequisites: a valid/authorized CALL-E credential, authorized owner phone destination, and stable public HTTPS webhook ingress configured with the application-owned webhook capability token.

Real Claude Code host acceptance still requires running the documented stdio MCP workflow in an actual Claude Code environment. Repository-side MCP behavior is tested through the official MCP client/server packages and the real authenticated HTTP boundary; host acceptance must not be fabricated.

## Highest-value next actions

1. Add an end-to-end runtime acceptance that feeds a generated four-role bundle through `CYA_API_CREDENTIALS_JSON`, boots the fake-provider runtime, verifies `/v1/auth/capabilities` for each generated credential, and proves owner/operator/reconciler cross-role denials through the real HTTP boundary. This would connect generator -> env parser -> runtime authorization without duplicating existing unit coverage.
2. Keep capability-aware MCP/operator UX as presentation only; do not move authorization out of the HTTP control plane.
3. When an actual Claude Code host is available, run the documented stdio MCP host acceptance path with the deterministic fake provider and verify tool discovery plus checkpoint behavior from the real host.
4. When user-only CALL-E prerequisites are available, perform one bounded live provider acceptance test and record only observed results.
