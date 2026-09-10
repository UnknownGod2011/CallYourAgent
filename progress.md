# CallYourAgent progress

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. Agents can escalate important decisions without freezing unrelated scopes; owners can independently request callbacks for progress/questions/steering; human input is persisted as structured state and consumed only at explicit safe checkpoints rather than pretending to interrupt in-flight model generation.

The repository includes deterministic fake and production CALL-E providers, SQLite persistence, replayable/idempotent call attempts, polling/webhook convergence, branch-scoped blocking, owner decision persistence, durable per-run instruction queues with exact acknowledgement, quiet hours/call budgets, bounded lifecycle recovery, fail-closed ambiguous/stalled handling, privacy-aware audit history, scoped HTTP authentication, a typed TypeScript client, a real stdio MCP adapter, deterministic end-to-end/demo flows, an operator console, a Claude Code host-acceptance runbook, and a single-instance persistent-volume Compose reference deployment.

This run continued the HTTP transport-validation audit. PR #36 makes `checkpoint.consume` type-safe at runtime instead of silently interpreting any supplied value other than literal `true` as `false`. Omitted `consume` remains non-consuming for compatibility, while a supplied value must now be boolean before the control plane is invoked.

## Exact repo state inspected this run

The run started from `main` HEAD `c12a31fa4c19ad9493110b50d4ebba8f2e3bd725`, the progress handoff after PR #35 (`492f2fc6a9f2453cb0865c15a9fe447494bdf10d`).

Before any change, inspected the complete recursive repository tree and current source/test inventory, recent commits, current issue state, and recent pull requests. There were no open issues and no pre-existing open pull requests.

Read in full during the mandatory pre-implementation audit:

- `AGENTS.md`
- `progress.md`
- `README.md`
- `docs/ARCHITECTURE.md`
- `docs/INTEGRATIONS.md`
- `docs/API_SECURITY.md`
- `docs/CALL_POLICY.md`
- `docs/CLAUDE_CODE_ACCEPTANCE.md`
- `docs/DEPLOYMENT.md`
- `docs/OPERATOR_CONSOLE.md`
- `docs/PROVIDER_RESTART_SEMANTICS.md`
- `deploy/README.md`

Also inspected `src/http-server.ts`, `src/store.ts`, `src/domain.ts`, `tests/http-server.test.ts`, `package.json`, and the full test inventory before modifying repository content.

The inspection found that `POST /v1/runs/:runId/checkpoint` passed `value.consume === true` directly to `ControlPlane.checkpoint`. An untyped network caller could therefore send `consume: "true"`, `consume: 1`, `consume: null`, an array, or an object; the adapter silently treated every one as `false`. That ambiguity is especially undesirable on the safe-checkpoint boundary because a caller could believe it requested consumption while durable owner steering remained queued, or malformed input could be accepted without revealing the integration bug.

A local clone was not required for the change; as in the previous run, the automation container's direct GitHub DNS path remains unreliable, so GitHub Actions was used as the authoritative executable verification path.

## Changes made this run

PR #36, `Validate checkpoint consume input`, changed `src/http-server.ts` and added `tests/http-checkpoint-consume-validation.test.ts`.

The HTTP checkpoint boundary now:

1. distinguishes an omitted `consume` from a supplied malformed value;
2. preserves omission as the existing non-consuming default (`false`);
3. accepts literal `true` and `false` as the only supplied forms;
4. rejects any supplied non-boolean value with the existing stable privacy-safe HTTP 400 contract, `consume must be boolean`;
5. performs that validation before invoking `ControlPlane.checkpoint`, so malformed transport input cannot change durable instruction state;
6. preserves the preferred two-phase integration model: pull without consumption, incorporate steering at a safe work boundary, then acknowledge exact instruction ids;
7. leaves the control-plane state machine, fake/live providers, SDK/MCP semantics, and branch-scoped blocking model unchanged.

The new deterministic regressions seed a real queued `OwnerInstruction`, submit malformed `consume` values (`"true"`, `1`, `null`, array, object), and prove every request returns 400 while the instruction remains `queued`. A compatibility regression proves an omitted value remains non-consuming, then proves literal `true` returns the queued instruction and transitions it to `consumed`.

PR #36 was squash-merged into `main` as `15d107eb1b620195aad14dcf3e9feb2cd1dec4b7`.

## Verification performed

Authoritative final verification ran against PR head `12ea34cde26142b9ea3d3627982b6fb35f994eed`:

