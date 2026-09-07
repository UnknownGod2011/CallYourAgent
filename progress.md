# progress.md

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. The core product semantics remain unchanged: an autonomous agent can request genuinely important human judgment without freezing unrelated branches/scopes; the owner can independently request a callback for current progress or steering; human decisions/instructions become durable structured state and are consumed at safe checkpoints rather than being represented as impossible mid-generation interruption.

The repository currently includes SQLite persistence, deterministic fake and production CALL-E providers, replayable/idempotent call attempts, polling/webhook convergence, scoped authenticated HTTP APIs, a typed TypeScript client, stdio MCP, branch/checkpoint semantics, decision-call policy, privacy-aware audit history, bounded lifecycle recovery, fail-closed ambiguous/stalled call handling, API abuse controls, graceful runtime shutdown, hard CALL-E HTTP deadlines, reproducible npm dependencies, a thin operator console, a production container image, a single-instance Docker Compose reference deployment with persistent SQLite storage, and now an assertion-backed deterministic product demo that exercises the complete fake-provider owner-decision/callback/checkpoint story from one command.

## Exact repo state inspected this run

Before making any change, inspected the complete recursive `main` repository tree at commit `f4c798b34dcab34c8b38841f111015b8d36ee44f`. The recursive Git tree reported `truncated=false`; source, tests, package metadata, Docker/deployment assets, CI workflows, and every documentation path were included.

Read `AGENTS.md`, this file, `README.md`, `docs/ARCHITECTURE.md`, `docs/INTEGRATIONS.md`, `docs/CALL_POLICY.md`, `docs/API_SECURITY.md`, `docs/DEPLOYMENT.md`, `docs/OPERATOR_CONSOLE.md`, and `deploy/README.md` in full. Inspected recent commits through the durable Compose-state verification work. Checked repository issues and pull requests; there were none.

Also inspected the relevant implementation surfaces before choosing this increment: `src/http-server.ts`, `src/server.ts`, `src/client.ts`, `src/domain.ts`, `src/call-provider.ts`, the checkpoint/run portions of `src/control-plane.ts`, `tests/http-server.test.ts`, and `package.json`.

The readiness/configuration endpoint remains a high-value operational increment, but this run identified an equally important hackathon/product gap that could be added as an isolated module without disturbing proven server behavior: there was no single executable command that demonstrated the complete core product story and failed loudly if any of its key invariants regressed.

## Existing foundation preserved

- Agent registration, run state, heartbeats/status, branch-scoped blocking, owner decisions, owner callbacks, durable instruction queues, and safe checkpoint consumption.
- In-memory and durable `node:sqlite` stores with WAL, transactions, uniqueness constraints, rollback/reload behavior, durable audit ordering, and restart-safe state.
- Fake CALL-E provider plus production CALL-E Calls API adapter with server-only credentials, structured results, provider idempotency, polling, terminal webhook support, and hard HTTP deadlines.
- Persist-before-side-effect call attempts containing the exact replayable provider request and idempotency key.
- Shared polling/webhook terminal transition and provider-event deduplication.
- Typed HTTP client, stdio MCP adapter, and Claude-style checkpoint/work-loop tests.
- Priority gates, quiet hours, critical bypass, per-run/per-owner call budgets, escalation expiry, durable policy deferral, bounded ambiguous recovery, and stalled accepted-call review state.
- Scoped HTTP credentials and per-credential callback/reconciliation rate limits.
- Owned runtime with non-overlapping lifecycle sweeps and graceful HTTP/lifecycle/store shutdown.
- Reproducible dependency graph enforced with `npm ci`.
- Built-in `/operator` UI over existing authenticated run/audit/callback APIs.
- Production non-root Docker image and deterministic fake-provider container smoke testing.
- Single-instance Compose deployment using a named volume for the full SQLite `/data` directory, with API-created run/audit state verified across a real container restart.

## Changes made this run

### Assertion-backed deterministic product demo

Added `src/demo.ts`, which uses the real `ControlPlane`, `InMemoryControlPlaneStore`, and `FakeCallProvider`. It is not a separate scripted state machine, browser automation, or mock UI path. The demo invokes the same domain methods used by the HTTP/MCP integrations and contains assertions for the product invariants it is meant to demonstrate.

The deterministic flow now proves in one run that:

1. an agent registers and starts a run;
2. a non-blocking owner decision schedules a fake provider call;
3. that non-blocking decision does not appear in `unresolvedBlockingScopes`;
4. the agent reports progress in an unrelated `test-suite` scope while the decision remains pending;
5. a separate blocking escalation affects only the `production-deploy` scope;
6. unrelated documentation work still continues while `production-deploy` is blocked;
7. a fake structured owner decision is reconciled and removes that blocking scope;
8. the earlier non-blocking decision is also reconciled without having frozen unrelated work;
9. the run publishes fresh release status;
10. an owner callback snapshots that current status and current scope into the persisted call request;
11. fake callback completion produces two structured owner steering instructions;
12. those instructions are visible as queued state before consumption;
13. the agent consumes them only at an explicit safe checkpoint;
14. a later checkpoint confirms they are no longer queued;
15. the durable audit timeline contains the expected escalation, owner-decision, callback, instruction-queued, and instruction-consumed transitions.

The CLI entrypoint prints a JSON summary with the generated run/call ids, blocking-scope evidence, callback-context evidence, queued instructions, consumed count, and audit event sequence. Any assertion failure exits non-zero.

### Regression coverage

