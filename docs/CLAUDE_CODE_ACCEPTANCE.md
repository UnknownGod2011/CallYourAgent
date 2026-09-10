# Claude Code host acceptance

This runbook defines the first **real external-host acceptance** for CallYourAgent. It is intentionally separate from the repository's automated MCP tests: CI already proves the built stdio MCP process, authenticated HTTP client, control plane, SQLite persistence, restart recovery, branch-scoped blocking, callback lifecycle observation, and exact instruction acknowledgement. This checklist is for validating that an actual Claude Code host can drive that same adapter correctly.

Passing this checklist is evidence of Claude Code host compatibility. It is **not** evidence of a live CALL-E phone call unless the control plane is explicitly running with `CYA_CALL_PROVIDER=calle` and an authorized real call is independently observed. Prefer the deterministic fake provider for this host acceptance.

## Preconditions

Use Node 24+ and build the repository first:

```bash
npm ci
npm run check
```

Start one durable fake-provider control plane with a least-privilege credential bundle. The Claude Code MCP process should receive only the `agent` bearer token (`agent:read`, `agent:write`, `decision:read`, `audit:read`). Keep owner callback and provider reconciliation credentials separate.

For the reference Compose deployment, follow `deploy/README.md`. Set these in the shell that launches Claude Code:

```bash
export CYA_BASE_URL=http://127.0.0.1:8787
export CYA_API_TOKEN='<agent-role-token>'
```

Do **not** expose `CALLE_API_KEY`, the owner phone number, the webhook capability token, or the reconciler token to Claude Code or the MCP child.

## Register the MCP server

From the repository root after `npm run build`:

```bash
claude mcp add callyouragent -- node dist/src/mcp-server.js
```

Open Claude Code and use `/mcp`. The `callyouragent` server must connect successfully and advertise at least:

- `register_agent`
- `start_run`
- `report_status`
- `request_owner_decision`
- `get_escalation_lifecycle_status`
- `get_escalation_status`
- `get_callback_status`
- `checkpoint`
- `acknowledge_owner_instructions`
- `get_audit_timeline`

Tool discovery alone is not proof of authorization. The HTTP control plane remains the permission boundary.

## Acceptance scenario

Use a fresh logical run and stable idempotency keys. Record the returned `agentId`, `runId`, `escalationId`, callback id, and instruction id so the audit trail can be correlated afterward.

### 1. Register and start

Ask Claude Code to call `register_agent` with platform `claude-code`, then `start_run` with an initial active scope such as `documentation`.

Pass condition: both calls succeed and return durable ids.

### 2. Prove branch-scoped blocking

Call `report_status` with `currentScope=documentation`. Then call `request_owner_decision` with:

- `scopeId=release-approval`
- `blocking=true`
- a genuinely human-judgment question
- a stable idempotency key

Immediately call `checkpoint` with `consume=false`.

Pass condition: `release-approval` appears in `unresolvedBlockingScopes` while Claude Code can still continue unrelated work such as `documentation`. The host must not interpret one blocked scope as a requirement to freeze the entire run.

### 3. Resolve the decision outside the agent credential

Use the trusted fake-provider/reconciler path documented by the deployment to complete and reconcile the pending decision. Do not give the reconciler token to Claude Code.

Then have Claude Code call `get_escalation_status` for the original escalation.

Pass condition: the same escalation returns exactly one durable owner decision and the affected scope can resume. Retrying the same logical request with the original idempotency key must not create another call.

### 4. Prove owner -> agent callback lifecycle and checkpointed steering

Using the separate owner credential, request a callback for the same active run. Record the returned callback id before any terminal reconciliation.

Have Claude Code call `get_callback_status` immediately.

Pass condition: the same callback id is visible with an operational non-terminal status such as `queued` or `in_progress`, without exposing callback prompt text, phone task contents, provider metadata, transcripts, or steering text.

If the control plane is being exercised with the reference restart acceptance, restart the CallYourAgent service **while this callback is still non-terminal**, keep the same Claude Code/MCP host session connected, and call `get_callback_status` again after readiness returns.

Pass condition: the same durable callback id remains observable as non-terminal after restart. The host must not require a new callback request or a new MCP session merely because the control plane restarted.

