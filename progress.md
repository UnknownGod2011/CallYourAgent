# CallYourAgent progress

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. Agents can escalate important decisions without freezing unrelated scopes; owners can independently request callbacks for progress/questions/steering; human input is persisted as structured state and consumed only at explicit safe checkpoints rather than pretending to interrupt in-flight model generation.

The repository includes deterministic fake and production CALL-E providers, SQLite persistence, replayable/idempotent call attempts, polling/webhook convergence, branch-scoped blocking, owner decision persistence, durable per-run instruction queues with exact acknowledgement, quiet hours/call budgets, bounded lifecycle recovery, fail-closed ambiguous/stalled handling, privacy-aware audit history, scoped HTTP authentication, a typed TypeScript client, a real stdio MCP adapter, deterministic end-to-end/demo flows, an operator console, a Claude Code host-acceptance runbook, and a single-instance persistent-volume Compose reference deployment.

This run hardened owner-callback HTTP rate-limit ordering. PR #41 now validates an authenticated callback request's JSON object shape and required/optional callback fields before consuming the credential's callback rate-limit slot. Malformed callback requests therefore cannot burn legitimate owner callback capacity, while well-formed callback attempts retain the existing accounting semantics before domain execution.

## Exact repo state inspected this run

The run started from `main` HEAD `c5419f3448f0bda78659754b8e21fac4fcd6bb4d`, the progress handoff after PR #40 (`82e166865bc7b00860c2056c80379c1a479ff245`).

Before making any change, inspected the complete recursive repository tree and current source/test architecture, recent commits, issue state, and recent pull requests. There were no open issues and no pre-existing open pull requests. The recursive Git tree was not truncated.

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

Also inspected the complete `src/` and `tests/` inventory, the current `src/http-server.ts` request-validation/rate-limit ordering, `tests/http-query-parameter-validation.test.ts`, `tests/http-server.test.ts`, and recent HTTP validation/idempotency/concurrency changes before modifying repository content.

The audit found that `POST /v1/callbacks` authenticated the owner credential correctly, but then consumed the owner callback rate-limit slot before validating that the already-parsed JSON body was an object and before validating `runId`, `idempotencyKey`, and optional `prompt`. Thus a syntactically valid but structurally invalid callback body could consume legitimate callback capacity even though it could never create a callback.

The automation container's direct GitHub DNS path remained unavailable for a local clone, so GitHub Actions was again used as the authoritative executable verification path.

## Changes made this run

PR #41, `Validate owner callbacks before rate-limit consumption`, changed `src/http-server.ts` and added `tests/http-callback-rate-limit-validation.test.ts`.

The callback route now uses this ordering:

1. authenticate the credential and require `owner:callback` as before;
2. validate that the body is a JSON object;
3. validate required non-empty `runId` and `idempotencyKey` strings and the optional `prompt` string;
4. consume the per-credential callback rate-limit slot;
5. invoke the existing `ControlPlane.requestOwnerCallback(...)` operation.

This preserves two important existing semantics:

- authorization remains ahead of callback field validation, so a credential without `owner:callback` does not gain a request-validation oracle;
- a well-formed callback request still consumes API abuse-budget capacity before domain execution, even if the referenced run later proves nonexistent or another normal domain precondition rejects it.

The deterministic regression sets callback capacity to one request per window, sends a malformed callback body and proves it returns the existing privacy-safe `400` validation error, then sends a well-formed request and proves it reaches the domain (`404 not_found` for the intentionally unknown run), and finally proves the next well-formed request receives `429 rate_limited`. This demonstrates both sides of the ordering contract.

PR #41 was squash-merged into `main` as `3c654b4e7c5452123ecd69d5177d0b00848a48c9`.

## Verification performed

Authoritative final verification ran against PR head `57454fcf34faf705601caf419e6a23e905a19488`:

- CI run `34549331405` — **success** on Node 24.20.0. Locked dependency installation succeeded, TypeScript typecheck succeeded, build succeeded, and **194/194 tests passed**, 0 failures. The new `invalid callback bodies do not consume owner callback rate-limit budget` regression passed.
- Container run `34549331446` — **success**. The production image/runtime path remained green.
- Compose deployment run `34549332147` — **success**. Compose configuration and fake-provider boot passed; generated scoped credential capabilities were verified; the compiled stdio MCP adapter worked against the deployed control plane; a durable branch-blocking owner decision survived restart and released only its affected branch; an owner requested a context-aware callback; that active callback survived restart; reconciliation queued steering exactly once; another restart preserved the queued steering; and steering was consumed only at an explicit safe checkpoint after restart.

