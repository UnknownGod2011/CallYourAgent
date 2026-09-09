# Claude Code host acceptance

This runbook defines the first **real external-host acceptance** for CallYourAgent. It is intentionally separate from the repository's automated MCP tests: CI already proves the built stdio MCP process, authenticated HTTP client, control plane, SQLite persistence, restart recovery, branch-scoped blocking, and exact instruction acknowledgement. This checklist is for validating that an actual Claude Code host can drive that same adapter correctly.

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
- `get_escalation_status`
- `checkpoint`
- `acknowledge_owner_instructions`
- `get_audit_timeline`

Tool discovery alone is not proof of authorization. The HTTP control plane remains the permission boundary.

## Acceptance scenario

Use a fresh logical run and stable idempotency keys. Record the returned `agentId`, `runId`, and `escalationId` so the audit trail can be inspected afterward.

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

### 4. Prove owner -> agent steering is checkpointed

Using the separate owner credential, request a callback for the same active run. Complete/reconcile that fake-provider callback using the reconciler credential so it creates one queued owner instruction.

Have Claude Code call `checkpoint` with `consume=false`.

Pass condition: the queued instruction is returned to Claude Code but is still durable and unconsumed until the host reaches this explicit safe work boundary.

Have Claude Code incorporate the instruction, then call `acknowledge_owner_instructions` with **exactly** the instruction ids it incorporated.

Call `checkpoint` again.

Pass condition: the acknowledged instruction is no longer queued. A repeated acknowledgement of the same id remains idempotent, and any instruction arriving later is not accidentally consumed.

### 5. Inspect the causal audit trail

Call `get_audit_timeline` for the run.

Pass condition: the timeline shows the expected causal sequence for registration/run work, escalation/call transitions, owner decision, callback, queued steering, and steering acknowledgement without exposing full callback transcripts or copying owner instruction text into audit metadata.

## Negative authorization checks

With the normal Claude Code `agent` credential, attempts to use `request_owner_callback`, `reconcile_escalation`, or `reconcile_callback` should fail with authorization errors in the standard least-privilege deployment. The MCP adapter may advertise those tools, but successful tool discovery must never widen HTTP authorization.

The MCP error returned to the host must not contain upstream response bodies, bearer tokens, owner phone data, webhook capability tokens, or owner instruction text. Only a generic CallYourAgent error message and, for HTTP failures, the status code are exposed.

## Pass/fail definition

The Claude Code host acceptance passes only if all of the following are observed in one real host session:

1. Claude Code connects to the built stdio adapter and discovers the expected tools.
2. The agent registers and starts a run through MCP.
3. A blocking owner decision blocks only its target scope while unrelated work can continue.
4. The decision is persisted and later consumed by the same agent path without duplicate call creation.
5. Owner-requested callback steering becomes durable queued state.
6. Claude Code receives that steering only at an explicit safe checkpoint.
7. Claude Code acknowledges exactly the instruction ids it incorporated.
8. Repeated acknowledgement is idempotent and later steering remains queued.
9. Agent credentials cannot perform owner-callback or provider-reconciliation operations.
10. Audit output remains privacy-aware and MCP errors do not echo sensitive upstream payloads.

If any item fails, record the Claude Code version, CallYourAgent commit SHA, control-plane provider/store mode, exact failed tool, HTTP status if present, and whether the failure is host registration, authorization, transport, or domain-state related. Do not work around a failure by widening the agent credential to `*`.

## What this does not prove

A successful host acceptance does not prove:

- mid-token interruption (CallYourAgent deliberately uses safe checkpoints instead);
- live CALL-E connectivity or phone authorization;
- public webhook reachability;
- multi-instance/distributed safety beyond the documented single-instance SQLite topology.

Those are separate deployment/provider concerns and should remain reported separately.
