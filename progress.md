# CallYourAgent progress

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. Agents can escalate important decisions without freezing unrelated scopes; owners can independently request callbacks for progress/questions/steering; human input is persisted as structured state and consumed only at explicit safe checkpoints rather than pretending to interrupt in-flight model generation.

The repository currently includes deterministic fake and production CALL-E providers, SQLite persistence, replayable/idempotent call attempts, polling/webhook convergence, branch-scoped blocking, owner decision persistence, durable per-run instruction queues, exact instruction acknowledgement, call policy/quiet hours/budgets, bounded lifecycle recovery, fail-closed ambiguous/stalled handling, privacy-aware audit history, scoped HTTP authentication, a typed TypeScript client, real stdio MCP, a deterministic end-to-end demo, operator console, and a single-instance persistent-volume Compose reference deployment.

This run hardened the production CALL-E boundary after a repository-wide audit found that non-2xx provider responses were copied into application error strings. Because those errors can be persisted as call-attempt recovery state or emitted by lifecycle diagnostics, a provider response that echoed request data could have propagated sensitive phone/task/webhook material into logs or durable error state. Production CALL-E HTTP failures now expose only the HTTP status plus an optional tightly validated provider request id; arbitrary response bodies are never copied into application errors.

## Exact repo state inspected this run

The run started from `main` HEAD `803d8ed786a27f6be6d752c138381b0ff4ac910a`.

Before making any change, inspected the complete recursive repository tree and current architecture, recent commits, and repository issues/pull requests. There were no open issues or pull requests.

Read in full before implementation:

- `AGENTS.md`
- `progress.md`
- `README.md`
- `docs/ARCHITECTURE.md`
- `docs/INTEGRATIONS.md`
- `docs/API_SECURITY.md`
- `docs/CALL_POLICY.md`
- `docs/DEPLOYMENT.md`
- `docs/OPERATOR_CONSOLE.md`
- `deploy/README.md`

Also inspected the relevant implementation/deployment surfaces, especially:

- `src/calle-provider.ts`, including live create/poll HTTP behavior, structured results, timeouts, and error handling;
- `src/server.ts`, including where provider exceptions may surface through lifecycle diagnostics and persisted recovery paths;
- `src/domain.ts`, especially durable `CallAttempt.lastError` and metadata-only `AuditEvent` contracts;
- `tests/calle-provider.test.ts` and the existing live-adapter contract coverage;
- `tests/mcp-stdio-deployment-acceptance.ts`, which launches the actual built stdio MCP process and keeps it alive across a Dockerized control-plane restart;
- `.github/workflows/compose.yml`, including scoped credentials, SQLite persistence, in-flight decision/callback restart recovery, and stdio MCP acceptance;
- recent fake-provider restart/rehydration and MCP restart commits.

The previous run had already proven that the same external MCP process can remain alive while an MCP-raised blocking owner-decision call remains non-terminal across a control-plane restart. The initial next candidate was stronger exact call-attempt audit correlation for that path. During the production provider audit, however, the raw CALL-E response-body propagation was identified as the higher-value reliability/security issue and was fixed first.

The automation environment did not provide a local repository checkout suitable for running the Node/Docker suite directly. Repository reads/writes used the connected GitHub integration and executable verification used the repository's GitHub Actions workflows. No unsupported local execution claim is made.

## Changes made this run

### CALL-E non-2xx response bodies no longer enter application errors

Implemented in commit `7d1dc88a906e599744fb38fd57c718dc22f845dd` (`fix: redact CALL-E HTTP error bodies`).

Previously both production provider operations did the equivalent of:

- `POST /v1/calls` failure -> include up to 500 characters of the raw response body in the thrown error;
- `GET /v1/calls/{id}` failure -> include up to 500 characters of the raw response body in the thrown error.

That was unnecessarily risky because a remote service, gateway, or test endpoint can echo submitted fields. A create request contains the owner phone destination, the agent's phone task/context, caller metadata, and the application-generated webhook URL. Persisting or logging an echoed body would create a second sensitive-content channel outside the deliberately privacy-aware domain/audit design.

`src/calle-provider.ts` now routes non-2xx responses through one privacy-safe `providerHttpError` helper. The resulting errors contain only:

- the fixed operation name (`create` or `get`);
- the HTTP status code;
- optionally `x-request-id` when it matches a strict allowlist of `A-Z`, `a-z`, digits, `.`, `_`, `:`, `-` and is at most 128 characters.

The provider response body is not read into the error at all. Unsafe request-id values are ignored rather than sanitized or partially copied.

This does not alter successful CALL-E response parsing, provider idempotency, persisted call identity, polling/webhook convergence, structured owner decisions, callback instructions, timeout behavior, or ambiguous-side-effect recovery semantics.

### Regression coverage deliberately exercises sensitive echoes

Added two production-adapter tests in `tests/calle-provider.test.ts`:

1. a failed CALL-E create response echoes a fake API key, owner phone number, webhook URL/capability token, and private task context. The test proves none appears in the thrown application error while a safe request id remains available for provider support correlation;
2. a failed CALL-E get response contains private callback/phone text and an intentionally unsafe request id. The test proves both the response body and unsafe request id are absent from the thrown error.

