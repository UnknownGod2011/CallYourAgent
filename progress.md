# CallYourAgent progress

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. Agents can escalate important decisions without freezing unrelated scopes; owners can independently request callbacks for progress/questions/steering; human input is persisted as structured state and consumed only at explicit safe checkpoints rather than pretending to interrupt in-flight model generation.

The repository includes deterministic fake and production CALL-E providers, SQLite persistence, replayable/idempotent call attempts, polling/webhook convergence, branch-scoped blocking, owner decision persistence, durable per-run instruction queues with exact acknowledgement, quiet hours/call budgets, bounded lifecycle recovery, fail-closed ambiguous/stalled handling, privacy-aware audit history, scoped HTTP authentication, a typed TypeScript client, a real stdio MCP adapter, deterministic end-to-end/demo flows, an operator console, a Claude Code host-acceptance runbook, and a single-instance persistent-volume Compose reference deployment.

This run hardened runtime numeric configuration. PR #40 replaced coercive JavaScript `Number(...)` parsing at the environment boundary with canonical unsigned decimal parsing, preserving each setting's existing zero-vs-positive/range semantics while rejecting ambiguous representations before they can affect call policy, lifecycle behavior, rate limits, provider timeouts, listening ports, or durable SQLite initialization.

## Exact repo state inspected this run

The run started from `main` HEAD `dfa12eaa26b96b541a353fc56e3fb002f1604b67`, the progress handoff after PR #39 (`3d3d94e9da52a190ce75041eda784253b64269d8`).

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

Also inspected `src/server.ts`, `tests/server-runtime.test.ts`, `tests/public-base-url.test.ts`, the complete test inventory, and the recent runtime/transport/idempotency/concurrency commits before modifying repository content.

The inspection confirmed that `src/server.ts` validated numeric ranges but parsed all numeric environment variables through JavaScript `Number(...)`. As a result, operationally ambiguous forms such as `+6`, `08`, `1e2`, whitespace-padded numbers, decimal-looking integers, and integers beyond JavaScript's safe-integer range could be accepted as configuration values. The affected surface included fake-provider thresholds, CALL-E HTTP timeout, autonomous call budgets, quiet-hour boundaries, HTTP rate limits, recovery limits/backoffs, stale-call age, lifecycle sweep interval, and `PORT`.

The automation container's direct GitHub DNS path remained unavailable for a local clone, so GitHub Actions was used as the authoritative executable verification path.

## Changes made this run

PR #40, `Harden runtime numeric environment parsing`, changed `src/server.ts` and added `tests/runtime-numeric-env-validation.test.ts`.

Runtime numeric parsing now:

1. accepts only canonical unsigned base-10 integer text: exactly `0` or a non-zero digit followed by decimal digits;
2. rejects leading/trailing whitespace, leading `+`/`-`, exponent notation, decimal notation, hexadecimal-like forms, and leading-zero variants such as `08` or `015000`;
3. rejects values beyond JavaScript's safe-integer range rather than silently accepting an imprecise `number`;
4. preserves existing semantics where `0` is valid, including zero call budgets, zero automatic-recovery attempts, quiet-hour boundary `0`, and ephemeral `PORT=0`;
5. continues requiring strictly positive values for fake auto-completion thresholds, CALL-E HTTP timeout, recovery backoffs, stale-call age, and lifecycle sweep interval;
6. continues enforcing `PORT <= 65535` and quiet-hour values `0..23`;
7. preserves the existing user-facing validation messages for each setting category;
8. validates settings before durable SQLite is opened wherever runtime construction owns the setting.

The new deterministic regressions cover canonical valid values and coercive forms across fake-provider settings, callback/reconciliation rate limits, autonomous decision-call budgets, quiet hours, recovery controls, lifecycle interval, listening port, live CALL-E HTTP timeout, and an integer larger than `Number.MAX_SAFE_INTEGER`. They additionally verify that malformed settings do not create the configured SQLite database file.

