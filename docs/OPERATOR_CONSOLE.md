# Operator console

CallYourAgent exposes a small built-in operator/demo console at `GET /operator`.

The console is intentionally a thin browser shell over the existing HTTP control-plane APIs. It does not maintain business state, derive a second timeline, or bypass authentication. It is primarily for the hackathon demo and for a single-owner reference deployment where an operator wants to see what an active agent is doing while calls and decisions are progressing.

## What it shows

After entering a run id and a scoped bearer token, the page reads:

- `GET /v1/auth/capabilities` for the effective permissions of the supplied credential;
- `GET /v1/runs/:runId/overview` for the current run snapshot, unresolved blocking scope ids, and queued-owner-steering count;
- `GET /v1/runs/:runId/audit` for the durable causal audit timeline.

The overview is deliberately privacy-safe: it exposes only the **count** of queued owner instructions, never their text or instruction objects. Reading it does not acknowledge or consume steering. This lets the console visibly demonstrate the product's branch-safe behavior: an active independent scope can keep running while another scope waits for owner judgment, and judges can see that steering is pending without the browser receiving the steering content.

The timeline reflects the same persisted events used by SDK/MCP callers: escalation creation, policy deferral/release, provider call transitions, owner decisions, callback requests, queued steering, and safe-checkpoint instruction consumption.

For readability, the browser groups those existing audit event types into presentation-only stage labels: **Needs owner**, **Phone call**, **Decision**, **Callback**, **Steering queued**, and **Steering acknowledged**. These labels do not create or infer new domain state. Each card still renders the persisted event sequence, actor, event type, timestamp, and privacy-safe summary from the audit API. The visual grouping is specifically meant to make the asynchronous human loop obvious to a judge while preserving the metadata-only audit boundary: decision answers, callback transcripts, escalation context, and owner instruction text are not added to the operator payload.

The console can optionally request an owner callback through the existing `POST /v1/callbacks` endpoint. The callback button is disabled until `GET /v1/auth/capabilities` confirms that the active credential has `owner:callback`. This is a fail-closed UX convenience only: the server independently enforces `owner:callback` on callback creation. The console never receives `CALLE_API_KEY` or reconciliation authority.

## Security model

`GET /operator` itself serves only static HTML/CSS/JavaScript and contains no configured API token, webhook token, CALL-E credential, phone number, run state, audit data, or owner-instruction text. All control-plane data requests still require the normal `Authorization: Bearer ...` boundary and scope checks.

The entered token is kept only in the current page's JavaScript memory. The console does not place it in a URL, cookie, local storage, or server-rendered HTML. Operators should still use HTTPS for any non-local deployment so bearer credentials are protected in transit.

The response uses `Cache-Control: no-store`, a restrictive same-origin Content Security Policy, `Referrer-Policy: no-referrer`, and `X-Content-Type-Options: nosniff`.

For least privilege, use a read token containing `agent:read` + `audit:read` for observation. Use a separate owner token containing `agent:read` + `audit:read` + `owner:callback` only when the callback button is needed. Agent-write and reconciliation authority remain separate. The legacy `CYA_API_TOKEN` remains full-access and is therefore less appropriate for an exposed deployment.

## One-command hackathon fixture

For a reproducible local browser demo, run from the repository root:

```bash
npm ci
npm run demo:operator
```

The command builds the project, creates a fresh in-memory control plane with the deterministic fake provider, seeds the demo state through the real `ControlPlane` services, and starts an HTTP server bound to `127.0.0.1:8788` by default. It prints the operator URL, run id, a browser-facing read token scoped to only `agent:read` + `audit:read`, and a separate owner token scoped to `agent:read` + `audit:read` + `owner:callback`.

The seeded state intentionally has:

- active/current scope: `documentation`;
- unresolved blocking scope: `production-deploy`;
- pending owner steering count: `1`.

The fixture retries the same seeded escalation and callback idempotency keys and asserts they deduplicate, so the demo path exercises the same duplicate-call protections as normal fake-provider operation. The seeded callback result is reconciled into a real queued instruction, but the instruction text is not added to the operator overview. The instruction remains queued for the agent's next explicit checkpoint.

