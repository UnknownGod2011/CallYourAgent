import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import { CallYourAgentClient, CallYourAgentHttpError } from "./client.js";

export interface McpServerConfig {
  baseUrl: string;
  apiToken: string;
  client?: CallYourAgentClient;
}

function asToolResult(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
  };
}

function asToolError(error: unknown) {
  const detail = error instanceof CallYourAgentHttpError
    ? {
        message: `CallYourAgent request failed with HTTP ${error.status}`,
        status: error.status,
      }
    : { message: "CallYourAgent request failed" };
  return {
    content: [{ type: "text" as const, text: JSON.stringify(detail) }],
    isError: true,
  };
}

/** Build an MCP server over the same stable HTTP contract used by custom agents. */
export function createCallYourAgentMcpServer(config: McpServerConfig): McpServer {
  const client = config.client ?? new CallYourAgentClient({ baseUrl: config.baseUrl, apiToken: config.apiToken });
  const server = new McpServer({ name: "callyouragent", version: "0.1.0" });

  server.registerTool("register_agent", {
    description: "Register an AI agent with the CallYourAgent control plane. Do this once before starting a run.",
    inputSchema: z.object({
      name: z.string().min(1),
      platform: z.string().min(1).describe("Host platform, e.g. claude-code, codex, custom"),
      ownerId: z.string().min(1),
    }),
  }, async (input) => {
    try { return asToolResult(await client.registerAgent(input)); }
    catch (error) { return asToolError(error); }
  });

  server.registerTool("start_run", {
    description: "Start a long-running agent run and publish its initial status.",
    inputSchema: z.object({
      agentId: z.string().min(1),
      summary: z.string().min(1),
      currentScope: z.string().min(1).optional(),
    }),
  }, async (input) => {
    try { return asToolResult(await client.startRun(input)); }
    catch (error) { return asToolError(error); }
  });

  server.registerTool("report_status", {
    description: "Publish the agent's latest compact status and current work scope without stopping the run.",
    inputSchema: z.object({
      runId: z.string().min(1),
      summary: z.string().min(1).optional(),
      currentScope: z.string().min(1).optional(),
    }),
  }, async ({ runId, ...update }) => {
    try { return asToolResult(await client.reportStatus(runId, update)); }
    catch (error) { return asToolError(error); }
  });

  server.registerTool("get_audit_timeline", {
    description: "Read the durable run timeline showing progress reports, policy deferrals, call transitions, decisions, callbacks, and safe-checkpoint instruction handling. Audit metadata intentionally excludes full call transcripts and decision text.",
    inputSchema: z.object({
      runId: z.string().min(1),
      limit: z.number().int().min(1).max(500).default(100),
    }),
  }, async ({ runId, limit }) => {
    try { return asToolResult(await client.getAuditTimeline(runId, limit)); }
    catch (error) { return asToolError(error); }
  });

  server.registerTool("request_owner_decision", {
    description: "Ask the owner an important question by phone. Blocking applies only to the supplied scope; unrelated scopes may continue.",
    inputSchema: z.object({
      runId: z.string().min(1),
      scopeId: z.string().min(1),
      question: z.string().min(1),
      context: z.string().min(1).optional(),
      blocking: z.boolean(),
      priority: z.enum(["low", "normal", "high", "critical"]).optional(),
      expiresAt: z.string().min(1).optional(),
      idempotencyKey: z.string().min(1).describe("Stable key reused if the same logical escalation is retried"),
    }),
  }, async (input) => {
    try { return asToolResult(await client.requestOwnerDecision(input)); }
    catch (error) { return asToolError(error); }
  });

  server.registerTool("get_escalation_lifecycle_status", {
    description: "Read privacy-safe escalation lifecycle metadata without receiving the owner's decision answer. Suitable for owner/operator observation credentials with agent:read.",
    inputSchema: z.object({ escalationId: z.string().min(1) }),
  }, async ({ escalationId }) => {
    try { return asToolResult(await client.getEscalationLifecycleStatus(escalationId)); }
    catch (error) { return asToolError(error); }
  });

  server.registerTool("get_escalation_status", {
    description: "Read the current escalation and any structured owner decision. Requires decision:read in addition to agent:read and is intended for the agent consuming the answer at a work boundary.",
    inputSchema: z.object({ escalationId: z.string().min(1) }),
  }, async ({ escalationId }) => {
    try { return asToolResult(await client.getEscalationStatus(escalationId)); }
    catch (error) { return asToolError(error); }
  });

  server.registerTool("checkpoint", {
    description: "Safe work-boundary check. Returns queued owner instructions plus unresolved blocking scopes. Prefer consume=false, incorporate the returned instructions, then acknowledge their exact ids with acknowledge_owner_instructions.",
    inputSchema: z.object({
      runId: z.string().min(1),
      consume: z.boolean().default(false).describe("Legacy one-step consumption. Prefer false plus explicit acknowledgement after incorporation."),
    }),
  }, async ({ runId, consume }) => {
    try { return asToolResult(await client.checkpoint(runId, consume)); }
    catch (error) { return asToolError(error); }
  });

  server.registerTool("acknowledge_owner_instructions", {
    description: "After incorporating owner steering at a safe checkpoint, acknowledge exactly those instruction ids. Later-arriving instructions remain queued. Retries are idempotent.",
    inputSchema: z.object({
      runId: z.string().min(1),
      instructionIds: z.array(z.string().min(1)),
    }),
  }, async ({ runId, instructionIds }) => {
    try { return asToolResult(await client.acknowledgeInstructions(runId, instructionIds)); }
    catch (error) { return asToolError(error); }
  });

  server.registerTool("request_owner_callback", {
    description: "Request a phone callback so the owner can hear current agent status, ask questions, and queue steering instructions for the running agent.",
    inputSchema: z.object({
      runId: z.string().min(1),
      idempotencyKey: z.string().min(1).describe("Stable key reused if the same callback request is retried"),
      prompt: z.string().min(1).optional(),
    }),
  }, async (input) => {
    try { return asToolResult(await client.requestOwnerCallback(input)); }
    catch (error) { return asToolError(error); }
  });

  server.registerTool("get_callback_status", {
    description: "Read privacy-safe lifecycle metadata for an owner callback by its durable callback/call-attempt id. Requires only agent:read and does not expose callback prompt text, transcripts, or queued instruction text.",
    inputSchema: z.object({ callbackId: z.string().min(1) }),
  }, async ({ callbackId }) => {
    try { return asToolResult(await client.getCallback(callbackId)); }
    catch (error) { return asToolError(error); }
  });

  server.registerTool("reconcile_escalation", {
    description: "Reconcile a pending escalation with the phone provider when webhook delivery is delayed or unavailable.",
    inputSchema: z.object({ escalationId: z.string().min(1) }),
  }, async ({ escalationId }) => {
    try { return asToolResult(await client.reconcileEscalation(escalationId)); }
    catch (error) { return asToolError(error); }
  });

  server.registerTool("reconcile_callback", {
    description: "Reconcile an owner callback with the phone provider when webhook delivery is delayed or unavailable.",
    inputSchema: z.object({ callbackId: z.string().min(1) }),
  }, async ({ callbackId }) => {
    try { return asToolResult(await client.reconcileCallback(callbackId)); }
    catch (error) { return asToolError(error); }
  });

  return server;
}

export function mcpConfigFromEnv(env: NodeJS.ProcessEnv = process.env): McpServerConfig {
  const baseUrl = env.CYA_BASE_URL?.trim();
  const apiToken = env.CYA_API_TOKEN?.trim();
  if (!baseUrl) throw new Error("CYA_BASE_URL is required for the MCP adapter");
  if (!apiToken) throw new Error("CYA_API_TOKEN is required for the MCP adapter");
  return { baseUrl, apiToken };
}

async function main(): Promise<void> {
  const config = mcpConfigFromEnv();
  await serveStdio(() => createCallYourAgentMcpServer(config));
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
