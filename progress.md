# CallYourAgent progress

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. Agents can escalate important decisions without freezing unrelated scopes; owners can independently request callbacks for progress/questions/steering; human input is persisted as structured state and consumed only at explicit safe checkpoints rather than pretending to interrupt in-flight model generation.

The repository includes deterministic fake and production CALL-E providers, SQLite persistence, replayable/idempotent call attempts, polling/webhook convergence, branch-scoped blocking, owner decision persistence, durable per-run instruction queues with exact acknowledgement, quiet hours/call budgets, bounded lifecycle recovery, fail-closed ambiguous/stalled handling, privacy-aware audit history, scoped HTTP authentication, a typed TypeScript client, a real stdio MCP adapter, deterministic end-to-end/demo flows, an operator console, a Claude Code host-acceptance runbook, and a single-instance persistent-volume Compose reference deployment.

This run hardened the owner-decision HTTP input boundary. PR #34 adds runtime validation for escalation `priority` and `expiresAt` before `ControlPlane.requestOwnerDecision` is invoked, preventing malformed client data from entering durable escalation/policy/lifecycle state or reaching phone-provider orchestration.

## Exact repo state inspected this run

The run started from `main` HEAD `533f69d179d5fd451a7ff7d92d62ea012c107242`, the progress handoff after PR #33 (`63c766cb7c2f101d840e73274cb777091fa34b82`).

Before changing code, inspected the complete recursive repository tree and current source/test inventories, recent commits, and current issue/PR state. There were no open issues or pull requests blocking the increment.

Read in full before changing code:

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

Also inspected the relevant implementation and regression paths including `src/http-server.ts`, `src/domain.ts`, `src/control-plane.ts`, `src/call-policy.ts`, `src/call-provider.ts`, `tests/http-server.test.ts`, and the complete current test inventory.

The inspection found that `POST /v1/escalations` previously accepted `priority` through a TypeScript-only cast with no runtime enum check and accepted `expiresAt` through generic optional-string handling. An unknown priority such as `urgent` could therefore enter the policy layer with no rank entry, while malformed expiry values could become durable lifecycle input. Both are transport-validation defects rather than new domain states.

## Changes made this run

PR #34, `Validate owner decision HTTP inputs`, changed `src/http-server.ts` and added `tests/http-owner-decision-validation.test.ts`.

The HTTP boundary now:

1. accepts only the domain priorities `low`, `normal`, `high`, and `critical`;
2. returns a stable privacy-safe HTTP 400 response for any other priority value;
3. requires `expiresAt`, when supplied, to be an ISO 8601 date-time with an explicit `Z` or numeric timezone offset;
4. rejects timezone-less dates, non-string values, malformed times/offsets, and impossible calendar dates such as February 31 rather than relying on JavaScript date normalization;
5. performs these checks before invoking the control plane, so invalid requests create no escalation, call attempt, audit mutation, or provider side effect;
6. preserves normal creation for valid priorities and timezone-qualified expiries.

The new end-to-end HTTP regressions explicitly verify invalid priority and expiry requests are non-mutating and verify a valid high-priority request with a zoned expiry still enters the normal escalation/call path.

PR #34 was squash-merged into `main` as `0d6ab01861ee9ffab0d5874fc39783bef4a9c8a8`.

## Verification performed

The first PR verification exposed an intentional edge case in the new regression: JavaScript's date parser normalized an impossible `2026-02-31...` timestamp, so the initial implementation returned 201 rather than the expected 400. The validator was tightened rather than weakening the regression.

A second verification then exposed a TypeScript narrowing error in that stricter helper before tests ran. The helper was corrected to narrow the unknown HTTP value to a string before parsing. These failures were fixed on the branch before merge.

Authoritative final verification ran against PR head `8acc7c8d8c0a826b3538e140c095990852f92632`:

- CI run `34512143402` — **success** on Node 24.20.0. Locked dependency installation succeeded, TypeScript typecheck succeeded, build succeeded, and **176/176 tests passed**, 0 failures. All three new owner-decision HTTP validation regressions passed.
- Container run `34512142815` — **success**. The production image/runtime path remained green.
- Compose deployment run `34512143376` — **success**. The production-style durable SQLite + scoped credentials + compiled MCP + restart + branch-scoped decision + callback steering + safe-checkpoint acceptance path remained green.

`package.json` still has no separate lint script and no standalone migration/schema-check command. `npm run check` covers typecheck, build, and tests; SQLite regressions exercise schema/transaction durability, and Container/Compose cover packaged runtime/deployment behavior.

No live CALL-E phone call was attempted or claimed.

## Architecture decisions made this run

1. HTTP adapters must runtime-validate externally supplied enum/date values even when the TypeScript SDK already provides compile-time types. Network callers are untrusted and can bypass TypeScript.
2. Invalid owner-decision transport input must fail before durable mutation and before any real-world call side effect.
3. Escalation expiry requires an explicit timezone so lifecycle comparisons are deterministic across hosts and deployments.
4. Date validation must reject impossible calendar dates rather than accepting JavaScript `Date.parse` normalization behavior.
5. Client-correctable malformed input receives stable privacy-safe 400 errors, while unexpected runtime/domain failures continue to use the fail-closed `500 internal_error` boundary.
6. No control-plane state-machine changes were needed; the transport adapter remains thin and delegates only validated domain-shaped input to the shared core.

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

1. Continue the HTTP validation audit for optional text fields and query parameters that currently tolerate wrong runtime types or rely on downstream validation, while keeping stable privacy-safe client errors and avoiding duplicate domain rules.
2. Review live-runtime environment validation ordering for settings that can still fail only after durable storage opens, and move safe pure validation earlier where appropriate.
3. Continue least-privilege review of owner/operator/reconciler surfaces without widening browser or normal-agent credentials.
4. Add explicit store-contract tests before introducing any Postgres/multi-instance deployment so atomic idempotency winner-selection remains a required adapter property.
5. Run the documented acceptance in a genuine Claude Code host when that external prerequisite is available and record only observed host/version behavior.
6. When the user-controlled CALL-E prerequisites are available, perform one tightly bounded live provider acceptance and record only observed behavior.
