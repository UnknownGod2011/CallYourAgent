# CallYourAgent progress

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. Agents can escalate important decisions without freezing unrelated scopes; owners can independently request callbacks for progress/questions/steering; human input is persisted as structured state and consumed only at explicit safe checkpoints rather than pretending to interrupt in-flight model generation.

The repository includes deterministic fake and production CALL-E providers, SQLite persistence, replayable/idempotent call attempts, polling/webhook convergence, branch-scoped blocking, owner decision persistence, durable per-run instruction queues, exact instruction acknowledgement, quiet hours/call budgets, bounded lifecycle recovery, fail-closed ambiguous/stalled handling, privacy-aware audit history, scoped HTTP authentication, a typed TypeScript client, a real stdio MCP adapter, deterministic end-to-end/demo flows, an operator console, a Claude Code host-acceptance runbook, and a single-instance persistent-volume Compose reference deployment.

This run continued the privacy/security audit after reconciliation-response hardening and found a concrete remaining production-provider leak path: CALL-E HTTP error responses were already sanitized, but an arbitrary exception thrown by the fetch/network transport itself propagated through `CalleCallProvider` unchanged. Because ambiguous create failures are intentionally persisted as `CallAttempt.lastError`, a transport stack, proxy, injected fetch implementation, or future networking layer could accidentally place secret-bearing exception text into durable control-plane state. PR #23 now sanitizes that transport boundary before the error can reach persistent recovery state while preserving timeout classification and ambiguous-create behavior.

## Exact repo state inspected this run

The run started from `main` HEAD `f4b6044ba2def749180be44de566f37bc3774157`, immediately after PR #22 and its progress handoff documenting successful reconciliation-response privacy hardening.

Before changing code, inspected the complete recursive repository tree through GitHub's recursive tree API, covering the root, `.github/workflows`, `deploy`, every file under `docs`, all `src` implementation surfaces, and the full `tests` suite. Inspected the recent commit chain through PR #22 and verified there were no open issues and no open pull requests before this run.

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

Also inspected the relevant implementation/test surfaces, especially `src/control-plane.ts`, `src/calle-provider.ts`, `src/store.ts`, and the existing CALL-E/provider/privacy tests including `tests/calle-provider.test.ts`.

The audit confirmed that the public HTTP and MCP response projections no longer expose `CallAttempt.lastError`, and CALL-E non-2xx response bodies are already excluded from thrown errors. The remaining concrete gap was below those presentation boundaries: `CalleCallProvider.start()` and `observe()` awaited the configured fetch implementation directly. A thrown exception therefore retained its arbitrary original message. `ControlPlane.dispatchCallAttempt()` and ambiguous recovery deliberately persist provider create failures in `lastError` for operational/recovery context, so a secret-bearing network exception could survive in SQLite even though it was not currently returned through ordinary public views.

## Changes made this run

PR #23, `Sanitize CALL-E transport errors before persistence`, changed `src/calle-provider.ts` and added `tests/calle-transport-error-privacy.test.ts`.

The production CALL-E adapter now normalizes exceptions thrown by the transport boundary before returning them to the control plane:

- create-side transport failures become `CALL-E create transport failed`;
- polling/get-side transport failures become `CALL-E get transport failed`;
- timeout exceptions retain `name === "TimeoutError"` so existing timeout behavior/tests and operational classification remain intact, but their potentially arbitrary message is replaced by `CALL-E create timed out` or `CALL-E get timed out`;
- no original transport exception message, cause, request URL, phone number, task text, API credential, webhook URL/token, or other fetch-layer diagnostic is copied into the sanitized error.

This means an ambiguous CALL-E create still becomes a durable `CallAttempt` in the same fail-closed state and still reuses the exact original idempotency key for bounded recovery, but `lastError` now contains only the small provider-owned privacy-safe classification rather than arbitrary networking text.

The new regressions prove two boundaries:

1. A deliberately secret-bearing transport exception during an owner callback produces an `ambiguous` call attempt whose durable `lastError` is exactly `CALL-E create transport failed` and contains none of the injected webhook token, owner phone, or owner callback prompt.
2. Polling transport errors similarly expose only `CALL-E get transport failed`, while a deliberately secret-bearing `TimeoutError` retains its timeout type with only the sanitized `CALL-E get timed out` message.

The change is intentionally narrow. It does not alter CALL-E request bodies, server-side credential handling, idempotency keys, call reservation ordering, provider correlation, polling/webhook convergence, branch-scoped blocking, callback steering, safe-checkpoint consumption, HTTP authorization, or fake-provider behavior.

## Verification performed

Direct repository execution in the automation container was not used; authoritative verification ran through the repository's GitHub Actions matrix against PR #23 head `e4cac008c1c2bea1931bc7ab80c20d1ae6db916f`.

