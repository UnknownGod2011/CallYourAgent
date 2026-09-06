# Integration boundaries

CallYourAgent is designed so external agents integrate through a small set of stable semantics instead of depending on CALL-E directly.

## Required agent capabilities

An integration needs only to be able to:

1. register/identify an agent and active run;
2. report a compact current-status summary;
3. raise an owner-decision request;
4. inspect whether its current scope is blocked;
5. pull queued owner instructions at safe checkpoints.

A richer platform may expose these through MCP tools/hooks. A custom agent can use HTTP/SDK calls directly.

## Target tool semantics

- `register_agent`
- `start_run`
- `report_status`
- `request_owner_decision`
- `get_escalation_status`
- `checkpoint`
- `request_owner_callback`

These names are adapter-level API names; all adapters must delegate to the same control-plane behavior.

## Claude / Claude Code

Primary first external target: expose the control-plane operations as MCP tools and document a Claude Code workflow that calls `checkpoint` between meaningful work units. Hooks may improve ergonomics where supported, but correctness must not depend on an undocumented ability to interrupt generation.

## Codex

Use the same checkpoint model. Codex integration should be an adapter that lets the running workflow publish status, raise an escalation, and consume queued instructions between work units. Do not implement a Codex-only state machine.

## ChatGPT / ChatGPT Work / scheduled workflows

Expose the same server API/MCP surface where the current ChatGPT product and workspace entitlements allow it. Because tool/write availability can vary by product/workspace, the core must remain independently usable through HTTP and must not assume a first-party ChatGPT automation can always accept arbitrary external callbacks mid-run.

## Generic agents

The TypeScript SDK should eventually make the normal loop approximately:

```ts
const run = await cya.startRun(...);
await cya.reportStatus(run.id, ...);
const escalation = await cya.requestOwnerDecision(...);

// Continue unrelated work.

const checkpoint = await cya.checkpoint(run.id);
for (const instruction of checkpoint.queuedInstructions) {
  // incorporate at a safe work boundary
}
```

## Phone-provider boundary

No agent integration receives `CALLE_API_KEY`. Only the trusted CallYourAgent backend talks to CALL-E. This lets provider behavior, retries, webhook reconciliation, call policy, quiet hours, and budgets evolve without changing every agent adapter.