Complete/reconcile that fake-provider callback using the separate reconciler credential so it creates one queued owner instruction. Retry reconciliation once with the same callback id to exercise idempotency.

Have Claude Code call `get_callback_status` again.

Pass condition: the same callback id is now `completed`; the retry did not create another callback or duplicate steering.

Have Claude Code call `checkpoint` with `consume=false`.

Pass condition: exactly the durable queued instruction produced by the callback is returned to Claude Code but remains unconsumed until the host reaches this explicit safe work boundary.

Have Claude Code incorporate the instruction, then call `acknowledge_owner_instructions` with **exactly** the instruction ids it incorporated.

Call `checkpoint` again.

Pass condition: the acknowledged instruction is no longer queued. A repeated acknowledgement of the same id remains idempotent, and any instruction arriving later is not accidentally consumed.

### 5. Inspect the causal audit trail

Call `get_audit_timeline` for the run.

Pass condition: the timeline shows the expected causal sequence for registration/run work, escalation/call transitions, owner decision, callback, queued steering, and steering acknowledgement without exposing full callback transcripts or copying owner instruction text into audit metadata.

For the owner callback specifically, correlate one durable `callAttemptId` through exactly one ordered chain:

```text
call_attempt_created
  -> owner_callback_requested
  -> call_attempt_started
  -> call_attempt_completed
  -> owner_instruction_queued
```

The request/reservation and `owner_callback_requested` audit are committed locally before any provider side effect begins, so the causal owner request must appear before `call_attempt_started`. The `owner_instruction_queued` event must supply the resulting `instructionId`; the later `owner_instruction_consumed` event must reference that same `instructionId`. Consumption is intentionally instruction-correlated rather than pretending the safe checkpoint itself is a provider-call transition. A successful restart/retry path must not fabricate `call_attempt_ambiguous` or `call_attempt_failed` events for that callback.

## Negative authorization checks

With the normal Claude Code `agent` credential, attempts to use `request_owner_callback`, `reconcile_escalation`, or `reconcile_callback` should fail with authorization errors in the standard least-privilege deployment. The MCP adapter may advertise those tools, but successful tool discovery must never widen HTTP authorization.

The agent credential may use `get_callback_status` because it is a privacy-safe `agent:read` observation surface. That permission does not grant callback creation, reconciliation, provider correlation data, callback prompt text, or steering text.

The MCP error returned to the host must not contain upstream response bodies, bearer tokens, owner phone data, webhook capability tokens, or owner instruction text. Only a generic CallYourAgent error message and, for HTTP failures, the status code are exposed.

## Pass/fail definition

The Claude Code host acceptance passes only if all of the following are observed in one real host session:

1. Claude Code connects to the built stdio adapter and discovers the expected tools, including `get_callback_status`.
2. The agent registers and starts a run through MCP.
3. A blocking owner decision blocks only its target scope while unrelated work can continue.
4. The decision is persisted and later consumed by the same agent path without duplicate call creation.
5. An owner-requested callback can be observed as non-terminal through `get_callback_status` without exposing sensitive call content.
6. If the restart scenario is exercised, the same callback remains observable through the same MCP host session after control-plane restart.
7. Callback reconciliation produces exactly one completed callback and one durable queued instruction even when reconciliation is retried.
8. Claude Code receives that steering only at an explicit safe checkpoint.
9. Claude Code acknowledges exactly the instruction ids it incorporated.
10. Repeated acknowledgement is idempotent and later steering remains queued.
11. Agent credentials cannot perform owner-callback or provider-reconciliation operations.
12. Audit output contains one callback `callAttemptId -> instructionId` causal chain, remains privacy-aware, and MCP errors do not echo sensitive upstream payloads.

If any item fails, record the Claude Code version, CallYourAgent commit SHA, control-plane provider/store mode, exact failed tool, HTTP status if present, and whether the failure is host registration, authorization, transport, restart recovery, or domain-state related. Do not work around a failure by widening the agent credential to `*`.

## What this does not prove

A successful host acceptance does not prove:

- mid-token interruption (CallYourAgent deliberately uses safe checkpoints instead);
- live CALL-E connectivity or phone authorization;
- public webhook reachability;
- multi-instance/distributed safety beyond the documented single-instance SQLite topology.

Those are separate deployment/provider concerns and should remain reported separately.