PR #40 was squash-merged into `main` as `82e166865bc7b00860c2056c80379c1a479ff245`.

## Verification performed

Authoritative final verification ran against PR head `045840580be835838a8faf6f356d0a3b200b041f`:

- CI run `34544966159` — **success** on Node 24.20.0. Locked dependency installation succeeded, TypeScript typecheck succeeded, build succeeded, and **193/193 tests passed**, 0 failures. All three new runtime numeric-configuration regressions passed.
- Container run `34544966160` — **success**. The production image/runtime path remained green.
- Compose deployment run `34544966349` — **success**. Compose validation and fake-provider boot passed; generated scoped credentials were verified; the compiled stdio MCP adapter worked against the deployed control plane; a durable branch-blocking owner decision survived restart and released only the affected branch; a context-aware owner callback survived restart; reconciliation queued steering exactly once; another restart preserved that steering; and the instruction was consumed only at an explicit safe checkpoint.
- CodeRabbit status on the PR head was successful.

`package.json` still has no separate lint script and no standalone migration/schema-check command. `npm run check` covers typecheck, build, and tests; SQLite regressions exercise schema/transaction durability, and Container/Compose cover packaged runtime/deployment behavior.

No live CALL-E phone call was attempted or claimed.

## Architecture decisions made this run

1. Numeric environment configuration is an explicit textual contract, not a JavaScript coercion surface. Equivalent-looking but noncanonical numeric strings fail closed instead of being normalized silently.
2. Canonical syntax is shared across numeric settings, while each setting keeps its own semantic range (`>=0`, `>=1`, `0..23`, or `0..65535`).
3. JavaScript safe-integer bounds are part of the runtime contract because imprecise numeric configuration is unacceptable for rate limits, retry budgets, timeouts, and lifecycle timing.
4. Existing legitimate zero semantics are preserved rather than globally forcing every setting positive.
5. Configuration that can be validated before durable storage opens remains validated before `SqliteControlPlaneStore.open(...)`; startup-only port/sweep parsing also occurs before runtime construction.
6. This is a runtime-boundary hardening change only: it does not alter the control-plane state machine, HTTP/MCP/SDK contracts, branch-scoped blocking, provider idempotency, or safe-checkpoint semantics.

## CALL-E integration status

- **Fake provider:** deterministic, credential-free, idempotent, restart-rehydratable, and still the primary full-flow development/acceptance provider.
- **Production CALL-E adapter:** implemented against the asynchronous Calls API with server-only `CALLE_API_KEY`, stable provider `Idempotency-Key`, structured result schemas, bounded create/poll requests, persisted correlation, polling/webhook convergence, duplicate prevention, restart-by-provider-id semantics, privacy-safe diagnostics, and fail-closed ambiguous/stalled handling.
- **CALL-E runtime configuration:** live HTTP timeout now shares the canonical numeric configuration boundary; malformed timeout configuration fails before SQLite is opened.
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

1. Continue the HTTP request-body boundary audit and identify fields where silent JavaScript coercion/defaulting or malformed object shape could cause a real integration mistake. Add strict runtime validation only where the contract is semantically important, without rejecting harmless forward-compatible fields by default.
2. Audit environment string enums and textual operational settings for whitespace/case ambiguity (`CYA_CALL_PROVIDER`, `CYA_STORE`, priorities/time-zone inputs, provider base URL) and harden only cases where accepting ambiguous text could select the wrong operational mode or produce confusing startup behavior.
3. Continue least-privilege review of owner/operator/reconciler surfaces without widening browser or normal-agent credentials.
4. Add explicit store-contract tests before introducing any Postgres/multi-instance deployment so atomic idempotency winner-selection remains a required adapter property.
5. Run the documented acceptance in a genuine Claude Code host when that external prerequisite is available and record only observed host/version behavior.
6. When the user-controlled CALL-E prerequisites are available, perform one tightly bounded live provider acceptance and record only observed behavior.
