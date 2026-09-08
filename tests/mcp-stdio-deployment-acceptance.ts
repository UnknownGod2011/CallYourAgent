import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

interface ToolResultLike {
  content?: unknown;
  isError?: boolean;
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function parseToolText(result: ToolResultLike): unknown {
  assert.ok(Array.isArray(result.content), "tool result must contain content");
  const first = result.content[0] as { type?: string; text?: string } | undefined;
  assert.equal(first?.type, "text");
  assert.equal(typeof first?.text, "string");
  return JSON.parse(first!.text!);
}

async function jsonRequest(
  baseUrl: string,
  token: string,
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(new URL(path, baseUrl), {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
      ...init.headers,
    },
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) : undefined,
  };
}

async function waitForReady(baseUrl: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(new URL("/ready", baseUrl));
      if (response.ok) return;
      lastError = new Error(`readiness returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`control plane did not become ready after restart: ${String(lastError)}`);
}

async function restartControlPlaneIfRequested(baseUrl: string): Promise<boolean> {
  if (process.env.CYA_RESTART_CONTROL_PLANE?.trim() !== "true") return false;
  execFileSync(
    "docker",
    ["compose", "-f", "deploy/compose.yml", "restart", "callyouragent"],
    { cwd: process.cwd(), stdio: "inherit" },
  );
  await waitForReady(baseUrl);
  return true;
}

async function main(): Promise<void> {
  const baseUrl = requiredEnv("CYA_BASE_URL");
  const agentToken = requiredEnv("CYA_AGENT_TOKEN");
  const ownerToken = requiredEnv("CYA_OWNER_TOKEN");
  const reconcilerToken = requiredEnv("CYA_RECONCILER_TOKEN");
  const suffix = process.env.GITHUB_RUN_ID?.trim() || `${Date.now()}`;

  const childEnv: Record<string, string> = {
    CYA_BASE_URL: baseUrl,
    CYA_API_TOKEN: agentToken,
  };
  if (process.env.PATH) childEnv.PATH = process.env.PATH;
  if (process.env.HOME) childEnv.HOME = process.env.HOME;

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["dist/src/mcp-server.js"],
    cwd: process.cwd(),
    env: childEnv,
    stderr: "pipe",
  });
  const client = new Client({ name: "cya-compose-stdio-acceptance", version: "1.0.0" });

  try {
    await client.connect(transport);

    const listed = await client.listTools();
    const toolNames = new Set(listed.tools.map((tool) => tool.name));
    for (const required of [
      "register_agent",
      "start_run",
      "report_status",
      "request_owner_decision",
      "get_escalation_lifecycle_status",
      "get_escalation_status",
      "checkpoint",
      "acknowledge_owner_instructions",
      "request_owner_callback",
      "get_audit_timeline",
    ]) {
      assert.ok(toolNames.has(required), `missing stdio MCP tool ${required}`);
    }

    const agentResult = await client.callTool({
      name: "register_agent",
      arguments: {
        name: `compose-stdio-agent-${suffix}`,
        platform: "claude-code-stdio-acceptance",
        ownerId: `compose-stdio-owner-${suffix}`,
      },
    });
    assert.notEqual(agentResult.isError, true);
    const agent = parseToolText(agentResult) as { id: string };
    assert.equal(typeof agent.id, "string");

    const runResult = await client.callTool({
      name: "start_run",
      arguments: {
        agentId: agent.id,
        summary: "Preparing release while documentation continues independently",
        currentScope: "documentation",
      },
    });
    assert.notEqual(runResult.isError, true);
    const run = parseToolText(runResult) as { id: string; currentScope?: string };
    assert.equal(typeof run.id, "string");
    assert.equal(run.currentScope, "documentation");

    const statusResult = await client.callTool({
      name: "report_status",
      arguments: {
        runId: run.id,
        summary: "Documentation continues while release approval may require the owner",
        currentScope: "documentation",
      },
    });
    assert.notEqual(statusResult.isError, true);

    const escalationResult = await client.callTool({
      name: "request_owner_decision",
      arguments: {
        runId: run.id,
        scopeId: "release-approval",
        question: "Proceed with the release?",
        context: "Documentation is independent and should continue while approval is pending.",
        blocking: true,
        priority: "high",
        idempotencyKey: `compose-stdio-release-${suffix}`,
      },
    });
    assert.notEqual(escalationResult.isError, true);
    const escalation = parseToolText(escalationResult) as { id: string };

    const blockedCheckpointResult = await client.callTool({
      name: "checkpoint",
      arguments: { runId: run.id, consume: false },
    });
    const blockedCheckpoint = parseToolText(blockedCheckpointResult) as {
      run: { currentScope?: string };
      unresolvedBlockingScopes: string[];
      queuedInstructions: unknown[];
    };
    assert.equal(blockedCheckpoint.run.currentScope, "documentation");
    assert.deepEqual(blockedCheckpoint.unresolvedBlockingScopes, ["release-approval"]);
    assert.deepEqual(blockedCheckpoint.queuedInstructions, []);

    const lifecycleBeforeRestartResult = await client.callTool({
      name: "get_escalation_lifecycle_status",
      arguments: { escalationId: escalation.id },
    });
    assert.notEqual(lifecycleBeforeRestartResult.isError, true);
    const lifecycleBeforeRestart = parseToolText(lifecycleBeforeRestartResult) as {
      status: string;
      callStatus?: string;
    };
    assert.equal(lifecycleBeforeRestart.status, "calling");
    assert.ok(
      lifecycleBeforeRestart.callStatus === "queued" || lifecycleBeforeRestart.callStatus === "in_progress",
      `expected active decision call before restart, got ${String(lifecycleBeforeRestart.callStatus)}`,
    );

    const deniedCallback = await client.callTool({
      name: "request_owner_callback",
      arguments: {
        runId: run.id,
        idempotencyKey: `compose-stdio-agent-callback-denied-${suffix}`,
      },
    });
    assert.equal(deniedCallback.isError, true);
    const deniedCallbackBody = parseToolText(deniedCallback) as { status?: number };
    assert.equal(deniedCallbackBody.status, 403);

    const decisionRestarted = await restartControlPlaneIfRequested(baseUrl);

    if (decisionRestarted) {
      const lifecycleAfterRestartResult = await client.callTool({
        name: "get_escalation_lifecycle_status",
        arguments: { escalationId: escalation.id },
      });
      assert.notEqual(lifecycleAfterRestartResult.isError, true);
      const lifecycleAfterRestart = parseToolText(lifecycleAfterRestartResult) as {
        status: string;
        callStatus?: string;
      };
      assert.equal(lifecycleAfterRestart.status, "calling");
      assert.ok(
        lifecycleAfterRestart.callStatus === "queued" || lifecycleAfterRestart.callStatus === "in_progress",
        `expected restored active decision call after restart, got ${String(lifecycleAfterRestart.callStatus)}`,
      );

      const stillBlockedResult = await client.callTool({
        name: "checkpoint",
        arguments: { runId: run.id, consume: false },
      });
      assert.notEqual(stillBlockedResult.isError, true);
      const stillBlocked = parseToolText(stillBlockedResult) as {
        run: { currentScope?: string };
        unresolvedBlockingScopes: string[];
        queuedInstructions: unknown[];
      };
      assert.equal(stillBlocked.run.currentScope, "documentation");
      assert.deepEqual(stillBlocked.unresolvedBlockingScopes, ["release-approval"]);
      assert.deepEqual(stillBlocked.queuedInstructions, []);
    }

    const reconciledDecision = await jsonRequest(
      baseUrl,
      reconcilerToken,
      `/v1/escalations/${encodeURIComponent(escalation.id)}/reconcile`,
      { method: "POST" },
    );
    assert.equal(reconciledDecision.status, 200);

    const decisionResult = await client.callTool({
      name: "get_escalation_status",
      arguments: { escalationId: escalation.id },
    });
    assert.notEqual(decisionResult.isError, true);
    const decisionState = parseToolText(decisionResult) as {
      escalation: { status: string };
      decision?: { answer?: string; structured?: Record<string, unknown> };
    };
    assert.equal(decisionState.escalation.status, "resolved");
    assert.equal(decisionState.decision?.answer, "Proceed with the requested scope.");
    assert.equal(decisionState.decision?.structured?.decision, "proceed");

    const repeatedDecision = await client.callTool({
      name: "get_escalation_status",
      arguments: { escalationId: escalation.id },
    });
    assert.notEqual(repeatedDecision.isError, true);
    const repeatedDecisionState = parseToolText(repeatedDecision) as {
      escalation: { status: string };
      decision?: { id?: string; answer?: string };
    };
    assert.equal(repeatedDecisionState.escalation.status, "resolved");
    assert.equal(repeatedDecisionState.decision?.id, decisionState.decision && "id" in decisionState.decision ? decisionState.decision.id : repeatedDecisionState.decision?.id);
    assert.equal(repeatedDecisionState.decision?.answer, "Proceed with the requested scope.");

    const releasedCheckpointResult = await client.callTool({
      name: "checkpoint",
      arguments: { runId: run.id, consume: false },
    });
    const releasedCheckpoint = parseToolText(releasedCheckpointResult) as {
      run: { currentScope?: string };
      unresolvedBlockingScopes: string[];
    };
    assert.equal(releasedCheckpoint.run.currentScope, "documentation");
    assert.deepEqual(releasedCheckpoint.unresolvedBlockingScopes, []);

    const callbackRequest = await jsonRequest(baseUrl, ownerToken, "/v1/callbacks", {
      method: "POST",
      body: JSON.stringify({
        runId: run.id,
        idempotencyKey: `compose-stdio-owner-callback-${suffix}`,
        prompt: "Tell me current progress and capture one steering instruction.",
      }),
    });
    assert.equal(callbackRequest.status, 201);
    const callback = callbackRequest.body as { id: string; status: string };
    assert.equal(typeof callback.id, "string");

    const reconciledCallback = await jsonRequest(
      baseUrl,
      reconcilerToken,
      `/v1/callbacks/${encodeURIComponent(callback.id)}/reconcile`,
      { method: "POST" },
    );
    assert.equal(reconciledCallback.status, 200);

    const steeringRestarted = await restartControlPlaneIfRequested(baseUrl);

    const steeringCheckpointResult = await client.callTool({
      name: "checkpoint",
      arguments: { runId: run.id, consume: false },
    });
    assert.notEqual(steeringCheckpointResult.isError, true);
    const steeringCheckpoint = parseToolText(steeringCheckpointResult) as {
      unresolvedBlockingScopes: string[];
      queuedInstructions: Array<{ id: string; text: string; status: string }>;
    };
    assert.deepEqual(steeringCheckpoint.unresolvedBlockingScopes, []);
    assert.equal(steeringCheckpoint.queuedInstructions.length, 1);
    const instruction = steeringCheckpoint.queuedInstructions[0]!;
    assert.equal(instruction.status, "queued");
    assert.equal(instruction.text, "Continue the current plan and report progress at the next safe checkpoint.");

    const ackResult = await client.callTool({
      name: "acknowledge_owner_instructions",
      arguments: { runId: run.id, instructionIds: [instruction.id] },
    });
    assert.notEqual(ackResult.isError, true);
    const acknowledged = parseToolText(ackResult) as Array<{ id: string; status: string }>;
    assert.equal(acknowledged.length, 1);
    assert.equal(acknowledged[0]?.id, instruction.id);
    assert.equal(acknowledged[0]?.status, "consumed");

    const repeatedAckResult = await client.callTool({
      name: "acknowledge_owner_instructions",
      arguments: { runId: run.id, instructionIds: [instruction.id] },
    });
    assert.notEqual(repeatedAckResult.isError, true);
    const repeatedAcknowledged = parseToolText(repeatedAckResult) as Array<{ id: string; status: string }>;
    assert.equal(repeatedAcknowledged.length, 1);
    assert.equal(repeatedAcknowledged[0]?.id, instruction.id);
    assert.equal(repeatedAcknowledged[0]?.status, "consumed");

    const finalCheckpointResult = await client.callTool({
      name: "checkpoint",
      arguments: { runId: run.id, consume: false },
    });
    const finalCheckpoint = parseToolText(finalCheckpointResult) as {
      queuedInstructions: unknown[];
      unresolvedBlockingScopes: string[];
    };
    assert.deepEqual(finalCheckpoint.queuedInstructions, []);
    assert.deepEqual(finalCheckpoint.unresolvedBlockingScopes, []);

    const auditResult = await client.callTool({
      name: "get_audit_timeline",
      arguments: { runId: run.id, limit: 100 },
    });
    assert.notEqual(auditResult.isError, true);
    const auditEvents = parseToolText(auditResult) as Array<{ type: string; escalationId?: string }>;
    const eventTypes = new Set(auditEvents.map((event) => event.type));
    for (const expected of [
      "escalation_created",
      "owner_decision_recorded",
      "owner_callback_requested",
      "owner_instruction_queued",
      "owner_instruction_consumed",
    ]) {
      assert.ok(eventTypes.has(expected), `missing audit event ${expected}`);
    }
    assert.equal(
      auditEvents.filter((event) => event.type === "owner_decision_recorded" && event.escalationId === escalation.id).length,
      1,
      "restart/retry must not duplicate the MCP-raised owner decision",
    );
    assert.equal(
      auditEvents.filter((event) => event.type === "owner_instruction_consumed").length,
      1,
      "repeated exact acknowledgement must not duplicate consumption audit state",
    );

    process.stdout.write(JSON.stringify({
      ok: true,
      restartedDuringDecision: decisionRestarted,
      restartedAfterCallback: steeringRestarted,
      runId: run.id,
      escalationId: escalation.id,
      callbackId: callback.id,
      instructionId: instruction.id,
      discoveredTools: listed.tools.length,
    }) + "\n");
  } finally {
    await client.close();
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
