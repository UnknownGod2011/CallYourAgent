import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { FakeCallProvider } from "../src/call-provider.js";
import { ControlPlane } from "../src/control-plane.js";
import { createControlPlaneHttpServer } from "../src/http-server.js";
import { createCallYourAgentMcpServer } from "../src/mcp-server.js";
import { InMemoryControlPlaneStore } from "../src/store.js";

function parseTextResult(result: { content?: unknown }): unknown {
  assert.ok(Array.isArray(result.content));
  const first = result.content[0] as { type?: string; text?: string } | undefined;
  assert.equal(first?.type, "text");
  assert.equal(typeof first?.text, "string");
  return JSON.parse(first!.text!);
}

test("Claude-style work loop keeps independent work moving and exactly acknowledges owner steering", async () => {
  const provider = new FakeCallProvider();
  const controlPlane = new ControlPlane(new InMemoryControlPlaneStore(), provider);
  const http = createControlPlaneHttpServer(controlPlane, { apiToken: "agent-secret" });
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const address = http.address() as AddressInfo;

  const mcpServer = createCallYourAgentMcpServer({
    baseUrl: `http://127.0.0.1:${address.port}`,
    apiToken: "agent-secret",
  });
  const mcpClient = new Client({ name: "claude-style-fixture", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  try {
    await mcpServer.connect(serverTransport);
    await mcpClient.connect(clientTransport);

    const agent = parseTextResult(await mcpClient.callTool({
      name: "register_agent",
      arguments: { name: "Claude", platform: "claude-code", ownerId: "owner-1" },
    })) as Record<string, unknown>;
    const run = parseTextResult(await mcpClient.callTool({
      name: "start_run",
      arguments: {
        agentId: agent.id,
        summary: "Implementing checkout and documentation in parallel",
        currentScope: "checkout",
      },
    })) as Record<string, unknown>;

    const escalation = parseTextResult(await mcpClient.callTool({
      name: "request_owner_decision",
      arguments: {
        runId: run.id,
        scopeId: "checkout-provider",
        question: "Should checkout use provider A or provider B?",
        context: "Provider A is simpler; provider B has lower fees.",
        blocking: true,
        priority: "high",
        idempotencyKey: "checkout-provider-choice-v1",
      },
    })) as Record<string, unknown>;

    const blockedCheckpoint = parseTextResult(await mcpClient.callTool({
      name: "checkpoint",
      arguments: { runId: run.id, consume: false },
    })) as Record<string, unknown>;
    assert.deepEqual(blockedCheckpoint.unresolvedBlockingScopes, ["checkout-provider"]);

    const unrelatedStatus = parseTextResult(await mcpClient.callTool({
      name: "report_status",
      arguments: {
        runId: run.id,
        summary: "Checkout provider choice is waiting on owner; documentation work completed meanwhile",
        currentScope: "documentation",
      },
    })) as Record<string, unknown>;
    assert.equal(unrelatedStatus.currentScope, "documentation");

    const decisionEscalation = controlPlane.getEscalation(escalation.id as string);
    assert.ok(decisionEscalation.callAttemptId);
    const decisionAttempt = controlPlane.getCallAttempt(decisionEscalation.callAttemptId);
    assert.ok(decisionAttempt.providerCallId);
    provider.complete(decisionAttempt.providerCallId, {
      status: "completed",
      answer: "Use provider B",
      structured: { choice: "provider-b", approved: true },
    });
    await mcpClient.callTool({
      name: "reconcile_escalation",
      arguments: { escalationId: escalation.id },
    });

    const resolved = parseTextResult(await mcpClient.callTool({
      name: "get_escalation_status",
      arguments: { escalationId: escalation.id },
    })) as Record<string, unknown>;
    const resolvedEscalation = resolved.escalation as Record<string, unknown>;
    const decision = resolved.decision as Record<string, unknown>;
    assert.equal(resolvedEscalation.status, "resolved");
    assert.equal(decision.answer, "Use provider B");

    const unblockedCheckpoint = parseTextResult(await mcpClient.callTool({
      name: "checkpoint",
      arguments: { runId: run.id, consume: false },
    })) as Record<string, unknown>;
    assert.deepEqual(unblockedCheckpoint.unresolvedBlockingScopes, []);

    await mcpClient.callTool({
      name: "report_status",
      arguments: {
        runId: run.id,
        summary: "Provider B selected; implementing checkout integration",
        currentScope: "checkout",
      },
    });

    const callback = parseTextResult(await mcpClient.callTool({
      name: "request_owner_callback",
      arguments: {
        runId: run.id,
        idempotencyKey: "owner-checkin-v1",
        prompt: "Give the owner the latest status and collect any steering instructions.",
      },
    })) as Record<string, unknown>;

    const callbackAttempt = controlPlane.getCallAttempt(callback.id as string);
    assert.ok(callbackAttempt.providerCallId);
    provider.complete(callbackAttempt.providerCallId, {
      status: "completed",
      instructions: [
        "Finish the checkout integration, but do not start the analytics dashboard yet.",
        "Add a concise note explaining why provider B was chosen.",
      ],
    });
    await mcpClient.callTool({
      name: "reconcile_callback",
      arguments: { callbackId: callback.id },
    });

    const pendingInstructions = parseTextResult(await mcpClient.callTool({
      name: "checkpoint",
      arguments: { runId: run.id, consume: false },
    })) as Record<string, unknown>;
    const queued = pendingInstructions.queuedInstructions as Array<Record<string, unknown>>;
    assert.equal(queued.length, 2);
    assert.deepEqual(queued.map((instruction) => instruction.status), ["queued", "queued"]);

    // Simulate steering that arrives after this safe checkpoint but before the worker
    // acknowledges the exact instructions it incorporated.
    const later = controlPlane.enqueueInstruction(run.id as string, "Also add a rollback note before merging.", "api");

    const acknowledgedInstructions = parseTextResult(await mcpClient.callTool({
      name: "acknowledge_owner_instructions",
      arguments: {
        runId: run.id,
        instructionIds: queued.map((instruction) => instruction.id),
      },
    })) as Array<Record<string, unknown>>;
    assert.equal(acknowledgedInstructions.length, 2);
    assert.deepEqual(acknowledgedInstructions.map((instruction) => instruction.status), ["consumed", "consumed"]);

    // Retrying the exact acknowledgement is idempotent.
    const retriedInstructions = parseTextResult(await mcpClient.callTool({
      name: "acknowledge_owner_instructions",
      arguments: {
        runId: run.id,
        instructionIds: queued.map((instruction) => instruction.id),
      },
    })) as Array<Record<string, unknown>>;
    assert.deepEqual(retriedInstructions.map((instruction) => instruction.status), ["consumed", "consumed"]);

    const afterAcknowledgement = parseTextResult(await mcpClient.callTool({
      name: "checkpoint",
      arguments: { runId: run.id, consume: false },
    })) as Record<string, unknown>;
    const remaining = afterAcknowledgement.queuedInstructions as Array<Record<string, unknown>>;
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0]?.id, later.id);
    assert.equal(remaining[0]?.status, "queued");
    assert.deepEqual(afterAcknowledgement.unresolvedBlockingScopes, []);

    await mcpClient.callTool({
      name: "acknowledge_owner_instructions",
      arguments: { runId: run.id, instructionIds: [later.id] },
    });
    const finalCheckpoint = parseTextResult(await mcpClient.callTool({
      name: "checkpoint",
      arguments: { runId: run.id, consume: false },
    })) as Record<string, unknown>;
    assert.deepEqual(finalCheckpoint.queuedInstructions, []);
  } finally {
    await mcpClient.close();
    await mcpServer.close();
    await new Promise<void>((resolve) => http.close(() => resolve()));
  }
});