- CI run `34523742915` — **success** on Node 24.20.0. Locked dependency installation succeeded, TypeScript typecheck succeeded, build succeeded, and **182/182 tests passed**, 0 failures. Both new checkpoint-consume regressions passed.
- Container run `34523742838` — **success**. The production image/runtime path remained green.
- Compose deployment run `34523742844` — **success**. The production-style durable SQLite + scoped credentials + compiled MCP + restart + branch-scoped decision + owner callback + exactly-once steering + safe-checkpoint acceptance path remained green.

`package.json` still has no separate lint script and no standalone migration/schema-check command. `npm run check` covers typecheck, build, and tests; SQLite regressions exercise schema/transaction durability, and Container/Compose cover packaged runtime/deployment behavior.

No live CALL-E phone call was attempted or claimed.

## Architecture decisions made this run

1. Optional transport fields still require exact runtime types when supplied. Omission may carry a documented default, but malformed presence must not silently coerce to that default.
2. The checkpoint boundary is safety-sensitive because it mediates durable human steering. Rejecting malformed `consume` before `ControlPlane.checkpoint` makes integration mistakes visible without inventing a second state machine.
3. Omitted `consume` remains `false` for compatibility and because the preferred integration flow is already non-consuming pull followed by exact acknowledgement after the agent actually incorporates the instruction.
4. Literal `true` remains supported as the legacy compatibility consumption path; this increment does not remove or redefine that behavior.
5. Client-correctable malformed input receives a stable privacy-safe 400, while unexpected runtime/domain failures remain behind the fail-closed `500 internal_error` boundary.

## CALL-E integration status

- **Fake provider:** deterministic, credential-free, idempotent, restart-rehydratable, and still the primary full-flow development/acceptance provider.
- **Production CALL-E adapter:** implemented against the asynchronous Calls API with server-only `CALLE_API_KEY`, stable provider `Idempotency-Key`, structured result schemas, bounded create/poll requests, persisted correlation, polling/webhook convergence, duplicate prevention, restart-by-provider-id semantics, privacy-safe diagnostics, and fail-closed ambiguous/stalled handling.
- **Control-plane idempotency:** decision and callback keys remain payload-bound; exact retries remain no-op replays; changed-payload reuse is rejected; SQLite race coverage proves the durable first binding wins before provider I/O.
- **Public webhook configuration:** live runtime requires an exact HTTPS origin and structurally constructs the tokenized webhook target. Application request handling strips the capability token from `IncomingMessage.url`; reverse-proxy/CDN/APM query-string redaction remains mandatory.
- **Shared integration surfaces:** HTTP, TypeScript SDK, stdio MCP, lifecycle worker, operator console, and deployment acceptance continue sharing the same persistent control-plane state machine.
- **Checkpoint semantics:** malformed HTTP `consume` values now fail before state mutation; omitted/non-consuming pull plus exact acknowledgement remains the recommended integration model.
- **Claude Code:** compiled stdio MCP behavior remains covered automatically and through Compose acceptance. A genuine Claude Code host session has still not been observed and is not claimed.
- **Live status:** no authorized real CALL-E phone call has been performed, so live provider connectivity, owner-phone authorization, and externally reachable webhook delivery remain unverified.

## Current blockers / external prerequisites

No repository-development blocker prevents further useful work.

A true Claude Code host acceptance still requires an actual Claude Code environment/CLI to register and exercise the compiled stdio MCP server.

Live CALL-E verification still requires user-controlled prerequisites: a valid/authorized CALL-E credential, an authorized owner phone destination, and a stable externally reachable HTTPS origin whose ingress does not log the webhook capability query string.

The SQLite reference topology remains intentionally single-instance. Multi-instance/distributed guarantees require a future shared transactional store and shared limiter that preserve the current uniqueness/idempotency semantics.

## Highest-value next actions

1. Continue the HTTP query-boundary audit, especially `GET /v1/runs/:runId/audit?limit=...`: reject duplicate `limit` parameters and malformed/coercive numeric forms with a stable 400 instead of relying on first-value-wins `URLSearchParams.get` plus JavaScript `Number(...)` coercion.
2. Review other request/query cardinality assumptions for duplicate parameters or malformed values that can be rejected before domain work without changing valid SDK/MCP contracts.
3. Review live-runtime environment validation ordering for settings that can still fail only after durable storage opens, and move safe pure validation earlier where appropriate.
4. Continue least-privilege review of owner/operator/reconciler surfaces without widening browser or normal-agent credentials.
5. Add explicit store-contract tests before introducing any Postgres/multi-instance deployment so atomic idempotency winner-selection remains a required adapter property.
6. Run the documented acceptance in a genuine Claude Code host when that external prerequisite is available and record only observed host/version behavior.
7. When the user-controlled CALL-E prerequisites are available, perform one tightly bounded live provider acceptance and record only observed behavior.
