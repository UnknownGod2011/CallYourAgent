# CallYourAgent progress

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. Agents can escalate important decisions without freezing unrelated scopes; owners can independently request callbacks for progress/questions/steering; human input is persisted as structured state and consumed only at explicit safe checkpoints rather than pretending to interrupt in-flight model generation.

The repository includes deterministic fake and production CALL-E providers, SQLite persistence, replayable/idempotent call attempts, polling/webhook convergence, branch-scoped blocking, owner decision persistence, durable per-run instruction queues with exact acknowledgement, quiet hours/call budgets, bounded lifecycle recovery, fail-closed ambiguous/stalled handling, privacy-aware audit history, scoped HTTP authentication, a typed TypeScript client, a real stdio MCP adapter, deterministic end-to-end/demo flows, an operator console, a Claude Code host-acceptance runbook, and a single-instance persistent-volume Compose reference deployment.

This run hardened live CALL-E public-webhook configuration. PR #30 validates `CYA_PUBLIC_BASE_URL` as an exact HTTPS origin before durable storage opens, rejects embedded credentials/query strings/fragments/non-root paths, and constructs `/webhooks/calle?token=...` with the WHATWG `URL` and `URLSearchParams` APIs instead of manual string concatenation.

## Exact repo state inspected this run

The run started from `main` HEAD `156d13f55f78e005f7708851cfec4214439ce6d5`, the progress handoff after PR #29 (`bcad69f9b772275feb9023322564b272ad950b5e`).

Before changing code, inspected the complete recursive repository tree at that exact HEAD, including root configuration, all GitHub Actions workflows, `deploy`, every architecture/integration document under `docs`, the full `src` implementation inventory, and the complete test inventory. Inspected recent commits through PR #29, recent PRs #20-#29, and issue state; there were no open issues or open pull requests before this run.

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

Also inspected the relevant runtime and regression surface, especially `src/server.ts` and `tests/server-runtime.test.ts`, plus the existing webhook/privacy and lifecycle/reconciliation coverage represented in the tree.

The inspection confirmed the previous handoff exactly: live mode required a documented stable HTTPS origin, but runtime code only stripped one trailing slash and then string-concatenated the webhook path. It did not explicitly reject HTTP, credentials, preexisting query strings/fragments, or unexpected base paths.

The automation container still cannot resolve `github.com` for a direct unauthenticated clone. Repository inspection/mutation therefore used the connected GitHub integration and authoritative verification used GitHub Actions. This is an execution-environment limitation, not a repository-development blocker.

## Changes made this run

PR #30, `Harden live public webhook URL configuration`, changed `src/server.ts` and added `tests/public-base-url.test.ts`.

Production behavior now:

- parses `CYA_PUBLIC_BASE_URL` with the WHATWG `URL` API;
- requires `https:`;
- rejects embedded username/password credentials;
- rejects any existing query string;
- rejects fragments;
- rejects non-root paths, so the setting is unambiguously an origin rather than a deployment-prefix URL;
- constructs the exact `/webhooks/calle` path through the parsed URL object;
- adds the application-owned webhook capability through `URLSearchParams`, preserving correct encoding for reserved characters;
- performs this validation inside live-provider configuration before the SQLite store is opened;
- does not probe CALL-E, DNS, TLS, the owner phone, or public ingress while validating configuration.

The deterministic regressions prove a valid HTTPS origin produces the intended tokenized webhook target, unsafe/ambiguous base URLs are rejected, and an invalid live base URL fails before the configured SQLite database file is created.

No call state machine, decision/callback behavior, branch-scoped blocking, owner instruction semantics, provider idempotency, webhook reconciliation, or fake-provider behavior changed.

PR #30 was squash-merged into `main` as `e4676f5039a2bfec5c14807107a957153f4d7916`.

## Verification performed

Authoritative verification ran against PR #30 head `5395b9b55467d5b993bfacc96906a2787ab0c553`:

