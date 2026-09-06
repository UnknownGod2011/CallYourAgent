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

## TypeScript HTTP client

`src/client.ts` is the canonical typed client for platform adapters and custom workers. It owns bearer authentication, URL/path encoding, JSON parsing, and typed HTTP errors; it intentionally contains no agent-specific business logic.

```ts
const cya = new CallYourAgentClient({
  baseUrl: process.env.CYA_BASE_URL!,
  apiToken: process.env.CYA_API_TOKEN!,
});

const agent = await cya.registerAgent({ name: "worker", platform: "custom", ownerId: "owner-1" });
const run = await cya.startRun({ agentId: agent.id, summary: "Starting work" });
await cya.reportStatus(run.id, { summary: "Implementing feature A", currentScope: "feature-a" });

const escalation = await cya.requestOwnerDecision({
  runId: run.id,
  scopeId: "feature-a-choice",
  question: "Should I choose approach A or B?",
  blocking: true,
  idempotencyKey: "feature-a-choice-v1",
});

// Other independent scopes may continue.
const checkpoint = await cya.checkpoint(run.id);
```

## MCP adapter

`src/mcp-server.ts` is a thin stdio MCP adapter over `CallYourAgentClient`, which itself delegates to the authenticated HTTP control plane. The MCP process therefore never receives `CALLE_API_KEY`; it only needs:

- `CYA_BASE_URL` — URL of the running CallYourAgent control plane;
- `CYA_API_TOKEN` — the same trusted agent API token used by the HTTP client.

The current MCP tools are:

- `register_agent`
- `start_run`
- `report_status`
- `request_owner_decision`
- `get_escalation_status`
- `checkpoint`
- `request_owner_callback`
- `reconcile_escalation`
- `reconcile_callback`

Build and run the stdio adapter:

```bash
npm install
npm run build
export CYA_BASE_URL=http://127.0.0.1:8787
export CYA_API_TOKEN='replace-with-agent-token'
npm run start:mcp
```

Stdout is reserved for the MCP protocol. Do not add `console.log` output to the stdio process; diagnostics belong on stderr.

The adapter uses the official MCP TypeScript v2 server package. That SDK supports the current 2026-07-28 stateless protocol and legacy host negotiation, so CallYourAgent does not hand-roll MCP lifecycle compatibility.

## Claude / Claude Code

Claude Code is the first external host target because it can launch a local stdio MCP server directly. After the HTTP control plane is running and the project has been built, export `CYA_BASE_URL` and `CYA_API_TOKEN` in the shell that launches Claude Code, then register the adapter from the repository root:

```bash
claude mcp add callyouragent -- node dist/src/mcp-server.js
```

Inside Claude Code, `/mcp` should show the `callyouragent` server and its tools.

The intended workflow is checkpoint-based rather than fake mid-generation interruption:

1. register/start a run;
2. `report_status` between meaningful work units;
3. call `request_owner_decision` only for genuinely important human judgment;
4. continue unrelated scopes when the escalation is non-blocking or branch-scoped;
5. call `checkpoint` between work units and incorporate queued owner instructions before continuing that scope;
6. when the owner independently requests a callback, CALL-E captures steering as queued instructions, which the same checkpoint loop consumes.

This proves the product semantics without requiring Claude Code to support undocumented mid-token interruption.

## Codex

Use the same checkpoint model and the same MCP or typed HTTP client boundary. Codex integration should let a running workflow publish status, raise an escalation, and consume queued instructions between work units. Do not implement a Codex-only state machine.

## ChatGPT / ChatGPT Work / scheduled workflows

Expose the same server API/MCP surface where the current ChatGPT product and workspace entitlements allow it. Because tool/write availability can vary by product/workspace, the core remains independently usable through HTTP and does not assume a first-party ChatGPT automation can accept arbitrary external callbacks mid-run.

## Generic agents

The normal loop is:

```ts
const run = await cya.startRun(...);
await cya.reportStatus(run.id, ...);
const escalation = await cya.requestOwnerDecision(...);

// Continue unrelated work.

const checkpoint = await cya.checkpoint(run.id);
for (const instruction of checkpoint.queuedInstructions) {
  // Incorporate at a safe work boundary.
}
```

## Phone-provider boundary

No agent integration receives `CALLE_API_KEY`. Only the trusted CallYourAgent backend talks to CALL-E. This lets provider behavior, retries, webhook reconciliation, call policy, quiet hours, and budgets evolve without changing every agent adapter.
