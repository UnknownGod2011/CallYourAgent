# CallYourAgent progress

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. Agents can raise important owner decisions without freezing unrelated scopes; owners can independently request callbacks for progress/questions/steering; human input is persisted and consumed only at explicit safe checkpoints rather than pretending to interrupt in-flight model generation.

The repository includes SQLite persistence, deterministic fake and production CALL-E providers, replayable/idempotent call attempts, typed active-provider observations, polling/webhook convergence, scoped authenticated HTTP APIs, a typed TypeScript client, stdio MCP, branch-scoped blocking, call policy/quiet hours/budgets, privacy-aware audit history, bounded lifecycle recovery, fail-closed ambiguous/stalled handling, API abuse controls, graceful shutdown, bounded CALL-E HTTP requests, readiness/liveness surfaces, deterministic end-to-end and operator demos, a production Docker image, and a single-instance persistent-volume Compose deployment.

This run added an opt-in deterministic auto-completion capability to the fake CALL-E provider. The capability is disabled by default and does not expose a fake/admin mutation HTTP endpoint. It allows a separately running runtime/container to eventually exercise terminal fake-provider outcomes through the same provider observation/reconciliation path used by the control plane. New tests prove that a blocking branch decision resolves normally and that an owner callback becomes durable queued steering consumed only through checkpoint + exact acknowledgement.

## Exact repo state inspected this run

The run started from `main` HEAD `223a9dd67a881890289b9e45916600840e0474df`.

Before making changes, inspected the complete recursive repository tree and current architecture, including root configuration, all GitHub Actions workflows, deployment assets, documentation, source modules, and the complete test inventory. The recursive Git tree response was not truncated. Inspected recent commits through the scoped Compose deployment acceptance. Checked repository issues and pull requests; there were no open issues or pull requests.

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

Also inspected the relevant implementation/deployment surfaces, including `.github/workflows/compose.yml`, `deploy/compose.yml`, `src/call-provider.ts`, `src/server.ts`, `src/http-server.ts`, `src/domain.ts`, and representative fake-provider/callback tests.

The previous run's highest-value next action was to extend deployment-level fake-provider acceptance into a real branch-scoped decision + owner-callback + safe-checkpoint steering flow without adding a demo-only production mutation endpoint. Inspection found the concrete missing primitive: a fake call in a separately running container could only become terminal through the in-process `FakeCallProvider.complete` helper. The normal HTTP reconciliation route could poll it, but there was no external provider state change, and exposing a fake-provider mutation endpoint would weaken the production surface merely for CI/demo purposes.

## Changes made this run

### Opt-in deterministic fake-provider auto-completion

Updated `FakeCallProvider` with an optional `autoCompleteAfterObservations` setting.

Behavior:

- the setting is disabled by default, preserving all existing explicit fake-provider tests and demos;
- when configured, it must be a positive integer;
- each accepted fake call records its purpose and observation count;
- once the configured observation threshold is reached, `observe()` returns a deterministic terminal `completed` outcome;
- owner-decision calls receive a deterministic structured `proceed` decision;
- owner-callback calls receive one deterministic steering instruction;
- provider idempotency behavior and the existing manual `progress()` / `complete()` helpers remain unchanged.

The intent is narrow: let a real separately running fake-provider deployment progress through normal polling/reconciliation without giving HTTP clients a provider-mutation backdoor. The HTTP control plane remains the only public application boundary.

### Regression coverage

Added `tests/fake-provider-auto-completion.test.ts` covering three invariants:

1. A blocking escalation in `release-approval` initially appears in `unresolvedBlockingScopes` while the independent `currentScope` remains active. Normal escalation reconciliation observes the deterministic fake terminal result, persists the owner decision, and releases only the blocked scope.
2. An owner callback reconciles through the same provider interface into one durable queued owner instruction. A non-consuming checkpoint returns it, exact instruction acknowledgement marks it consumed, and the following checkpoint is empty.
3. Auto-completion remains disabled by default, and invalid non-positive observation thresholds fail validation.

Implementation/fix commits before this progress update:

- `1e58d4c922e9d78083c49a65efccac91c5d28639` — `feat: support opt-in fake provider auto completion`
- `f1e23aec0862ef038965cbd8485bed2fe939ae1f` — `test: cover fake provider auto completion`
- `a081599eec37e1f13a99ecc5a6f07ffa0c74cf09` — `test: fix fake auto completion assertions`

## Verification performed

The automation environment did not provide a local repository checkout suitable for running Node tooling directly, so no local build/test claim was fabricated. Executable verification used the repository's GitHub Actions workflows.

The first test-bearing commit `f1e23aec0862ef038965cbd8485bed2fe939ae1f` failed CI run `34242469269` during TypeScript typechecking. The new test incorrectly assumed `ControlPlane.reconcileEscalation()` returned an object containing `.escalation` and `.decision`; the production API actually returns the reconciled `Escalation` directly. This was a test-authoring mistake, not a production regression. The test was corrected to assert the returned escalation and retrieve the persisted decision through `getDecision()`.

