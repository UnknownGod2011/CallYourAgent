# CallYourAgent progress

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. Agents can escalate important decisions without freezing unrelated scopes; owners can independently request callbacks for progress/questions/steering; human input is persisted as structured state and consumed only at explicit safe checkpoints rather than pretending to interrupt in-flight model generation.

The repository includes deterministic fake and production CALL-E providers, SQLite persistence, replayable/idempotent call attempts, polling/webhook convergence, branch-scoped blocking, owner decision persistence, durable per-run instruction queues with exact acknowledgement, quiet hours/call budgets, bounded lifecycle recovery, fail-closed ambiguous/stalled handling, privacy-aware audit history, scoped HTTP authentication, a typed TypeScript client, a real stdio MCP adapter, deterministic end-to-end/demo flows, an operator console, a Claude Code host-acceptance runbook, and a single-instance persistent-volume Compose reference deployment.

This run continued the HTTP transport-validation audit. PR #38 hardened every dynamic run/escalation/callback path identifier so malformed percent-encoding becomes a stable privacy-safe client error rather than falling into the generic internal-error path.

## Exact repo state inspected this run

The run started from `main` HEAD `f22e831aa1c974adad86c2664957ace417acfdc9`, the progress handoff after PR #37 (`08628aac99897b2cc8f0591f23b9656c3ecc1adf`).

Before any change, inspected the complete recursive repository tree and current source/test inventory, recent commits, current issue state, and recent pull requests. The recursive Git tree was complete (`truncated: false`). There were no open issues and no pre-existing open pull requests.

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

Also inspected `src/http-server.ts`, the current HTTP validation tests, recent validation/idempotency/concurrency work, and all dynamic route forms before modifying repository content.

The inspection confirmed that dynamic HTTP identifiers were decoded with raw `decodeURIComponent(...)`. Malformed percent sequences therefore raised a URI decoding exception that reached the generic `500 internal_error` boundary. It also confirmed that reconciliation rate-limit budget was consumed before those identifiers were decoded.

The automation container's direct GitHub DNS path remained unreliable for a local clone, so GitHub Actions was used as the authoritative executable verification path.

## Changes made this run

PR #38, `Harden malformed path identifier handling`, changed `src/http-server.ts` and added `tests/http-path-identifier-validation.test.ts`.

The HTTP path boundary now:

1. routes all dynamic run, escalation, and callback identifiers through one `pathIdentifier(...)` decoder;
2. converts malformed percent-encoding into stable HTTP `400 {"error":"invalid_path_identifier"}`;
3. never reflects the malformed/attacker-controlled identifier in the response;
4. covers run read, overview, audit, heartbeat, checkpoint, instruction acknowledgement, escalation lifecycle/read/reconcile, and callback read/reconcile routes;
5. decodes reconciliation identifiers before consuming the reconciliation rate-limit bucket, so malformed requests do not burn a legitimate reconciliation slot;
6. preserves normal decoded identifiers and all existing domain/not-found behavior;
7. leaves branch-scoped blocking, owner decisions, callback steering, MCP/SDK behavior, fake/live providers, and safe-checkpoint semantics unchanged.

The deterministic regressions exercise malformed `%` encoding across all 11 dynamic identifier route forms and verify the exact privacy-safe 400 response. A separate regression sets the reconciliation budget to one request, proves a malformed path does not consume it, proves the next valid-but-unknown reconcile request reaches the domain 404 path, and proves a subsequent request then receives the expected 429.

PR #38 was squash-merged into `main` as `d46164c53659757cb2dc163713741bd554cc597d`.

## Verification performed

Authoritative final verification ran against PR head `a5a0ef43e4d46ec3f4f561b5ed61b71b8d91cdd4`:

- CI run `34535444730` — **success** on Node 24.20.0. Locked dependency installation succeeded, TypeScript typecheck succeeded, build succeeded, and **187/187 tests passed**, 0 failures. Both new path-identifier regressions passed.
- Container run `34535444818` — **success**. The production image/runtime path remained green.
- Compose deployment run `34535444970` — **success**. Scoped credential generation and capability checks passed; the compiled stdio MCP adapter worked against the deployed control plane; a durable branch-blocking owner decision survived restart and released only its affected branch; a context-aware owner callback survived restart; reconciliation queued steering exactly once; another restart preserved that steering; and the instruction was consumed only at an explicit safe checkpoint.

`package.json` still has no separate lint script and no standalone migration/schema-check command. `npm run check` covers typecheck, build, and tests; SQLite regressions exercise schema/transaction durability, and Container/Compose cover packaged runtime/deployment behavior.

No live CALL-E phone call was attempted or claimed.

## Architecture decisions made this run

1. Path decoding is part of the typed HTTP transport boundary; malformed encoding is a client-correctable request error, not an internal control-plane failure.
2. Dynamic identifiers use one decoder so route behavior cannot drift between run, escalation, callback, checkpoint, audit, and reconciliation surfaces.
3. Privacy-safe validation errors use a stable code and never echo hostile path material.
4. Transport-invalid requests should fail before scarce/side-effect-adjacent infrastructure controls such as reconciliation rate-limit budget are consumed.
5. Valid identifiers still flow to the existing domain layer unchanged, and unexpected failures remain protected by the fail-closed `500 internal_error` boundary.

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

1. Continue the HTTP boundary audit for remaining singleton query/cardinality assumptions and unexpected query parameters, rejecting ambiguous transport forms before domain work where appropriate.
2. Review runtime environment validation ordering for settings that can still fail only after durable storage opens, moving safe pure validation earlier where appropriate.
3. Continue least-privilege review of owner/operator/reconciler surfaces without widening browser or normal-agent credentials.
4. Add explicit store-contract tests before introducing any Postgres/multi-instance deployment so atomic idempotency winner-selection remains a required adapter property.
5. Review identifier canonicalization expectations only where needed for interoperability; do not normalize valid opaque IDs in ways that could alter domain identity.
6. Run the documented acceptance in a genuine Claude Code host when that external prerequisite is available and record only observed host/version behavior.
7. When the user-controlled CALL-E prerequisites are available, perform one tightly bounded live provider acceptance and record only observed behavior.
