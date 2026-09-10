# CallYourAgent progress

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. Agents can escalate important decisions without freezing unrelated scopes; owners can independently request callbacks for progress/questions/steering; human input is persisted as structured state and consumed only at explicit safe checkpoints rather than pretending to interrupt in-flight model generation.

The repository includes deterministic fake and production CALL-E providers, SQLite persistence, replayable/idempotent call attempts, polling/webhook convergence, branch-scoped blocking, owner decision persistence, durable per-run instruction queues with exact acknowledgement, quiet hours/call budgets, bounded lifecycle recovery, fail-closed ambiguous/stalled handling, privacy-aware audit history, scoped HTTP authentication, a typed TypeScript client, a real stdio MCP adapter, deterministic end-to-end/demo flows, an operator console, a Claude Code host-acceptance runbook, and a single-instance persistent-volume Compose reference deployment.

This run continued the HTTP transport-validation audit. PR #35 makes optional text fields type-safe at runtime instead of silently treating a present non-string value as if the field had been omitted. The change covers run `currentScope`, heartbeat `summary`/`currentScope`, escalation `context`, and owner-callback `prompt`, while preserving the existing behavior that an absent value or blank string means “not supplied.”

## Exact repo state inspected this run

The run started from `main` HEAD `d5333c29bdd99bd32619f7785d53000b22dea5de`, the progress handoff after PR #34 (`0d6ab01861ee9ffab0d5874fc39783bef4a9c8a8`).

Inspected the complete recursive repository tree and current source/test inventory, recent commits, current issue state, and recent pull requests. There were no open issues and no pre-existing open pull request blocking this increment.

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

Also inspected `src/http-server.ts`, `src/store.ts`, the current HTTP-validation regressions, and the complete test inventory. No file content was modified until the documentation/source audit was complete. An empty working branch ref was created during the audit before the last documentation reads; all implementation commits were made only after the full audit was complete.

The inspection found that the HTTP helper for optional text returned `undefined` for any non-string runtime value. Consequently, an untyped network caller could send values such as `prompt: 123`, `context: []`, or `summary: { ... }`; the adapter would silently reinterpret the malformed supplied value as “field omitted” and could continue into domain mutation/provider orchestration. This was a transport-boundary defect rather than a new domain rule.

## Changes made this run

PR #35, `Validate optional HTTP text fields`, changed `src/http-server.ts` and added `tests/http-optional-text-validation.test.ts`.

The HTTP boundary now:

1. distinguishes an actually absent optional field from a present malformed value;
2. requires a present optional text value to be a string;
3. returns a stable privacy-safe HTTP 400 error such as `prompt must be a string` for a wrong runtime type;
4. validates run `currentScope`, heartbeat `summary` and `currentScope`, escalation `context`, and callback `prompt` consistently;
5. preserves backwards-compatible blank/whitespace-string normalization to omission;
6. rejects malformed values before run/heartbeat/escalation/callback control-plane mutation or provider call creation;
7. keeps unexpected failures behind the existing fail-closed `500 internal_error` boundary.

The new deterministic HTTP regressions prove that malformed optional values cannot create a run, mutate heartbeat/audit state, create an escalation, bind callback idempotency state, create a call attempt, or reach a provider side effect. A positive compatibility regression proves a blank callback prompt remains accepted as omitted.

PR #35 was squash-merged into `main` as `492f2fc6a9f2453cb0865c15a9fe447494bdf10d`.

## Verification performed

Authoritative final verification ran against PR head `e2609daaf6f18eb6a958e2f7de82262c3f999d5b`:

- CI run `34518290853` — **success** on Node 24.20.0. Locked dependency installation succeeded, TypeScript typecheck succeeded, build succeeded, and **180/180 tests passed**, 0 failures. All four new optional-text HTTP regressions passed.
- Container run `34518290869` — **success**. The production image/runtime path remained green.
- Compose deployment run `34518290906` — **success**. The production-style durable SQLite + scoped credentials + compiled MCP + restart + branch-scoped decision + owner callback + exactly-once steering + safe-checkpoint acceptance path remained green.

