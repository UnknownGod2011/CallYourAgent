# CallYourAgent progress

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. Agents can escalate important decisions without freezing unrelated scopes; owners can independently request callbacks for progress/questions/steering; human input is persisted as structured state and consumed only at explicit safe checkpoints rather than pretending to interrupt in-flight model generation.

The repository includes deterministic fake and production CALL-E providers, SQLite persistence, replayable/idempotent call attempts, polling/webhook convergence, branch-scoped blocking, owner decision persistence, durable per-run instruction queues with exact acknowledgement, quiet hours/call budgets, bounded lifecycle recovery, fail-closed ambiguous/stalled handling, privacy-aware audit history, scoped HTTP authentication, a typed TypeScript client, a real stdio MCP adapter, deterministic end-to-end/demo flows, an operator console, a Claude Code host-acceptance runbook, and a single-instance persistent-volume Compose reference deployment.

This run continued the HTTP transport-validation audit. PR #37 hardened `GET /v1/runs/:runId/audit?limit=...` so query cardinality and numeric syntax are explicit rather than relying on first-value-wins `URLSearchParams.get()` and JavaScript numeric coercion.

## Exact repo state inspected this run

The run started from `main` HEAD `7b2341d80d2f66eb3dccb193e9e1acfc64a0665c`, the progress handoff after PR #36 (`15d107eb1b620195aad14dcf3e9feb2cd1dec4b7`).

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

Also inspected `src/http-server.ts`, `tests/http-server.test.ts`, the complete source/test inventory, and the existing audit-limit domain error contract before modifying repository content.

The inspection confirmed that the audit endpoint used `url.searchParams.get("limit")` followed by `Number(rawLimit)`. That allowed duplicate query parameters to silently use the first value and accepted coercive forms such as empty strings/whitespace, scientific notation, signed input, and padded decimals before the domain limit check. This was a transport ambiguity rather than a control-plane state-machine problem.

The automation container's direct GitHub DNS path remains unreliable for a local clone, so GitHub Actions was used as the authoritative executable verification path.

## Changes made this run

PR #37, `Harden audit limit query validation`, changed `src/http-server.ts` and added `tests/http-audit-limit-validation.test.ts`.

The HTTP audit boundary now:

1. uses `URLSearchParams.getAll("limit")` so cardinality is explicit;
2. preserves an omitted `limit` as the existing default of `100`;
3. accepts exactly one canonical unsigned decimal integer from `1` through `500`;
4. rejects duplicate `limit` parameters instead of silently selecting one;
5. rejects empty/whitespace values, zero/negative values, decimal/scientific notation, explicit plus signs, padded forms such as `050`, and values above `500`;
6. returns the existing stable privacy-safe HTTP 400 error, `Audit event limit must be an integer from 1 to 500`;
7. performs validation before run lookup/domain work, making malformed client requests distinguishable from a valid request for an unknown run;
8. leaves control-plane audit ordering/storage, branch-scoped blocking, instruction checkpoints, MCP/SDK behavior, and fake/live CALL-E orchestration unchanged.

The new deterministic HTTP regressions prove duplicate and coercive forms fail with 400 before domain lookup, while omission plus canonical boundary values `1`, `100`, and `500` pass transport validation and reach the normal unknown-run 404 domain path.

PR #37 was squash-merged into `main` as `08628aac99897b2cc8f0591f23b9656c3ecc1adf`.

## Verification performed

Authoritative final verification ran against PR head `0e39535a1a251517a219a60f002cb0c0192b3647`:

- CI run `34530184912` — **success** on Node 24.20.0. Locked dependency installation succeeded, TypeScript typecheck succeeded, build succeeded, and **185/185 tests passed**, 0 failures. All three new audit-limit regressions passed.
- Container run `34530184892` — **success**. The production image/runtime path remained green.
- Compose deployment run `34530184818` — **success**. The production-style durable SQLite + scoped credentials + compiled MCP + restart + branch-scoped decision + owner callback + exactly-once steering + safe-checkpoint acceptance path remained green.

`package.json` still has no separate lint script and no standalone migration/schema-check command. `npm run check` covers typecheck, build, and tests; SQLite regressions exercise schema/transaction durability, and Container/Compose cover packaged runtime/deployment behavior.

No live CALL-E phone call was attempted or claimed.

## Architecture decisions made this run

1. Query parameters that alter data cardinality are part of the typed transport contract and should not rely on JavaScript coercion.
2. Duplicate singleton query parameters fail closed. First-value-wins behavior is ambiguous across clients/proxies and can hide integration mistakes.
3. Audit limit syntax is intentionally canonical decimal rather than accepting multiple textual representations of the same number; this keeps HTTP behavior deterministic while preserving the documented numeric range.
4. Omission remains a documented default (`100`), so existing SDK/MCP/operator calls without a limit are unchanged.
5. Malformed client-correctable input receives a stable privacy-safe 400, while valid requests continue into the existing domain/not-found behavior and unexpected failures remain behind `500 internal_error`.

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

1. Continue the HTTP boundary audit with malformed percent-encoding in path identifiers: `decodeURIComponent(...)` failures currently fall through the generic exception path and should become a stable client-correctable 400 without echoing attacker-controlled path material.
2. Review remaining singleton query/cardinality assumptions and reject ambiguous duplicate parameters before domain work where applicable.
3. Review live-runtime environment validation ordering for settings that can still fail only after durable storage opens, moving safe pure validation earlier where appropriate.
4. Continue least-privilege review of owner/operator/reconciler surfaces without widening browser or normal-agent credentials.
5. Add explicit store-contract tests before introducing any Postgres/multi-instance deployment so atomic idempotency winner-selection remains a required adapter property.
6. Run the documented acceptance in a genuine Claude Code host when that external prerequisite is available and record only observed host/version behavior.
7. When the user-controlled CALL-E prerequisites are available, perform one tightly bounded live provider acceptance and record only observed behavior.