The printed read token is deliberately observational. It can load the overview and audit timeline, but the HTTP boundary rejects attempts to use it for `agent:write`, `calls:reconcile`, or `owner:callback`. The separate owner token may request a callback, but it still cannot checkpoint, acknowledge instructions, mutate agent state, or reconcile provider calls.

### Stage 1 — branch-safe decision and seeded steering

Load the run with the read token. The console should show `documentation` active while `production-deploy` is blocked and one steering item is pending.

Press **Enter in the terminal running `demo:operator`**. The same trusted process then advances the fixture by composing only existing domain operations:

1. the deterministic fake provider supplies terminal evidence for the already-created owner-decision call;
2. normal escalation reconciliation records the owner decision and releases `production-deploy`;
3. the agent pulls queued steering with a non-consuming safe checkpoint;
4. the agent acknowledges exactly the instruction ids returned by that checkpoint;
5. the agent reports `production-deploy` as its resumed current scope.

Refresh `/operator`. The blocked-scope list and pending-steering count should both be empty, the active scope should be `production-deploy`, and the durable timeline should include **Decision** and **Steering acknowledged** stages.

### Stage 2 — a fresh owner → agent callback from the browser

Replace the read token with the separately printed owner token and load the same run. Capability discovery should show **Owner callback enabled**.

Click **Call me about this run**. This invokes the normal authenticated `POST /v1/callbacks` contract. The callback request is persisted and its phone task snapshots the run's current status and current scope. The browser receives the ordinary call-attempt response, but it receives no provider credential and cannot reconcile the call itself.

Press **Enter in the demo terminal again**. The trusted process discovers the newly persisted owner callback for this run, completes that exact fake-provider call, and reconciles it through `ControlPlane.reconcileCallback`. The deterministic owner response produces one new durable steering instruction. Refresh `/operator`: the pending-steering count should now be `1`, and the timeline should show a fresh **Callback → Phone call → Steering queued** sequence. The browser still receives only the count, never the instruction text.

Press **Enter a third time**. The trusted process performs a non-consuming checkpoint, verifies that the exact fresh instruction is still queued, and acknowledges only that instruction id. Refresh `/operator`: pending steering returns to `0` and the same causal sequence now ends in **Steering acknowledged**.

This three-stage flow is deliberately built from the real owner callback HTTP contract, deterministic `FakeCallProvider`, normal callback reconciliation, durable instruction queue, explicit checkpoint, and exact acknowledgement. There is no demo-only HTTP mutation endpoint and the browser never receives agent-write or reconciliation authority. Human steering is never presented as interrupting an in-flight model generation.

Repeated in-process calls for each trusted demo stage are guarded so they do not replay the same transition accidentally.

This launcher is intentionally local-only by default and uses an in-memory store. Override the demo port/read token/owner token with `CYA_OPERATOR_DEMO_PORT`, `CYA_OPERATOR_DEMO_TOKEN`, and `CYA_OPERATOR_DEMO_OWNER_TOKEN` if needed. Supplying a different token string does not widen the role's scopes. It is not a production deployment recipe and it does **not** claim live CALL-E success.

## Manual demo workflow

1. Run the control plane with the deterministic fake provider, or use `npm run demo:operator` for the pre-seeded state.
2. Start an agent/run through MCP or the TypeScript/HTTP SDK when exercising the manual path.
3. Open `/operator` in a browser.
4. Enter the run id and a scoped token.
5. Let the agent raise a blocking owner decision in one scope while reporting independent work in another scope.
6. Refresh or enable three-second auto-refresh. The overview should show the independent active scope separately from the unresolved blocked scope(s).
7. Follow the stage-labelled causal timeline to distinguish the decision request, provider-call progress, owner decision, callback, queued steering, and eventual exact acknowledgement.
8. If owner steering has been queued, the page shows only the pending count; the instruction text remains available solely through the agent checkpoint contract.
9. To demonstrate owner → agent control, load an owner-scoped token, request a callback through the page, and let a trusted backend/reconciliation worker process the provider outcome. The browser should not receive reconciliation authority.
10. Consume resulting steering only at the agent's next safe checkpoint and acknowledge exactly the instruction ids actually incorporated.

The console is deliberately not presented as evidence of live CALL-E success. In fake mode it visualizes the deterministic control-plane flow; live phone transport remains separately gated by real CALL-E credentials, an authorized destination, and public HTTPS webhook ingress.
