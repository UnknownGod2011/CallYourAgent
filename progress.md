# CallYourAgent progress

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. Agents can escalate important decisions without freezing unrelated scopes; owners can independently request callbacks for progress/questions/steering; human input is persisted as structured state and consumed only at explicit safe checkpoints rather than pretending to interrupt in-flight model generation.

The repository includes deterministic fake and production CALL-E providers, SQLite persistence, replayable/idempotent call attempts, polling/webhook convergence, branch-scoped blocking, owner decision persistence, durable per-run instruction queues with exact acknowledgement, quiet hours/call budgets, bounded lifecycle recovery, fail-closed ambiguous/stalled handling, privacy-aware audit history, scoped HTTP authentication, a typed TypeScript client, a real stdio MCP adapter, deterministic end-to-end/demo flows, an operator console, a Claude Code host-acceptance runbook, and a single-instance persistent-volume Compose reference deployment.

This run continued the HTTP transport-validation audit. PR #39 established a canonical authenticated `/v1` query contract: API routes reject undocumented query parameters, while the audit timeline remains the only current `/v1` route allowed to receive its documented `limit` query parameter.

## Exact repo state inspected this run

The run started from `main` HEAD `33c9d8e0db881161e27073f7f410250d2d4ee760`, the progress handoff after PR #38 (`d46164c53659757cb2dc163713741bd554cc597d`).

Before making any change, inspected the complete recursive repository tree and current architecture/source/test inventory, recent commits, open issue state, and open pull requests. There were no open issues and no pre-existing open pull requests.

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

Also inspected `src/http-server.ts`, `src/server.ts`, the current HTTP validation tests, and the recent transport/idempotency/concurrency commits before modifying repository content.

The inspection confirmed that `GET /v1/runs/:runId/audit` explicitly validates `limit`, but every other authenticated `/v1` route silently ignored arbitrary query parameters. This made ambiguous forms such as `/v1/callbacks?dryRun=true` or `/v1/runs/:id?debug=...` look meaningful to a caller despite having no contract semantics. It also meant callback requests with such parameters could proceed into body parsing and rate-limit consumption instead of failing at the transport boundary.

The automation container's direct GitHub DNS path remained unavailable for a local clone, so GitHub Actions was used as the authoritative executable verification path.

## Changes made this run

PR #39, `Reject undocumented API query parameters`, changed `src/http-server.ts` and added `tests/http-query-parameter-validation.test.ts`.

The authenticated HTTP boundary now:

1. rejects any query parameter on `/v1` routes unless the route explicitly allows it;
2. currently allows only the documented `limit` key on `GET /v1/runs/:runId/audit`;
3. returns stable HTTP `400 {"error":"unexpected_query_parameter"}` for undocumented query keys;
4. never reflects the query key or attacker-controlled query value in the response;
5. performs this validation after authentication but before JSON body parsing, domain work, or callback/reconciliation side-effect-adjacent controls;
6. therefore prevents malformed callback query traffic from consuming callback rate-limit budget;
7. preserves the existing audit `limit` cardinality/value validation, canonical queryless routes, webhook capability-token handling, branch-scoped blocking, fake/live providers, MCP/SDK contracts, and safe-checkpoint semantics.

The deterministic regressions prove that an undocumented run query is rejected without reflecting its value, the canonical queryless request still reaches normal domain behavior, audit accepts `limit` but rejects an additional `cursor`, and a malformed callback query fails before deliberately invalid JSON is parsed and before the configured callback rate-limit slot is consumed.

PR #39 was squash-merged into `main` as `3d3d94e9da52a190ce75041eda784253b64269d8`.

## Verification performed

Authoritative final verification ran against PR head `fd728c0bc5d1f6ff8cbc0cfcb3799d104a82d5de`:

- CI run `34540637199` — **success** on Node 24.20.0. Locked dependency installation succeeded, TypeScript typecheck succeeded, build succeeded, and **190/190 tests passed**, 0 failures. All three new HTTP query-boundary regressions passed.
- Container run `34540637191` — **success**. The production image/runtime path remained green.
- Compose deployment run `34540637215` — **success**. Scoped credential generation and capability checks passed; the compiled stdio MCP adapter worked against the deployed control plane; a durable branch-blocking owner decision survived restart and released only the affected branch; a context-aware owner callback survived restart; reconciliation queued steering exactly once; another restart preserved that steering; and the instruction was consumed only at an explicit safe checkpoint.

`package.json` still has no separate lint script and no standalone migration/schema-check command. `npm run check` covers typecheck, build, and tests; SQLite regressions exercise schema/transaction durability, and Container/Compose cover packaged runtime/deployment behavior.

No live CALL-E phone call was attempted or claimed.

## Architecture decisions made this run

1. Authenticated `/v1` query parameters are an explicit transport contract rather than an open extension surface: undocumented keys fail closed instead of being silently ignored.
2. Audit `limit` remains explicitly allowlisted and still owns its stricter singleton/cardinality/value validation.
3. Query validation occurs after authentication so public unauthenticated behavior is not widened, but before body parsing, domain operations, and request-budget consumption so malformed authenticated traffic cannot trigger deeper work.
4. Validation responses are privacy-safe and do not echo attacker-controlled query names or values.
5. The CALL-E webhook capability query remains a separate, intentionally supported ingress contract and continues to be extracted/redacted before normal request handling.
6. Valid canonical requests still delegate to the same control-plane state machine; this change adds no adapter-specific business logic.

## CALL-E integration status

- **Fake provider:** deterministic, credential-free, idempotent, restart-rehydratable, and still the primary full-flow development/acceptance provider.
- **Production CALL-E adapter:** implemented against the asynchronous Calls API with server-only `CALLE_API_KEY`, stable provider `Idempotency-Key`, structured result schemas, bounded create/poll requests, persisted correlation, polling/webhook convergence, duplicate prevention, restart-by-provider-id semantics, privacy-safe diagnostics, and fail-closed ambiguous/stalled handling.
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

1. Harden runtime numeric environment parsing in `src/server.ts`: `Number(...)` currently accepts coercive forms such as whitespace, leading `+`, exponent notation, and leading-zero variants. Define canonical decimal syntax for ports, hours, limits, intervals, and timeout settings while preserving legitimate zero-vs-positive semantics, and prove invalid configuration fails before durable SQLite initialization where applicable.
2. Continue the HTTP boundary audit for request-body object shape/extraneous-field assumptions only where ambiguity could cause a real integration mistake; avoid rejecting harmless forward-compatible fields without a clear contract reason.
3. Continue least-privilege review of owner/operator/reconciler surfaces without widening browser or normal-agent credentials.
4. Add explicit store-contract tests before introducing any Postgres/multi-instance deployment so atomic idempotency winner-selection remains a required adapter property.
5. Run the documented acceptance in a genuine Claude Code host when that external prerequisite is available and record only observed host/version behavior.
6. When the user-controlled CALL-E prerequisites are available, perform one tightly bounded live provider acceptance and record only observed behavior.
