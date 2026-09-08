# CallYourAgent progress

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. Agents can raise important owner decisions without freezing unrelated scopes; owners can independently request callbacks for progress/questions/steering; human input is persisted and consumed only at explicit safe checkpoints rather than pretending to interrupt in-flight model generation.

The repository includes SQLite persistence, deterministic fake and production CALL-E providers, replayable/idempotent call attempts, typed active-provider observations, polling/webhook convergence, scoped authenticated HTTP APIs, a typed TypeScript client, stdio MCP, branch-scoped blocking, call policy/quiet hours/budgets, privacy-aware audit history, bounded lifecycle recovery, fail-closed ambiguous/stalled handling, API abuse controls, graceful shutdown, bounded CALL-E HTTP requests, readiness/liveness surfaces, deterministic end-to-end and operator demos, a production Docker image, and a single-instance persistent-volume Compose deployment.

This run closed a real mismatch between the documented least-privilege deployment path and the Compose reference deployment. The reference Compose file now allows `CYA_API_CREDENTIALS_JSON` to be the sole API authentication source instead of requiring the backwards-compatible wildcard `CYA_API_TOKEN`, and the Compose GitHub Actions smoke now boots the actual container from a generated four-role credential bundle, validates capabilities and cross-role denials, persists SQLite state, restarts the service, and proves the same authorization split still holds afterward.

## Exact repo state inspected this run

The run started from `main` HEAD `20bed40c0de20429253814b11031c4955e07bc6f`.

Before making changes, inspected the complete recursive repository tree and current architecture, including root configuration, GitHub Actions workflows, deployment assets, documentation, source modules, and tests. Inspected recent commit history through the generated-credential runtime HTTP acceptance work. Checked repository issues and pull requests; there were no current issues or pull requests.

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

Also inspected the relevant deployment/runtime/authentication surfaces, including `deploy/compose.yml`, `.github/workflows/compose.yml`, `src/server.ts`, `src/http-server.ts`, and `package.json`.

Inspection found a concrete deployment bug: `src/server.ts` correctly accepts either a legacy `CYA_API_TOKEN` or one or more `CYA_API_CREDENTIALS_JSON` credentials, and the deployment documentation explicitly recommends generating scoped credentials and unsetting the legacy token, but `deploy/compose.yml` still used required Compose interpolation for `CYA_API_TOKEN`. Therefore the documented secure Compose command could not actually start as written without also providing a wildcard credential.

The previous run's highest-value next action was to upgrade the Compose deployment smoke to boot from the scoped four-role bundle and prove role capabilities/denials survive a SQLite restart. This run completed that action.

## Changes made this run

### Compose now supports scoped-only authentication

Updated `deploy/compose.yml` so `CYA_API_TOKEN` uses optional interpolation rather than a Compose-time required-value expression.

This does not weaken runtime authentication. `src/server.ts` remains authoritative and refuses startup unless at least one of these is configured:

- a non-empty legacy `CYA_API_TOKEN`; or
- at least one valid credential in `CYA_API_CREDENTIALS_JSON`.

The change therefore makes the already-supported scoped runtime mode reachable through the reference Compose recipe without requiring an unnecessary full-access secret.

### Real Compose least-privilege acceptance

Upgraded `.github/workflows/compose.yml` to use the secure deployment path itself instead of a CI-only wildcard token.

The workflow now:

1. installs Node 24 dependencies and runs the repository credential generator;
2. exports the complete generated standard bundle as `CYA_API_CREDENTIALS_JSON` and extracts the four generated bearer tokens only for the workflow's role-specific HTTP checks;
3. explicitly verifies that no `CYA_API_TOKEN` is configured before validating the Compose file;
4. boots the fake-provider SQLite deployment using only scoped credentials;
5. queries `/v1/auth/capabilities` and verifies the exact generated role split:
   - `agent`: `agent:read`, `agent:write`, `decision:read`, `audit:read`;
   - `owner`: `agent:read`, `audit:read`, `owner:callback`;
   - `operator-read`: `agent:read`, `audit:read`;
   - `reconciler`: `calls:reconcile`;
6. creates an agent/run and updates durable run state with the agent credential;
7. restarts the same Compose service over the same named SQLite volume;
8. proves the agent and operator can still read the persisted run and the operator can read its privacy-aware audit history;
9. proves the reconciler still cannot read ordinary run state;
10. proves neither the agent nor read-only operator can initiate an owner callback;
11. proves the owner can initiate a callback but cannot reconcile it;
12. proves only the reconciler can perform callback reconciliation;
13. rechecks effective capabilities after restart so the deployment restart cannot accidentally widen a role.

The workflow uses the normal HTTP control plane and normal fake provider. No demo-only mutation or authorization bypass was added.

Implementation commit before this progress update:

- `1bae6d1f808297f43e62a89f4d9c44383847cbd3` — `test: verify scoped credentials in compose deployment`

