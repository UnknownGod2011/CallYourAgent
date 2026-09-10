# CallYourAgent progress

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. Agents can escalate important decisions without freezing unrelated scopes; owners can independently request callbacks for progress/questions/steering; human input is persisted as structured state and consumed only at explicit safe checkpoints rather than pretending to interrupt in-flight model generation.

The repository includes deterministic fake and production CALL-E providers, SQLite persistence, replayable/idempotent call attempts, polling/webhook convergence, branch-scoped blocking, owner decision persistence, durable per-run instruction queues with exact acknowledgement, quiet hours/call budgets, bounded lifecycle recovery, fail-closed ambiguous/stalled handling, privacy-aware audit history, scoped HTTP authentication, a typed TypeScript client, a real stdio MCP adapter, deterministic end-to-end/demo flows, an operator console, a Claude Code host-acceptance runbook, and a single-instance persistent-volume Compose reference deployment.

This run closed the request-level idempotency aliasing gap. PR #32 binds each owner-decision idempotency key to the original logical decision request and each owner-callback key to its original run/prompt request. Exact retries remain no-op replays, including after a run is no longer running, while reusing a key for a different request now fails before mutation or provider I/O with a stable privacy-safe `409 idempotency_conflict` HTTP contract.

## Exact repo state inspected this run

The run started from `main` HEAD `6d6940cef209bda15eafb6729a02ca8460492633`, the progress handoff after PR #31 (`c5eb8deac6f39c0536d3ce3ab8e932dcc7c222f5`).

Before changing code, inspected the complete recursive repository tree at that exact HEAD, including root configuration, all GitHub Actions workflows, `deploy`, every architecture/integration document under `docs`, the full `src` implementation inventory, and the complete test inventory. Inspected recent commits through PR #31 and current issue/PR state; there were no open issues or open pull requests before this run.

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

Also inspected the implementation and regression paths most relevant to the change: `src/control-plane.ts`, `src/domain.ts`, `src/store.ts`, `src/sqlite-store.ts`, `src/http-server.ts`, `tests/control-plane.test.ts`, `tests/callback-idempotency-concurrency.test.ts`, `tests/sqlite-store.test.ts`, `tests/sqlite-owner-callback-http-restart.test.ts`, and `tests/http-conflict-contracts.test.ts`.

The inspection confirmed that both request-level idempotency maps were only `key -> resource id`. Exact retries were safe, but the same key could be reused with a different run/scope/question/context/prompt and silently return the previously mapped resource without proving request equivalence. That could steer the caller toward an unrelated prior decision/callback while suppressing the newly intended operation.

Repository mutation used the connected GitHub integration. A temporary branch-only workflow was used to apply and verify the patch because direct container GitHub cloning was unavailable; the workflow removed itself before the verified source commit, so it is not part of the PR or `main` diff.

## Changes made this run

PR #32, `Bind idempotency keys to logical requests`, changed `src/control-plane.ts`, `src/domain.ts`, `src/http-server.ts`, `tests/sqlite-owner-callback-http-restart.test.ts`, and added `tests/idempotency-payload-binding.test.ts`.

Production behavior now:

- owner-decision replay checks the existing escalation against the full logical request: `runId`, `scopeId`, `question`, optional `context`, `blocking`, normalized `priority`, and `expiresAt`;
- owner-callback replay checks the existing callback against the original `runId` and prompt request;
- new callback attempts persist a local SHA-256 `requestFingerprint` for the logical callback request; that fingerprint is control-plane state only and is not included in provider metadata or sent to CALL-E;
- previously persisted callbacks without the new fingerprint remain replay-compatible by verifying the already-durable replayable callback task against the requested prompt;
- exact retries are checked before the `run is running` creation precondition, so a transport/client retry can still retrieve the already-created resource after the run later completes;
- changed-payload reuse throws a fixed internal conflict classification before creating resources, changing state, or starting a phone call;
- HTTP maps that classification to `409 {"error":"idempotency_conflict"}` without echoing run IDs, prompts, questions, or internal exception details;
- an older restart test that intentionally reused one key with a different prompt was corrected to issue a true exact replay; the new conflict tests separately prove changed prompts are rejected.

No branch-scoped blocking semantics, decision terminal transitions, instruction queue/checkpoint behavior, call policy, provider recovery, webhook reconciliation, fake-provider behavior, or production CALL-E network contract changed.

PR #32 was squash-merged into `main` as `b01aeff664dcc7f32974bde3e46dfd517075efa4`.

## Verification performed

The first branch verification run `34500069555` applied the proposed change and ran the complete suite. It produced 170/171 passing tests and exposed one outdated restart acceptance that intentionally reused the same callback idempotency key with a different prompt. The implementation was not committed from that failing run.

After correcting that acceptance to use the exact original logical request, branch verification run `34500451353` completed `npm ci` and `npm run check` successfully and committed the verified source change.

