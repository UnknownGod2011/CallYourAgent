# Operator console

CallYourAgent exposes a small built-in operator/demo console at `GET /operator`.

The console is intentionally a thin browser shell over the existing HTTP control-plane APIs. It does not maintain business state, derive a second timeline, or bypass authentication. It is primarily for the hackathon demo and for a single-owner reference deployment where an operator wants to see what an active agent is doing while calls and decisions are progressing.

## What it shows

After entering a run id and a scoped bearer token, the page reads:

- `GET /v1/runs/:runId/overview` for the current run snapshot, unresolved blocking scope ids, and queued-owner-steering count;
- `GET /v1/runs/:runId/audit` for the durable causal audit timeline.

The overview is deliberately privacy-safe: it exposes only the **count** of queued owner instructions, never their text or instruction objects. Reading it does not acknowledge or consume steering. This lets the console visibly demonstrate the product's branch-safe behavior: an active independent scope can keep running while another scope waits for owner judgment, and judges can see that steering is pending without the browser receiving the steering content.

The timeline reflects the same persisted events used by SDK/MCP callers: escalation creation, policy deferral/release, provider call transitions, owner decisions, callback requests, queued steering, and safe-checkpoint instruction consumption.

The console can optionally request an owner callback through the existing `POST /v1/callbacks` endpoint. This requires a credential with `owner:callback`. It does not add another callback path and does not receive `CALLE_API_KEY`.

## Security model

`GET /operator` itself serves only static HTML/CSS/JavaScript and contains no configured API token, webhook token, CALL-E credential, phone number, run state, audit data, or owner-instruction text. All control-plane data requests still require the normal `Authorization: Bearer ...` boundary and scope checks.

The entered token is kept only in the current page's JavaScript memory. The console does not place it in a URL, cookie, local storage, or server-rendered HTML. Operators should still use HTTPS for any non-local deployment so bearer credentials are protected in transit.

The response uses `Cache-Control: no-store`, a restrictive same-origin Content Security Policy, `Referrer-Policy: no-referrer`, and `X-Content-Type-Options: nosniff`.

For least privilege, use a read token containing `agent:read` + `audit:read` for observation. Use a separate owner token with `owner:callback` only when the callback button is needed. The legacy `CYA_API_TOKEN` remains full-access and is therefore less appropriate for an exposed deployment.

## Demo workflow

1. Run the control plane with the deterministic fake provider.
2. Start an agent/run through MCP or the TypeScript/HTTP SDK.
3. Open `/operator` in a browser.
4. Enter the run id and a scoped token.
5. Let the agent raise a blocking owner decision in one scope while reporting independent work in another scope.
6. Refresh or enable three-second auto-refresh. The overview should show the independent active scope separately from the unresolved blocked scope(s).
7. If owner steering has been queued, the page shows only the pending count; the instruction text remains available solely through the agent checkpoint contract.
8. If using an owner-scoped token, request a callback from the page.
9. After fake-provider completion, the timeline will show the callback and queued steering; after the agent's next safe checkpoint and exact acknowledgement, it will show instruction consumption.

The console is deliberately not presented as evidence of live CALL-E success. In fake mode it visualizes the deterministic control-plane flow; live phone transport remains separately gated by real CALL-E credentials, an authorized destination, and public HTTPS webhook ingress.