Added `tests/demo.test.ts`. The normal test suite now executes the same exported demo flow and asserts the key externally understandable outcomes: unrelated work continues, exactly one branch is blocked before the decision, the block disappears after resolution, callback context is current, steering is queued, steering is consumed at a safe checkpoint, and the expected audit events exist.

### Reproducible command and README

Added:

```text
npm run demo
```

to `package.json`, implemented as a normal TypeScript build followed by `node dist/src/demo.js`.

Updated `README.md` with a short deterministic-demo section showing `npm ci` followed by `npm run demo`, what the command proves, and the explicit limitation that this is fake-provider evidence rather than a claim of a live CALL-E phone call.

## Architecture decisions made this run

1. The hackathon demo must execute the existing control-plane domain logic rather than introduce a second demo-only state layer. `src/demo.ts` therefore composes the same `ControlPlane` and `FakeCallProvider` already covered by production-oriented adapters.
2. Product semantics should be executable assertions, not only README claims. If branch scoping, callback status context, queued steering, or checkpoint consumption regresses, `npm run demo`/the test suite should fail.
3. The deterministic demo intentionally requires no CALL-E credential, no owner phone number, no public HTTPS deployment, and no browser. This keeps it safe, repeatable, and useful to judges/developers while live phone verification remains separately gated.
4. The demo explicitly performs unrelated heartbeats while decisions are pending so “non-blocking” is demonstrated as continued work, not inferred merely from a status enum.
5. Callback context is verified from the persisted call request, establishing that the owner receives a snapshot of current agent status rather than stale startup context.
6. Human steering remains queued and checkpoint-consumed. Nothing in this work pretends to interrupt an in-flight model/token generation.
7. The readiness/configuration endpoint remains the preferred next operational source increment and should stay side-effect-free: it must validate deployment configuration without probing CALL-E or initiating a phone call.

## Verification performed

Code-bearing commits:

- `da0dcc7fb6ed0b97c39041dfc2361ae80bcf6f1a` — `feat: add deterministic product demo`
- `d836784d128c24fbbb8afc04a4f700c15b219a8a` — `test: cover deterministic product demo`
- `083975efebedcaadae8e4382f0c969d916b4ea08` — `build: expose deterministic demo command`
- `10998c00e8fdd701928880c4eebd608f37478371` — `docs: add deterministic demo entrypoint`

GitHub Actions on the code-bearing `083975efebedcaadae8e4382f0c969d916b4ea08` state all passed:

- Standard `CI` run `34098411452`: passed. This covers locked `npm ci` plus the repository's `npm run check` pipeline, including TypeScript typecheck, build, and all `dist/tests/*.test.js` tests; the new deterministic demo regression test is therefore included.
- `Compose deployment` run `34098411630`: passed, preserving the persistent-volume restart and API-created state/audit verification.
- `Container` run `34098411383`: passed, preserving the production image build and deterministic fake-provider runtime smoke test.

No live CALL-E call was attempted or claimed.

## CALL-E integration status

- Fake provider: implemented and CI-tested for decision calls, callbacks, branch-scoped blocking, queued owner steering, checkpoint consumption, idempotency, policy, lifecycle recovery, auditability, SQLite restart, operator visualization, production container boot, Compose deployment/persistence, and now exposed through a single assertion-backed `npm run demo` product story.
- Production CALL-E adapter: implemented with server-only API key, structured result schemas, provider idempotency, asynchronous polling, webhook URL construction, terminal reconciliation, bounded create/poll HTTP requests, and duplicate-call prevention.
- Ambiguous create replay using the exact original idempotency key: implemented.
- Bounded automatic recovery/backoff and core recovery-exhaustion enforcement: implemented and tested.
- Accepted-call stale timeout/fail-closed `stalled` state: implemented and tested.
- Webhook event-id validation/deduplication plus durable transaction: implemented.
- HTTP + TypeScript SDK + MCP path: implemented.
- Scoped credentials plus callback/reconciliation rate limits: implemented and tested.
- Graceful server/lifecycle/store shutdown: implemented and tested.
- Production container + persistent-volume Compose deployment: implemented and CI-tested.
- Live CALL-E call: **not attempted and not claimed**. A valid CALL-E credential, authorized owner phone destination, and stable public HTTPS deployment remain external prerequisites.

## Current blockers

There is no blocker to continued repository development.

Live CALL-E verification still requires a valid CALL-E credential, authorized owner phone number, and public HTTPS deployment. Real Claude Code host acceptance still requires an actual Claude Code installation/session. The GitHub connector and GitHub Actions remain sufficient for continued repository mutations and executable verification when a normal local clone is unavailable.

## Highest-value next actions

1. Add a narrowly scoped readiness/configuration endpoint distinct from `/health`. It should report whether the selected fake/live deployment is internally configured correctly, expose no secrets, perform no CALL-E network probe, and never trigger a phone side effect.
2. Evaluate explicit per-instruction acknowledgement semantics so a long-running agent can mark a specific steering instruction consumed only after it has incorporated it, without accidentally consuming a later-arriving instruction in the same checkpoint window. Preserve compatibility with the current simple checkpoint API unless the stronger delivery semantics clearly justify an extension.
3. Exercise the documented Claude Code stdio MCP registration path in a real Claude Code host when such an environment becomes available, and record exact acceptance evidence.
4. Consider exposing read-only unresolved-blocking-scope and queued-instruction counts in the operator console for a clearer hackathon visualization, without consuming state or creating a second business-state layer.
5. Add broader Codex/ChatGPT adapters only where current platform capabilities genuinely support the existing tool/checkpoint semantics; never claim mid-generation interruption.