Authoritative PR #32 verification ran against head `7fef6439e4d69480a6b090683ddba3f4c737da60`:

- CI run `34500545691` — **success** on Node 24.20.0. Locked dependency installation succeeded; TypeScript typecheck succeeded; build succeeded; **171/171 tests passed**, 0 failures. All five new idempotency payload-binding tests passed.
- Container run `34500545346` — **success**. The production image/fake-provider runtime path remained green.
- Compose deployment run `34500545341` — **success**. The production-style SQLite acceptance remained green through generated scoped credentials, compiled stdio MCP, durable branch-blocking decision creation, restart while the decision call remained active, branch-specific release, context-aware owner callback, restart while callback active, exactly-once steering persistence, another restart, and safe-checkpoint consumption.

`package.json` still has no separate lint script and no standalone migration/schema-check command. `npm run check` covers typechecking, build, and tests; SQLite tests exercise schema/transaction durability; Container and Compose cover the production image/runtime/deployment paths.

No live CALL-E phone call was attempted or claimed.

## Architecture decisions made this run

1. An idempotency key is an immutable binding to one logical request, not a general alias for whichever payload arrives later with that key.
2. Exact retries should remain retrievable after mutable run state changes; creation preconditions must not turn a previously successful request into a failed retry.
3. Decision request identity includes every caller-controlled field that can alter the requested human judgment or branch behavior.
4. Callback request identity includes the target run and owner prompt, but not the run's mutable heartbeat/status text. Status is context captured when the original callback is created, not a caller-controlled idempotency dimension.
5. Callback request fingerprints are local durable control-plane state. They must not be placed in provider metadata or become part of CALL-E's external contract.
6. Durable callbacks created before fingerprint support remain safely replayable by validating against the callback task already stored for provider recovery; no database rewrite is required.
7. Payload/key mismatch is a client-correctable resource conflict and therefore receives a stable opaque 409 code. The public response must not reveal the conflicting resource or request content.
8. A mismatched retry must be side-effect free: no new escalation/callback, no mutation of the old resource, and no provider call.

## CALL-E integration status

- **Fake provider:** deterministic, credential-free, idempotent, restart-rehydratable from durable accepted-call state, and still the primary full-flow development/acceptance provider.
- **Production CALL-E adapter:** implemented against the asynchronous Calls API with server-only `CALLE_API_KEY`, stable provider `Idempotency-Key`, structured result schemas, bounded create/poll requests, persisted correlation, polling/webhook convergence, duplicate prevention, restart-by-provider-id semantics, privacy-safe provider diagnostics, and fail-closed ambiguous/stalled handling.
- **Control-plane idempotency:** request-level decision and callback keys are now payload-bound before provider dispatch; provider-level idempotency remains a separate defense against duplicate external calls.
- **Public webhook configuration:** live runtime requires an exact HTTPS origin and constructs the tokenized webhook target structurally. Application request handling strips the capability token from `IncomingMessage.url` immediately after extraction. Reverse-proxy/CDN/APM query-string redaction remains mandatory because those layers may see the raw request first.
- **Shared surfaces:** HTTP, TypeScript SDK, stdio MCP, lifecycle worker, operator console, and deployment flows continue sharing one persistent control-plane state machine.
- **Claude Code:** compiled stdio MCP behavior remains covered by automated and Compose acceptance. A genuine Claude Code host session has still not been observed and is not claimed.
- **Live status:** no authorized real CALL-E phone call has been performed, so live provider connectivity, owner-phone authorization, and externally reachable webhook delivery remain unverified.

## Current blockers / external prerequisites

No repository-development blocker prevents further useful work.

A true Claude Code host acceptance requires an actual Claude Code environment/CLI to register and exercise the compiled stdio MCP server.

Live CALL-E verification still requires user-controlled prerequisites: a valid/authorized CALL-E credential, an authorized owner phone destination, and a stable externally reachable HTTPS origin whose ingress is configured not to log the webhook capability query string.

## Highest-value next actions

1. Extend idempotency mismatch coverage to forced concurrent competing payloads against the same key in the SQLite path, proving the transaction winner becomes the sole durable binding and the loser receives a conflict without a second provider start.
2. Continue the HTTP validation audit, especially escalation `priority` and `expiresAt`, so malformed enum/date inputs fail with stable privacy-safe 4xx responses before entering policy/lifecycle logic.
3. Review live-runtime environment validation ordering for remaining pure settings that can fail only after durable storage opens, and move safe validation earlier where doing so does not duplicate domain rules.
4. Continue hardening operator/reconciler least-privilege boundaries without widening browser or agent credentials.
5. Run the documented acceptance in a genuine Claude Code host when that external prerequisite is available and record only observed host/version behavior.
6. When the user-controlled CALL-E prerequisites are available, perform one tightly bounded live provider acceptance and record only observed behavior.