- CI run `34447950506` — **success** on Node `24.20.0`; `npm run check` completed TypeScript typechecking, build, and the Node test suite with **148 tests, 148 passed, 0 failed, 0 cancelled, 0 skipped, 0 todo**. Both new transport-error privacy regressions passed explicitly, and the existing CALL-E timeout tests remained green.
- Container run `34447950460` — **success**; the production image/runtime smoke path passed.
- Compose deployment run `34447950499` — **success**. The full production-style fake-provider acceptance remained green through generated scoped credentials, Compose validation, durable SQLite boot, compiled stdio MCP, branch-blocking owner-decision creation, restart while the decision call was active, branch-specific release, owner context-aware callback creation, restart while the callback was active, exactly-once restored callback reconciliation/steering, another restart with steering durable, and consumption only at the explicit safe checkpoint.

PR #23 was squash-merged into `main` as `ec5bfd65fa3af0e301eb20b7342790c1204f3eff`.

`package.json` still has no separate lint script and no standalone migration/schema-check command. `npm run check` covers typechecking, build, and tests; SQLite tests exercise the durable schema/transaction path; Container and Compose exercise the production image/runtime/deployment behavior.

No live CALL-E phone call was attempted or claimed.

## Architecture decisions made this run

1. Sanitize provider transport failures at the production provider adapter boundary rather than relying on every downstream presentation surface to remember to redact them. Once arbitrary transport text reaches durable state, future operational tooling could accidentally expose it.
2. Preserve ambiguous-create semantics. A network exception after a create request may mean CALL-E accepted the phone side effect, so sanitization must not relabel the outcome as a definite failure or create a replacement idempotency key.
3. Preserve timeout classification without preserving timeout messages. Code may safely distinguish `TimeoutError`, but the networking implementation's message is not trusted diagnostic content.
4. Keep durable recovery state useful but bounded. `lastError` remains available internally as a coarse operational classification; replayable task/idempotency/provider-correlation state remains unchanged because restart/ambiguous recovery depends on it.
5. Do not add a broad control-plane redactor yet. The production CALL-E adapter is the boundary that handles the concrete phone/API/webhook secrets audited here. A generic future provider-error contract should be designed explicitly rather than silently destroying all adapter diagnostics.
6. No branch or checkpoint semantics changed: only the affected blocking scope waits, unrelated scopes continue, and human steering remains durable queued state consumed at a safe checkpoint.

## CALL-E integration status

- **Fake provider:** deterministic, credential-free, idempotent, restart-rehydratable from durable accepted-call state, and still the primary full-flow development/acceptance provider. The complete Compose acceptance remains green after this change.
- **Production CALL-E adapter:** implemented against the asynchronous Calls API with server-only `CALLE_API_KEY`, stable `Idempotency-Key`, structured result schemas, bounded create/poll requests, persisted correlation, polling/webhook convergence, duplicate prevention, restart-by-provider-id semantics, sanitized HTTP response failures, now-sanitized transport exceptions, and fail-closed ambiguous/stalled handling.
- **Shared surfaces:** HTTP, TypeScript SDK, stdio MCP, lifecycle worker, operator console, and deployment flows continue to share the same persistent control-plane state machine. This run changes only how the CALL-E adapter classifies transport exceptions before they reach that state machine.
- **Claude Code:** compiled stdio MCP behavior remains covered by automated and Compose acceptance. A genuine Claude Code host session has still not been observed and is not claimed.
- **Live status:** no authorized real CALL-E phone call has been performed, so live provider connectivity, owner-phone authorization, and public webhook success remain unverified.

## Current blockers / external prerequisites

No repository-development blocker prevents further useful work.

A true Claude Code host acceptance requires an actual Claude Code environment/CLI to register and exercise the compiled stdio MCP server.

Live CALL-E verification still requires user-controlled prerequisites: a valid/authorized CALL-E credential, an authorized owner phone destination, and stable public HTTPS webhook ingress configured with the application-owned webhook capability token.

## Highest-value next actions

1. Continue the provider/error privacy audit by deciding on an explicit provider-safe diagnostic contract for generic/custom `CallProvider` adapters. The production CALL-E path is now protected, but a future third-party adapter can still throw arbitrary text that the control plane may persist during ambiguous create recovery unless the port contract requires privacy-safe errors.
2. Audit runtime/lifecycle stderr and operational logging paths, especially request URL logging around `/webhooks/calle`, so the application-owned webhook capability token carried in the query string cannot leak through proxy/application diagnostics.
3. Review lifecycle sweep versus explicit callback/decision reconciliation for same-attempt concurrent observe/apply overlap not already covered by webhook-vs-poll and ambiguous-recovery single-flight tests. Add synchronization only if a reproducible divergence exists.
4. Continue tightening stable API conflict/validation semantics without reintroducing arbitrary exception reflection.
5. Run the documented acceptance in a genuine Claude Code host when that external prerequisite is available and record only observed host/version behavior.
6. When the user-controlled CALL-E prerequisites are available, perform one tightly bounded live provider acceptance and record only observed behavior.