## Verification performed

The automation environment did not provide a local repository checkout suitable for running Node tooling directly, so no local build/test claim was fabricated. Executable verification was performed through the repository's existing GitHub Actions workflows.

The implementation state at commit `1bae6d1f808297f43e62a89f4d9c44383847cbd3` passed every available verification surface:

- CI run `34235994071` — success. The repository's Node 24 locked-install/typecheck/build/test path completed successfully.
- Container run `34235996233` — success. Production image build and deterministic fake-provider runtime smoke completed successfully.
- Compose deployment run `34235993980` — success. The strengthened workflow generated the four scoped credentials, validated the Compose configuration with no legacy token, booted the fake-provider/SQLite container, verified exact capabilities, created durable API state, restarted the named-volume deployment, verified persisted state and audit history, exercised cross-role denials, allowed the owner callback only through the owner role, allowed reconciliation only through the reconciler role, and cleaned up successfully.

`package.json` still has no separate lint script and no standalone migration/schema-check command. The available executable verification remains CI typecheck/build/test plus Container and Compose deployment workflows.

No live CALL-E phone call was attempted or claimed.

## Architecture decisions made this run

1. The reference Compose layer must not impose a stronger requirement than the runtime authentication contract. Scoped-only deployments are a first-class supported mode, so Compose must allow them without an extra wildcard secret.
2. Runtime startup remains the single enforcement point for the invariant that at least one valid API authentication mechanism must exist. Optional Compose interpolation is not anonymous access.
3. A least-privilege deployment path is only credible if the actual container recipe and CI use it. The Compose acceptance therefore boots with generated role credentials rather than proving scoped auth only in an in-process test.
4. Credential roles are configuration, not SQLite domain state. Restarting persisted control-plane state must not widen permissions; the workflow now proves the four role capabilities remain unchanged after restart.
5. The standard agent can mutate agent state and consume durable decisions but cannot initiate owner callbacks; the owner can request callbacks but cannot reconcile provider calls or consume private decision answers; the read-only operator remains observational; the reconciler remains provider-facing and cannot read ordinary run/audit state.
6. The HTTP control plane remains the authorization source of truth. Capability discovery is descriptive only; every successful/denied operation is still enforced independently at its route.
7. No branch-scoped blocking, owner-decision persistence, instruction queue, call policy, retry/idempotency, provider observation, webhook convergence, or safe-checkpoint semantics changed in this run.
8. Human steering still becomes durable queued state and is consumed only at explicit safe checkpoints; no mid-generation interruption capability is claimed.

## CALL-E integration status

- Fake provider: deterministic and tested for decisions, callbacks, branch-scoped blocking, durable steering, idempotency, ambiguous recovery, active-state progress, stale downgrade rejection, bounded stale detection, restart durability, auditability, HTTP/TypeScript/MCP integration, operator demos, privacy boundaries, generated least-privilege roles, runtime/env authorization composition, and now the actual scoped-only Compose + persistent SQLite deployment path.
- Production CALL-E adapter: implemented with server-only `CALLE_API_KEY`, idempotent create, structured result schemas, active-state observation, terminal polling/webhook convergence, bounded requests, exact-key ambiguous recovery, duplicate prevention, and fail-closed stalled handling.
- HTTP + TypeScript SDK + MCP continue to share the same control-plane services and durable state machine. This run changed deployment wiring/acceptance only; it did not create a second authorization or provider path.
- Live CALL-E success remains unverified; no real authorized phone call was made.

## Current blockers / external prerequisites

No repository-development blocker prevents further useful work.

Live CALL-E verification still requires user-controlled prerequisites: a valid/authorized CALL-E credential, authorized owner phone destination, and stable public HTTPS webhook ingress configured with the application-owned webhook capability token.

Real Claude Code host acceptance still requires running the documented stdio MCP workflow in an actual Claude Code environment. Repository-side MCP behavior is tested through the official MCP client/server packages and the real authenticated HTTP boundary; host acceptance must not be fabricated.

## Highest-value next actions

1. Extend deployment-level fake-provider acceptance beyond authentication/persistence into one representative branch-scoped decision + owner-callback flow under the separate scoped credentials, without adding demo-only production mutation endpoints. Prefer composing existing public agent/owner APIs plus trusted provider/reconciliation surfaces so the reference deployment proves the same end-to-end semantics as the deterministic in-process demo.
2. Audit deployment secret handling for accidental credential exposure in generated workflow/config output and tighten masking/logging where useful without introducing a second secret-management system.
3. Keep capability-aware MCP/operator UX as presentation only; do not move authorization out of the HTTP control plane.
4. When an actual Claude Code host is available, run the documented stdio MCP host acceptance path with the deterministic fake provider and verify tool discovery plus checkpoint behavior from the real host.
5. When user-only CALL-E prerequisites are available, perform one bounded live provider acceptance test and record only observed results.