`package.json` still has no separate lint script and no standalone migration/schema-check command. `npm run check` covers typecheck, build, and tests; SQLite regressions exercise schema/transaction durability, while Container/Compose cover packaged runtime and deployment behavior.

No live CALL-E phone call was attempted or claimed.

## Architecture decisions made this run

1. API abuse-rate capacity should be spent on requests that have crossed the route's transport contract, not on malformed callback bodies that cannot possibly represent a callback operation.
2. Authorization remains before detailed request validation. Least-privilege callers without `owner:callback` continue receiving authorization failure rather than field-level validation feedback.
3. Transport validation remains separate from domain validation: once a callback request is structurally well formed, it consumes the callback rate-limit slot before the control plane evaluates run existence/state or other domain semantics.
4. No new limiter, state machine, provider behavior, or platform-specific rule was introduced. The change is only ordering at the existing HTTP boundary.
5. MCP, TypeScript SDK, fake/live provider behavior, idempotency bindings, branch-scoped blocking, durable callback state, and safe-checkpoint instruction semantics remain unchanged.

## CALL-E integration status

- **Fake provider:** deterministic, credential-free, idempotent, restart-rehydratable, and still the primary full-flow development/acceptance provider.
- **Production CALL-E adapter:** implemented against the asynchronous Calls API with server-only `CALLE_API_KEY`, stable provider `Idempotency-Key`, structured result schemas, bounded create/poll requests, persisted correlation, polling/webhook convergence, duplicate prevention, restart-by-provider-id semantics, privacy-safe diagnostics, and fail-closed ambiguous/stalled handling.
- **Owner callback HTTP boundary:** malformed authenticated callback bodies now fail validation without consuming owner callback capacity; valid requests retain the existing process-local rate-limit semantics.
- **Control-plane idempotency:** decision and callback keys remain payload-bound; exact retries remain no-op replays; changed-payload reuse is rejected; SQLite race coverage proves the durable first binding wins before provider I/O.
- **Public webhook configuration:** live runtime requires an exact HTTPS origin and structurally constructs the tokenized webhook target. Application request handling strips the capability token from `IncomingMessage.url`; reverse-proxy/CDN/APM query-string redaction remains mandatory.
- **Shared integration surfaces:** HTTP, TypeScript SDK, stdio MCP, lifecycle worker, operator console, and deployment acceptance continue sharing the same persistent control-plane state machine.
- **Checkpoint semantics:** human steering remains durable queued state consumed only at explicit safe work boundaries; non-consuming pull plus exact acknowledgement remains the recommended integration model.
- **Claude Code:** compiled stdio MCP behavior remains covered automatically and through Compose acceptance. A genuine Claude Code host session has still not been observed and is not claimed.
- **Live status:** no authorized real CALL-E phone call has been performed, so live provider connectivity, owner-phone authorization, and externally reachable webhook delivery remain unverified.

## Current blockers / external prerequisites

No repository-development blocker prevents further useful work.

A true Claude Code host acceptance still requires an actual Claude Code environment/CLI to register and exercise the compiled stdio MCP server.

Live CALL-E verification still requires user-controlled prerequisites: a valid/authorized CALL-E credential, an authorized owner phone destination, and a stable externally reachable HTTPS origin whose ingress does not log the webhook capability query string.

The SQLite reference topology remains intentionally single-instance. Multi-instance/distributed guarantees require a future shared transactional store and shared limiter that preserve the current uniqueness/idempotency semantics.

## Highest-value next actions

1. Continue the HTTP request-body audit for remaining semantic boundaries, especially required text normalization/identity fields and instruction acknowledgement edge cases, while avoiding needless rejection of harmless forward-compatible fields.
2. Audit runtime string enums and operational text settings for whitespace/case ambiguity (`CYA_CALL_PROVIDER`, `CYA_STORE`, priority settings, timezone inputs, provider base URL) and harden only cases where ambiguous text can select the wrong operational mode or produce confusing startup behavior.
3. Add explicit store-adapter contract tests for uniqueness/atomic winner-selection before any Postgres or multi-instance store is introduced, so current SQLite idempotency guarantees become mandatory for future adapters.
4. Continue least-privilege review of owner/operator/reconciler surfaces without widening browser or normal-agent credentials.
5. Run the documented acceptance in a genuine Claude Code host when that external prerequisite is available and record only observed host/version behavior.
6. When the user-controlled CALL-E prerequisites are available, perform one tightly bounded live provider acceptance and record only observed behavior.