- CI run `34487051626` — **success** on Node 24.20.0. Locked dependency installation succeeded; TypeScript typecheck succeeded; build succeeded; **164/164 tests passed**, 0 failures. All three new public-base-URL tests passed.
- Container run `34487051711` — **success**. The production image/fake-provider runtime path remained green.
- Compose deployment run `34487051578` — **success**. The production-style single-instance SQLite acceptance remained green, preserving generated scoped credentials, compiled stdio MCP, durable branch-scoped decision behavior, restart recovery, owner callback flow, exactly-once steering, persistence across restart, and safe-checkpoint consumption.

`package.json` still has no separate lint script and no standalone migration/schema-check command. `npm run check` covers typechecking, build, and tests; SQLite tests exercise schema/transaction durability; Container and Compose cover the production image/runtime/deployment paths.

No live CALL-E phone call was attempted or claimed.

## Architecture decisions made this run

1. Treat `CYA_PUBLIC_BASE_URL` as an origin, not an arbitrary URL prefix. Supporting deployment under an arbitrary path should be an explicit future feature rather than accidental string-concatenation behavior.
2. Require HTTPS in live CALL-E mode at runtime, matching the documented public-webhook security boundary.
3. Reject credentials, query strings, and fragments rather than silently normalizing or inheriting them into a sensitive capability URL.
4. Let WHATWG URL semantics own path and query construction so webhook-token escaping is structural rather than hand-built.
5. Keep configuration validation side-effect free and before durable storage initialization where possible.
6. Keep readiness claims narrow: successful validation means local live configuration is structurally configured; it still does not mean provider/network/public-ingress connectivity has been proven.

## CALL-E integration status

- **Fake provider:** deterministic, credential-free, idempotent, restart-rehydratable from durable accepted-call state, and still the primary full-flow development/acceptance provider.
- **Production CALL-E adapter:** implemented against the asynchronous Calls API with server-only `CALLE_API_KEY`, stable `Idempotency-Key`, structured result schemas, bounded create/poll requests, persisted correlation, polling/webhook convergence, duplicate prevention, restart-by-provider-id semantics, privacy-safe provider diagnostics, and fail-closed ambiguous/stalled handling.
- **Public webhook configuration:** live runtime now requires an exact HTTPS origin and constructs the tokenized webhook target structurally. Application request handling already strips the capability token from `IncomingMessage.url` immediately after extraction. Reverse-proxy/CDN/APM query-string redaction remains mandatory because those layers may see the raw request first.
- **Shared surfaces:** HTTP, TypeScript SDK, stdio MCP, lifecycle worker, operator console, and deployment flows continue sharing one persistent control-plane state machine.
- **Claude Code:** compiled stdio MCP behavior remains covered by automated and Compose acceptance. A genuine Claude Code host session has still not been observed and is not claimed.
- **Live status:** no authorized real CALL-E phone call has been performed, so live provider connectivity, owner-phone authorization, and externally reachable webhook delivery remain unverified.

## Current blockers / external prerequisites

No repository-development blocker prevents further useful work.

A true Claude Code host acceptance requires an actual Claude Code environment/CLI to register and exercise the compiled stdio MCP server.

Live CALL-E verification still requires user-controlled prerequisites: a valid/authorized CALL-E credential, an authorized owner phone destination, and a stable externally reachable HTTPS origin whose ingress is configured not to log the webhook capability query string.

## Highest-value next actions

1. Audit stable HTTP validation/conflict semantics and add deterministic tests where domain/precondition failures still collapse unnecessarily into generic `500 internal_error`; keep sensitive exception text fail-closed while making safe client-correctable conflicts explicit.
2. Review live-runtime environment validation ordering for any remaining settings that can fail only after durable storage opens, and move pure validation before storage where doing so does not duplicate domain validation.
3. Add concrete ingress query-redaction examples only when a supported deployment target/reverse proxy is selected; do not imply Node-side redaction protects upstream logs.
4. Continue hardening operator/reconciler least-privilege boundaries without widening browser or agent credentials.
5. Run the documented acceptance in a genuine Claude Code host when that external prerequisite is available and record only observed host/version behavior.
6. When the user-controlled CALL-E prerequisites are available, perform one tightly bounded live provider acceptance and record only observed behavior.