The existing provider tests for request mapping, idempotency headers, decision/callback result parsing, active/failed states, HTTP request deadlines, and configuration validation remain intact.

## Verification performed

The substantive implementation commit `7d1dc88a906e599744fb38fd57c718dc22f845dd` passed every repository verification surface:

- CI run `34284003555` — **success**. Node 24 locked dependency install, TypeScript typecheck, build, and complete test suite passed: **96 tests, 96 passed, 0 failed**. This includes both new provider-error privacy regressions.
- Container run `34284003531` — **success**. Production image build and fake-provider runtime smoke passed.
- Compose deployment run `34284003522` — **success**. The full scoped-credential Docker/SQLite acceptance remained green, including generated least-privilege credentials, deployment readiness, the real external stdio MCP acceptance, restart while an MCP-raised decision remains active, independent HTTP in-flight decision/callback restart recovery, durable SQLite state, safe-checkpoint exact acknowledgement, and authorization boundaries.

`package.json` still has no separate lint script and no standalone migration/schema-check command. The available `npm run check` path covers TypeScript typechecking, build, and the Node test suite; Container and Compose provide runtime/deployment verification.

No live CALL-E phone call was attempted or claimed.

## Architecture decisions made this run

1. Provider error bodies are untrusted input and must not become an application logging/persistence channel. CALL-E response payloads are parsed only on successful protocol paths where their schema is explicitly expected.
2. HTTP status is sufficient for generic failure state; a provider request id may aid support/debugging only when it is demonstrably safe to copy verbatim.
3. Do not attempt broad redaction of an arbitrary provider body. Allowlisting a tiny diagnostic surface is more reliable than trying to identify every possible phone number, token, task, transcript, or future secret field after the fact.
4. Privacy boundaries apply to failure paths as strongly as success/audit paths. A metadata-only audit design is undermined if provider exception strings can carry full remote bodies.
5. This hardening belongs entirely in the production CALL-E adapter. It does not change the provider-agnostic control-plane state machine or make the MCP/HTTP/SDK adapters provider-aware.
6. Ambiguous create semantics remain fail-closed: network/timeout uncertainty still preserves the original idempotency key and replayable request. The change only prevents a known non-2xx response body from leaking into errors.
7. No successful fake-provider or deployment acceptance is evidence that a real CALL-E phone call has succeeded.

## CALL-E integration status

- **Fake provider:** deterministic, credential-free, restart-stable provider identities, provider-local rehydration for durable accepted `queued`/`in_progress` calls, optional observation-driven completion, duplicate prevention, and deployment-proven through both external stdio MCP and HTTP/Compose flows.
- **Production CALL-E adapter:** implemented against the asynchronous Calls API with server-only `CALLE_API_KEY`, stable idempotency, structured result schemas, bounded create/poll requests, persisted metadata/correlation, polling/webhook convergence, duplicate prevention, fail-closed ambiguous/stalled handling, and now privacy-safe non-2xx error reporting that never copies arbitrary provider bodies.
- **Shared surfaces:** HTTP, TypeScript SDK, stdio MCP, lifecycle worker, and deployment workflows continue to share the same persistent `ControlPlane` state-machine semantics.
- **Live status:** no authorized real CALL-E phone call has been performed, so live provider success remains unverified.

## Current blockers / external prerequisites

No repository-development blocker prevents further useful work.

Live CALL-E verification still requires user-controlled prerequisites: a valid/authorized CALL-E credential, an authorized owner phone destination, and stable public HTTPS webhook ingress configured with the application-owned webhook capability token.

A true Claude Code host acceptance still requires running the documented MCP registration in a real Claude Code environment. The repository proves the actual built stdio MCP process, official MCP client protocol, least-privilege authenticated HTTP boundary, SQLite durability, control-plane restart while an MCP-raised decision remains active, durable decision consumption, callbacks, and safe-checkpoint steering. This must not be described as evidence of an actual Claude Code host run.

## Highest-value next actions

1. Strengthen `tests/mcp-stdio-deployment-acceptance.ts` with exact call-attempt audit correlation for its MCP-raised decision: derive the unique durable call-attempt id and prove exactly one `call_attempt_created`, `call_attempt_started`, and `call_attempt_completed` chain across restart.
2. Add a compact executable Claude Code real-host acceptance/runbook fixture using the standard agent credential, existing stdio MCP command, expected tool sequence, branch-safe semantics, and explicit checkpoint/acknowledgement behavior. Keep the remaining real-host prerequisite explicit.
3. Audit the MCP child stderr and normal deployment/lifecycle diagnostic paths for other accidental bearer/webhook/phone/task disclosure and add focused regression assertions where useful.
4. Document the provider-local fake `rehydrate` port more explicitly in `docs/ARCHITECTURE.md`, separating local fake-provider reconstruction from remote CALL-E's durable provider-side call identity.
5. When the user-controlled CALL-E prerequisites are available, perform one tightly bounded live provider acceptance and record only observed behavior.