The corrected implementation/test state at commit `a081599eec37e1f13a99ecc5a6f07ffa0c74cf09` passed every available verification surface:

- CI run `34242583001` — success. Node 24 locked install, TypeScript typecheck, build/test path, including the new fake auto-completion tests, completed successfully.
- Container run `34242582905` — success. Production image build and deterministic fake-provider runtime smoke completed successfully.
- Compose deployment run `34242582870` — success. The existing scoped-credential + persistent SQLite deployment smoke completed successfully on the new code state.

`package.json` still has no separate lint script and no standalone migration/schema-check command. The available executable verification remains CI typecheck/build/test plus Container and Compose deployment workflows.

No live CALL-E phone call was attempted or claimed.

## Architecture decisions made this run

1. Fake-provider deployment acceptance should not require a production HTTP endpoint that mutates provider state. Test/demo conveniences must stay behind the provider abstraction rather than widening the public control-plane attack surface.
2. Deterministic fake auto-completion is opt-in. Existing tests that need precise queued/in-progress/ambiguous timing retain manual provider control, so this feature does not silently alter fake-provider semantics repository-wide.
3. Auto-completion occurs from `observe()` rather than `start()`. That preserves the asynchronous architecture: call creation first persists/accepts a side effect, and terminal evidence is discovered later through the same reconciliation shape used for real CALL-E polling.
4. The deterministic terminal result is purpose-aware: an owner decision creates structured decision evidence, while an owner callback creates queued steering. Both still flow through the existing single terminal-transition implementation in `ControlPlane`.
5. The test explicitly preserves branch semantics: a blocking owner decision blocks only its scope while an independent current scope remains active.
6. Callback steering remains durable `queued` state until the agent reaches a safe checkpoint and explicitly acknowledges the exact instruction id. No mid-token or in-flight model interruption capability was introduced or claimed.
7. No production CALL-E request/webhook/idempotency contract, credential scope, persistence schema, call policy, ambiguity handling, or stalled-call behavior changed in this run.

## CALL-E integration status

- Fake provider: deterministic and tested for decisions, callbacks, branch-scoped blocking, durable steering, idempotency, ambiguous recovery, active-state progress, stale downgrade rejection, bounded stale detection, restart durability, auditability, HTTP/TypeScript/MCP integration, operator demos, privacy boundaries, generated least-privilege roles, scoped-only Compose deployment, and now optional observation-driven terminal completion suitable for a separately running fake deployment.
- Production CALL-E adapter: implemented with server-only `CALLE_API_KEY`, idempotent create, structured result schemas, active-state observation, terminal polling/webhook convergence, bounded requests, exact-key ambiguous recovery, duplicate prevention, and fail-closed stalled handling.
- HTTP + TypeScript SDK + MCP continue to share the same control-plane services and durable state machine. This run changed the fake provider/test infrastructure only; it did not create an alternate application state machine.
- Live CALL-E success remains unverified; no real authorized phone call was made.

## Current blockers / external prerequisites

No repository-development blocker prevents further useful work.

Live CALL-E verification still requires user-controlled prerequisites: a valid/authorized CALL-E credential, authorized owner phone destination, and stable public HTTPS webhook ingress configured with the application-owned webhook capability token.

Real Claude Code host acceptance still requires running the documented stdio MCP workflow in an actual Claude Code environment. Repository-side MCP behavior is tested through the official MCP client/server packages and the real authenticated HTTP boundary; host acceptance must not be fabricated.

## Highest-value next actions

1. Wire the opt-in fake observation-completion threshold into `src/server.ts` as a fake-only validated environment setting, pass it through the reference Compose deployment, and enable it only in the Compose acceptance workflow.
2. Extend the Compose acceptance to prove the complete public-boundary story under the four separate scoped credentials: agent creates a branch-blocking decision while unrelated scope stays active; reconciler obtains deterministic terminal provider evidence; agent consumes the durable owner decision; owner requests a context-aware callback; reconciler completes it; callback steering survives as queued state; agent reads it only at a safe checkpoint and acknowledges the exact instruction id.
3. Prefer a restart between terminal callback reconciliation and instruction acknowledgement so the deployment acceptance also proves queued steering survives the actual SQLite/container restart path.
4. Audit generated workflow/environment secret handling for unnecessary echo/log exposure while keeping authorization logic centralized in the HTTP control plane.
5. When an actual Claude Code host is available, run the documented stdio MCP host acceptance path with the deterministic fake provider and verify tool discovery plus checkpoint behavior from the real host.
6. When user-only CALL-E prerequisites are available, perform one bounded live provider acceptance test and record only observed results.
