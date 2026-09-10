# CallYourAgent progress

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. Agents can escalate important decisions without freezing unrelated scopes; owners can independently request callbacks for progress/questions/steering; human input is persisted as structured state and consumed only at explicit safe checkpoints rather than pretending to interrupt in-flight model generation.

The repository includes deterministic fake and production CALL-E providers, SQLite persistence, replayable/idempotent call attempts, polling/webhook convergence, branch-scoped blocking, owner decision persistence, durable per-run instruction queues, exact instruction acknowledgement, quiet hours/call budgets, bounded lifecycle recovery, fail-closed ambiguous/stalled handling, privacy-aware audit history, scoped HTTP authentication, a typed TypeScript client, a real stdio MCP adapter, deterministic end-to-end/demo flows, an operator console, a Claude Code host-acceptance runbook, and a single-instance persistent-volume Compose reference deployment.

This run hardened the CALL-E webhook capability-token boundary. PR #29 preserves the current CALL-E-compatible query-token contract but extracts the application-owned capability at the very beginning of Node request handling and immediately removes every `token` query parameter from `IncomingMessage.url`. This reduces the period in which in-process diagnostics/APM/error instrumentation can accidentally serialize the secret request target. Duplicate token parameters now fail closed. The change deliberately does not claim to sanitize reverse-proxy/CDN logs that see the raw request before Node; ingress query redaction remains mandatory.

## Exact repo state inspected this run

The run started from `main` HEAD `84baec60baa35f463bd7b3ed603716dba9666aa6`, the progress handoff after PR #28 (`0c30b2b04cf7e95532cfd130d039c099da8a44e9`).

Before changing code, inspected the complete recursive repository tree and current architecture through the connected GitHub repository/tree/contents APIs, including root configuration, all `.github/workflows`, `deploy`, every file under `docs`, the `src` implementation inventory, and the full test inventory. Inspected the recent commit chain through PR #28 and verified there were no open issues and no open pull requests before this run.

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

Also inspected the relevant current implementation and tests, especially `src/http-server.ts`, `src/server.ts`, `tests/http-server.test.ts`, `tests/server-runtime.test.ts`, the webhook parser/provider tests, existing HTTP/privacy tests, runtime logging privacy tests, and the latest lifecycle/reconciliation concurrency tests.

The inspection confirmed the previous handoff: lifecycle sweep versus explicit reconciliation already converges correctly through the shared terminal apply transaction/refetch fence. The highest-value remaining concrete gap was that the raw webhook request target, including the application-owned `token` query parameter, remained in Node's `IncomingMessage.url` for the entire application request lifetime even though application responses and runtime logs were already privacy-safe.

A direct unauthenticated container `git clone` was attempted again and failed because this automation container could not resolve `github.com`. Repository inspection, mutation, and authoritative verification therefore used the connected GitHub integration and GitHub Actions. This is an execution-environment limitation, not a repository-development blocker.

## Changes made this run

PR #29, `Harden CALL-E webhook capability request-target privacy`, changed `src/http-server.ts` and added `tests/webhook-request-target-privacy.test.ts`.

Production behavior now:

- recognizes `/webhooks/calle` before normal route processing;
- parses the application-owned capability token exactly once;
- accepts the credential candidate only when exactly one `token` parameter is present;
- deletes all `token` query parameters from the request target;
- overwrites `IncomingMessage.url` with the redacted target before the rest of application routing/validation runs;
- continues comparing the extracted token using the existing constant-time equality helper;
- preserves non-secret query parameters if present;
- leaves unrelated request targets unchanged;
- rejects duplicate token parameters rather than ambiguously accepting the first one.

The new deterministic tests prove:

1. a secret-bearing CALL-E webhook target is converted to a token-free in-process target while preserving unrelated query correlation fields;
2. duplicate webhook `token` parameters produce no credential candidate, all token material is removed from the sanitized target, and authentication therefore fails closed;
3. unauthorized, duplicate-token, and valid non-terminal HTTP webhook responses never reflect the capability material;
4. the existing supported query-token contract still reaches the webhook route and returns the expected non-terminal acceptance response.

No provider/state-machine semantics, branch blocking, callback steering, safe-checkpoint behavior, or CALL-E idempotency behavior were changed.

PR #29 was squash-merged into `main` as `bcad69f9b772275feb9023322564b272ad950b5e`.

## Verification performed

Authoritative verification ran against PR #29 head `e4f9aad72a49f1688a4d9fb1d24e285d325d3a1c`:

- CI run `34480913064` — **success** on Node 24.20.0. Locked dependency installation, TypeScript typecheck, build, and **161/161 tests passed**, 0 failures. All three new webhook request-target privacy regressions passed.
- Container run `34480913036` — **success**. Production image build and fake-provider runtime smoke remained green.
- Compose deployment run `34480913009` — **success**. The production-style single-instance SQLite acceptance remained green through generated scoped credentials, compiled stdio MCP, durable branch-blocking owner decision, restart while the decision call was active, exact branch release, context-aware owner callback, restart while callback was active, exactly-once queued steering, another restart, and safe-checkpoint steering consumption.

`package.json` still has no separate lint script and no standalone migration/schema-check command. `npm run check` covers TypeScript typechecking, build, and tests; SQLite tests exercise durable schema/transaction behavior; Container and Compose exercise the production image/runtime/deployment path.

No live CALL-E phone call was attempted or claimed.

## Architecture decisions made this run

1. Preserve the current CALL-E-compatible application-owned query capability because current webhook integration has no provider signature/header-secret contract to replace it with.
2. Treat a URL credential as sensitive immediately on Node ingress. Extract it once, then remove it from the mutable request target before ordinary application processing continues.
3. Fail closed on multiple webhook capability parameters. Ambiguous credential syntax should not result in first-value-wins authentication.
4. Keep external ingress and application redaction as separate security layers. Mutating `IncomingMessage.url` cannot retroactively protect reverse-proxy, CDN, load-balancer, or APM logs that captured the raw target before Node received it.
5. Do not add fake claims about CALL-E signatures. If CALL-E exposes a signed webhook contract later, signature verification should augment or replace the secret-URL boundary while preserving `ControlPlane.ingestProviderWebhook` semantics.
6. Keep the control plane and phone transport responsibilities unchanged: webhook authentication is an HTTP ingress concern; provider terminal evidence still converges through the same durable state-machine transition.

## CALL-E integration status

- **Fake provider:** deterministic, credential-free, idempotent, restart-rehydratable from durable accepted-call state, and still the primary full-flow development/acceptance provider.
- **Production CALL-E adapter:** implemented against the asynchronous Calls API with server-only `CALLE_API_KEY`, stable `Idempotency-Key`, structured result schemas, bounded create/poll requests, persisted correlation, polling/webhook convergence, duplicate prevention, restart-by-provider-id semantics, privacy-safe provider diagnostics, and fail-closed ambiguous/stalled handling.
- **Webhook ingress:** application-owned high-entropy query capability plus CALL-E event-id/header agreement remains the current unsigned-webhook boundary. The Node request target now drops capability material immediately after extraction. Reverse-proxy/CDN/APM query-string redaction remains required because those layers see the raw target first.
- **Shared surfaces:** HTTP, TypeScript SDK, stdio MCP, lifecycle worker, operator console, and deployment flows continue sharing one persistent control-plane state machine.
- **Claude Code:** compiled stdio MCP behavior remains covered by automated and Compose acceptance. A genuine Claude Code host session has still not been observed and is not claimed.
- **Live status:** no authorized real CALL-E phone call has been performed, so live provider connectivity, owner-phone authorization, and public webhook success remain unverified.

## Current blockers / external prerequisites

No repository-development blocker prevents further useful work.

A true Claude Code host acceptance requires an actual Claude Code environment/CLI to register and exercise the compiled stdio MCP server.

Live CALL-E verification still requires user-controlled prerequisites: a valid/authorized CALL-E credential, an authorized owner phone destination, and stable public HTTPS webhook ingress configured with the application-owned webhook capability token.

## Highest-value next actions

1. Harden `CYA_PUBLIC_BASE_URL` construction/validation. Live mode currently documents a stable HTTPS origin but runtime construction should explicitly reject non-HTTPS URLs, credentials, query strings, fragments, and unexpected base paths, then construct the webhook URL with the WHATWG URL API rather than string concatenation.
2. Add deterministic tests proving malformed/public-base configuration fails before opening durable storage or attempting provider/network work, while a valid HTTPS origin produces exactly the intended tokenized webhook URL.
3. Continue reviewing webhook ingress guidance for concrete reverse-proxy examples if a supported deployment target is added; do not imply in-process redaction replaces ingress access-log suppression.
4. Continue tightening stable HTTP conflict/validation semantics without reintroducing arbitrary exception reflection.
5. Run the documented acceptance in a genuine Claude Code host when that external prerequisite is available and record only observed host/version behavior.
6. When the user-controlled CALL-E prerequisites are available, perform one tightly bounded live provider acceptance and record only observed behavior.
