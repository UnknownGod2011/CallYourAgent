# Integration boundaries

CallYourAgent is designed so external agents integrate through a small set of stable semantics instead of depending on CALL-E directly.

## Required agent capabilities

An integration needs only to be able to:

1. register/identify an agent and active run;
2. report a compact current-status summary;
3. raise an owner-decision request;
4. inspect whether its current scope is blocked;
5. pull queued owner instructions at safe checkpoints;
6. acknowledge exactly the instruction ids it actually incorporated.

A richer platform may expose these through MCP tools/hooks. A custom agent can use HTTP/SDK calls directly. Audit-timeline access is optional and observational; it is useful for operators, demos, and agent self-inspection but is not required for the core decision/callback loop.

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
for (const instruction of checkpoint.queuedInstructions) {
  // Incorporate at this safe work boundary.
}
await cya.acknowledgeInstructions(
  run.id,
  checkpoint.queuedInstructions.map((instruction) => instruction.id),
);
const timeline = await cya.getAuditTimeline(run.id);
```

The preferred instruction flow is deliberately two-phase: read a checkpoint without consuming it, incorporate only the returned instructions, then acknowledge those exact ids. If new steering arrives between the pull and acknowledgement, it remains queued for the next checkpoint. Acknowledgement retries are idempotent. The legacy `checkpoint(runId, true)` behavior remains for compatibility, but new integrations should prefer exact acknowledgement.

## MCP adapter

`src/mcp-server.ts` is a thin stdio MCP adapter over `CallYourAgentClient`, which itself delegates to the authenticated HTTP control plane. The MCP process therefore never receives `CALLE_API_KEY`; it only needs:

- `CYA_BASE_URL` — URL of the running CallYourAgent control plane;
- `CYA_API_TOKEN` — the same trusted agent API token used by the HTTP client.

The current MCP tools are:

- `register_agent`
- `start_run`
- `report_status`
- `get_audit_timeline`
- `request_owner_decision`
- `get_escalation_lifecycle_status`
- `get_escalation_status`
- `checkpoint`
- `acknowledge_owner_instructions`
- `request_owner_callback`
- `get_callback_status`
- `reconcile_escalation`
- `reconcile_callback`

`get_escalation_lifecycle_status` mirrors the privacy-safe `GET /v1/escalations/:id/status` HTTP contract. It requires only `agent:read` and returns operational lifecycle metadata without the escalation question/context, provider correlation, or owner decision answer. Owner/operator integrations should use this tool when they only need to observe whether an escalation is pending, calling, resolved, expired, or failed.

`get_escalation_status` is deliberately different: it is the decision-consumption surface for the agent that raised the escalation and requires both `agent:read` and `decision:read`. It may return the owner's durable answer and structured result. Do not grant an owner/operator credential `decision:read` merely so it can inspect lifecycle state.

`get_callback_status` mirrors the privacy-safe `GET /v1/callbacks/:id` HTTP contract. It requires only `agent:read` and returns the durable callback/call-attempt lifecycle view without callback prompt text, phone task contents, provider metadata, transcripts, or queued steering text. This lets Claude Code, Codex, an owner console, or another MCP host observe whether a callback is still queued/in progress or has reached a terminal state without receiving sensitive call content.

`get_audit_timeline` is read-only. It exposes operational events and safe metadata, not full call transcripts, escalation context, owner decision answers, or owner instruction text.

MCP tool discovery is not an authorization boundary. A server may advertise tools that the configured bearer credential cannot execute; the HTTP control plane remains authoritative and returns a scoped authorization error. This keeps the MCP adapter thin and prevents a second platform-specific permission system from diverging from the HTTP/SDK contract.

Build and run the stdio adapter:

```bash
npm install
npm run legacy:build
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
5. use `get_escalation_status` when the agent needs to consume a durable owner answer; use `get_escalation_lifecycle_status` for privacy-safe observation where the answer is not needed;
6. call `checkpoint` between work units without consuming instructions;
7. incorporate the returned queued instructions at that safe boundary, then call `acknowledge_owner_instructions` with exactly those ids;
8. when the owner independently requests a callback, `get_callback_status` can observe that phone interaction's lifecycle while CALL-E captures steering as queued instructions; the same checkpoint/acknowledgement loop consumes that steering safely;
9. optionally inspect `get_audit_timeline` to explain prior deferrals/call transitions without changing agent state.

This proves the product semantics without requiring Claude Code to support undocumented mid-token interruption.

## Codex

Use the same checkpoint/acknowledgement model and the same MCP or typed HTTP client boundary. Codex integration should let a running workflow publish status, raise an escalation, incorporate queued instructions between work units, acknowledge the exact ids incorporated, and optionally read callback lifecycle/audit state. Do not implement a Codex-only state machine.

## Self-service setup matrix

`GET /connect` is the browser-local Connection Kit for a deployed self-hosted instance. It does not submit a phone number or any credential; it generates host-specific text locally in the browser. The owner should generate a least-privilege credential bundle on the trusted control-plane host, then give each agent only its own `agent` token.

| Host | Current setup | Status |
| --- | --- | --- |
| Codex CLI / IDE | `codex mcp add` launches the built stdio adapter with `CYA_BASE_URL` and `CYA_API_TOKEN`. | Supported locally. |
| ChatGPT desktop app | Add the same stdio server in **Settings → MCP servers**. It shares local MCP configuration with Codex. | Supported locally. |
| Claude Code | `claude mcp add` launches the same stdio adapter. | Supported locally. |
| Gemini CLI | Add the `mcpServers.callyouragent` entry to `~/.gemini/settings.json` or `.gemini/settings.json`. | Supported locally. |
| Kiro | Add the equivalent stdio entry to `~/.kiro/settings/mcp.json` or `.kiro/settings/mcp.json`. | Supported locally. |
| Another MCP client | Configure `node dist/src/mcp-server.js` and supply the two agent environment variables. | Supported when the client supports stdio MCP. |
| Hosted ChatGPT / ChatGPT Work | Requires a published plugin, a remote Streamable HTTP MCP endpoint, OAuth, and tenant-scoped credentials. | Not supported by the self-hosted stdio release yet. |

The repository also includes `plugins/callyouragent`, a credential-free agent-plugin package containing the safe-checkpoint workflow guidance. It does not bundle an MCP transport or secrets; the deployed Connection Kit remains the source of each user's scoped connection values.

### Provider delivery and voice

CALL-E remains the supported provider implementation. The recent live delivery attempts show that task acceptance is not equivalent to handset delivery. Do not depend on an unverified/shared caller identity for a production owner-control path, particularly across carrier regions. A production-quality provider adapter should use a verified, branded outbound number and return the same `CallProvider` lifecycle/structured-outcome contract. This preserves the agent integrations above while letting an operator use a provider with stronger deliverability or explicit voice selection. An ElevenLabs adapter is not present today because CALL-E does not expose a supported ElevenLabs voice-selection field.

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
await cya.acknowledgeInstructions(
  run.id,
  checkpoint.queuedInstructions.map((instruction) => instruction.id),
);
```

The acknowledgement step means an instruction is only marked consumed after the worker says it incorporated that specific durable item. Steering that arrives a moment later is not accidentally swept into the same checkpoint.

## Phone-provider boundary

No agent integration receives `CALLE_API_KEY`. Only the trusted CallYourAgent backend talks to CALL-E. This lets provider behavior, retries, webhook reconciliation, call policy, quiet hours, budgets, and auditability evolve without changing every agent adapter.