A local clone was attempted only as a convenience for editing/testing, but the automation container could not resolve `github.com`; GitHub Actions therefore remained the authoritative executable verification path. This was transient/local tooling, not a repository blocker.

`package.json` still has no separate lint script and no standalone migration/schema-check command. `npm run check` covers typecheck, build, and tests; SQLite regressions exercise schema/transaction durability, and Container/Compose cover packaged runtime/deployment behavior.

No live CALL-E phone call was attempted or claimed.

## Architecture decisions made this run

1. HTTP optionality and runtime type are separate concepts: omission is valid where documented, but a caller that explicitly supplies the field must supply the contract type.
2. The adapter should enforce transport shape before invoking shared control-plane semantics; no duplicate platform-specific state machine or domain rewrite is needed.
3. Blank optional strings remain normalized to omission to preserve current SDK/browser compatibility; this increment is about wrong runtime types, not changing empty-text semantics.
4. Client-correctable malformed input receives stable privacy-safe 400 errors, while arbitrary runtime/domain exceptions continue to collapse to `500 internal_error`.
5. Invalid callback/escalation context must fail before any durable phone-side-effect state exists. This preserves the existing fake/live provider and idempotency architecture unchanged.

## CALL-E integration status

- **Fake provider:** deterministic, credential-free, idempotent, restart-rehydratable, and still the primary full-flow development/acceptance provider.
- **Production CALL-E adapter:** implemented against the asynchronous Calls API with server-only `CALLE_API_KEY`, stable provider `Idempotency-Key`, structured result schemas, bounded create/poll requests, persisted correlation, polling/webhook convergence, duplicate prevention, restart-by-provider-id semantics, privacy-safe diagnostics, and fail-closed ambiguous/stalled handling.
- **Control-plane idempotency:** decision and callback keys remain payload-bound; exact retries remain no-op replays; changed-payload reuse is rejected; SQLite race coverage proves the durable first binding wins before provider I/O.
- **Public webhook configuration:** live runtime requires an exact HTTPS origin and structurally constructs the tokenized webhook target. Application request handling strips the capability token from `IncomingMessage.url`; reverse-proxy/CDN/APM query-string redaction remains mandatory.
- **Shared integration surfaces:** HTTP, TypeScript SDK, stdio MCP, lifecycle worker, operator console, and deployment acceptance continue sharing the same persistent control-plane state machine.
- **Claude Code:** compiled stdio MCP behavior remains covered automatically and through Compose acceptance. A genuine Claude Code host session has still not been observed and is not claimed.
- **Live status:** no authorized real CALL-E phone call has been performed, so live provider connectivity, owner-phone authorization, and externally reachable webhook delivery remain unverified.

## Current blockers / external prerequisites

No repository-development blocker prevents further useful work.

A true Claude Code host acceptance still requires an actual Claude Code environment/CLI to register and exercise the compiled stdio MCP server.

Live CALL-E verification still requires user-controlled prerequisites: a valid/authorized CALL-E credential, an authorized owner phone destination, and a stable externally reachable HTTPS origin whose ingress does not log the webhook capability query string.

The SQLite reference topology remains intentionally single-instance. Multi-instance/distributed guarantees require a future shared transactional store and shared limiter that preserve the current uniqueness/idempotency semantics.

## Highest-value next actions

1. Continue the HTTP transport audit with fields that still have permissive coercion semantics, especially `checkpoint.consume` (currently only literal `true` changes behavior, so a supplied wrong type silently becomes `false`) and query-parameter cardinality/validation such as duplicate `audit?limit=` values.
2. Review live-runtime environment validation ordering for settings that can still fail only after durable storage opens, and move safe pure validation earlier where appropriate.
3. Continue least-privilege review of owner/operator/reconciler surfaces without widening browser or normal-agent credentials.
4. Add explicit store-contract tests before introducing any Postgres/multi-instance deployment so atomic idempotency winner-selection remains a required adapter property.
5. Run the documented acceptance in a genuine Claude Code host when that external prerequisite is available and record only observed host/version behavior.
6. When the user-controlled CALL-E prerequisites are available, perform one tightly bounded live provider acceptance and record only observed behavior.
