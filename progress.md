# CallYourAgent progress

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. Agents can escalate important decisions without freezing unrelated scopes; owners can independently request callbacks for progress/questions/steering; human input is persisted as structured state and consumed only at explicit safe checkpoints rather than pretending to interrupt in-flight model generation.

The repository includes deterministic fake and production CALL-E providers, SQLite persistence, replayable/idempotent call attempts, polling/webhook convergence, branch-scoped blocking, owner decision persistence, durable per-run instruction queues with exact acknowledgement, quiet hours/call budgets, bounded lifecycle recovery, fail-closed ambiguous/stalled handling, privacy-aware audit history, scoped HTTP authentication, a typed TypeScript client, a real stdio MCP adapter, deterministic end-to-end/demo flows, an operator console, a Claude Code host-acceptance runbook, and a single-instance persistent-volume Compose reference deployment.

This run closed an authenticated-provider transport trust-boundary gap. PR #42 now validates the optional CALL-E API base URL as an exact HTTPS origin before any server-side bearer credential can be sent. Unsafe non-HTTPS, credential-bearing, path-bearing, query-bearing, fragment-bearing, malformed, or whitespace-ambiguous values fail during runtime construction before durable SQLite initialization.

## Exact repo state inspected this run

The run started from `main` HEAD `3b241c334a887dce8ba69923fb12ed408257aa8b`, the progress handoff after PR #41 (`3c654b4e7c5452123ecd69d5177d0b00848a48c9`).

Before making any change, inspected the complete recursive repository tree and current source/test architecture. The recursive Git tree and the complete tests subtree both reported `truncated: false`. Also inspected recent commits, recent pull requests, and issue state; there were no open issues and no pre-existing open pull requests.

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

Also inspected the full `src/` and `tests/` inventories, `package.json`, `.env.example`, `src/server.ts`, `src/call-policy.ts`, `src/calle-provider.ts`, `tests/server-runtime.test.ts`, `tests/runtime-numeric-env-validation.test.ts`, and `tests/calle-provider.test.ts` before modifying repository content.

The audit found that `CALLE_BASE_URL` flowed into `CalleCallProvider` and was previously normalized only by removing one trailing slash. The provider then concatenated `/v1/calls` and sent `Authorization: Bearer <CALLE_API_KEY>` to that target. A misconfigured HTTP URL, credential-bearing URL, or URL with an unexpected path/query/fragment could therefore select an unsafe authenticated transport destination.

The automation container's direct GitHub DNS path remained unavailable for a local clone, so GitHub Actions was used as the authoritative executable verification path.

## Changes made this run

PR #42, `Harden authenticated CALL-E base URL configuration`, changed `src/calle-provider.ts` and added `tests/calle-base-url-validation.test.ts`.

`CalleCallProvider` now canonicalizes its base URL through one explicit trust boundary:

1. reject surrounding whitespace or malformed absolute URLs;
2. require the `https:` scheme;
3. reject embedded username/password credentials;
4. reject query strings;
5. reject fragments;
6. reject non-root paths so the setting is an origin rather than an arbitrary API route;
7. return the canonical `URL.origin`, preserving a harmless optional trailing slash without allowing structural ambiguity.

The documented/default production endpoint remains `https://api.heycall-e.com`. The change does not probe the network and does not alter agent-facing HTTP/MCP/SDK contracts, CALL-E idempotency, webhook handling, branch blocking, recovery, or checkpoint semantics.

New deterministic regressions prove that a canonical custom HTTPS origin is used exactly for both create and observe requests, all unsafe/ambiguous variants fail synchronously before provider I/O, and invalid live `CALLE_BASE_URL` configuration fails before the configured SQLite file is created.

PR #42 was squash-merged into `main` as `81aff0b655711a3d09f6170f92cc9577ae07dce7`.

## Verification performed

Authoritative final verification ran against PR head `239acaef52d6e063c3fa5fff09ab790713faab71`:

- CI run `34552920271` — **success** on Node 24.20.0. Locked dependency installation succeeded, TypeScript typecheck succeeded, build succeeded, and **197/197 tests passed**, 0 failures. All three new CALL-E base-URL regressions passed.
- Container run `34552920255` — **success**. The production image/runtime path remained green.
- Compose deployment run `34552920250` — **success**. Compose configuration and fake-provider boot passed; generated scoped credential capabilities were verified; the compiled stdio MCP adapter worked against the deployed control plane; a durable branch-blocking owner decision survived restart and released only its affected branch; an owner requested a context-aware callback; that active callback survived restart; reconciliation queued steering exactly once; another restart preserved the queued steering; and steering was consumed only at an explicit safe checkpoint after restart.
- CodeRabbit status — **success**.

`package.json` still has no separate lint script and no standalone migration/schema-check command. `npm run check` covers typecheck, build, and tests; SQLite regressions exercise schema/transaction durability, while Container/Compose cover packaged runtime and deployment behavior.

No live CALL-E phone call was attempted or claimed.

## Architecture decisions made this run

1. The CALL-E API base URL is a credential-transport trust boundary because the backend sends `CALLE_API_KEY` to it. It must therefore be validated more strictly than a generic user-facing URL.
2. A provider endpoint override may select a host/port for testing or deployment, but it must remain an exact HTTPS origin. Arbitrary paths, queries, fragments, embedded credentials, and non-HTTPS schemes are not accepted.
3. Unsafe live-provider configuration should fail before opening durable SQLite state. A bad transport target must not partially initialize a runtime that appears deployable.
4. Canonicalization is deliberately structural rather than network-based. Startup still makes no CALL-E request and `/ready` still does not claim provider reachability.
5. The official default endpoint and all fake-provider/control-plane semantics remain unchanged.

## CALL-E integration status

- **Fake provider:** deterministic, credential-free, idempotent, restart-rehydratable, and still the primary full-flow development/acceptance provider.
- **Production CALL-E adapter:** implemented against the asynchronous Calls API with server-only `CALLE_API_KEY`, stable provider `Idempotency-Key`, structured result schemas, bounded create/poll requests, persisted correlation, polling/webhook convergence, duplicate prevention, restart-by-provider-id semantics, privacy-safe diagnostics, fail-closed ambiguous/stalled handling, and now a strict authenticated base-URL trust boundary.
- **Provider destination safety:** optional `CALLE_BASE_URL` must be an exact HTTPS origin and is canonicalized before any authenticated request can be constructed.
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

1. Continue runtime string-configuration hardening only where ambiguity can change operational behavior: provider/store selectors, priority settings, IANA timezone text, and secret/phone whitespace handling should either be explicitly canonical or explicitly rejected rather than silently varying by field.
2. Continue the HTTP request-body semantic audit for required identity/text fields and exact instruction acknowledgement boundaries, while avoiding needless rejection of harmless forward-compatible fields.
3. Add explicit store-adapter contract tests for uniqueness, atomic winner selection, transaction rollback, and exactly-once terminal application before any Postgres or multi-instance store is introduced.
4. Continue least-privilege review of owner/operator/reconciler surfaces without widening browser or normal-agent credentials.
5. Run the documented acceptance in a genuine Claude Code host when that external prerequisite is available and record only observed host/version behavior.
6. When the user-controlled CALL-E prerequisites are available, perform one tightly bounded live provider acceptance and record only observed behavior.
