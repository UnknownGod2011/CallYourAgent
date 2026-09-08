import assert from "node:assert/strict";
import { test } from "node:test";
import type { AddressInfo } from "node:net";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { FakeCallProvider } from "../src/call-provider.js";
import { ControlPlane } from "../src/control-plane.js";
import { createControlPlaneHttpServer } from "../src/http-server.js";
import { createCallYourAgentMcpServer } from "../src/mcp-server.js";
import { InMemoryControlPlaneStore } from "../src/store.js";

function parseTextResult(result: { content?: unknown }): Record<string, unknown> {
  assert.ok(Array.isArray(result.content));
  const first = result.content[0] as { type?: string; text?: string } | undefined;
  assert.equal(first?.type, "text");
  assert.equal(typeof first?.text, "string");
  return JSON.parse(first!.text!) as Record<string, unknown>;
}

async function connectMcp(baseUrl: string, apiToken: string, name: string) {
  const server = createCallYourAgentMcpServer({ baseUrl, apiToken });
  const client = new Client({ name, version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { server, client };
}

test("scoped MCP clients separate lifecycle observation from owner decision consumption", async () => {
  const store = new InMemoryControlPlaneStore();
  const provider = new FakeCallProvider();
  const controlPlane = new ControlPlane(store, provider);
  const http = createControlPlaneHttpServer(controlPlane, {
    apiCredentials: [
      { id: "agent", token: "agent-token", scopes: ["agent:read", "agent:write", "decision:read", "audit:read"] },
      { id: "owner", token: "owner-token", scopes: ["agent:read", "audit:read", "owner:callback"] },
    ],
  });
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const address = http.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const agentMcp = await connectMcp(baseUrl, "agent-token", "agent-mcp");
  const ownerMcp = await connectMcp(baseUrl, "owner-token", "owner-mcp");

  try {
    const listed = await agentMcp.client.listTools();
    const names = listed.tools.map((tool) => tool.name);
    assert.ok(names.includes("get_escalation_lifecycle_status"));
    assert.ok(names.includes("get_escalation_status"));

    const agentResult = await agentMcp.client.callTool({
      name: "register_agent",
      arguments: { name: "Claude", platform: "claude-code", ownerId: "owner-1" },
    });
    assert.notEqual(agentResult.isError, true);
    const agent = parseTextResult(agentResult);

    const runResult = await agentMcp.client.callTool({
      name: "start_run",
      arguments: { agentId: agent.id, summary: "Working on release", currentScope: "release" },
    });
    assert.notEqual(runResult.isError, true);
    const run = parseTextResult(runResult);

    const escalationResult = await agentMcp.client.callTool({
      name: "request_owner_decision",
      arguments: {
        runId: run.id,
        scopeId: "release-approval",
        question: "Should the production release proceed?",
        context: "Private release context",
        blocking: true,
        idempotencyKey: "mcp-scope-decision-v1",
      },
    });
    assert.notEqual(escalationResult.isError, true);
    const escalation = parseTextResult(escalationResult);
    assert.equal(typeof escalation.id, "string");

    const ownerLifecyclePending = await ownerMcp.client.callTool({
      name: "get_escalation_lifecycle_status",
      arguments: { escalationId: escalation.id },
    });
    assert.notEqual(ownerLifecyclePending.isError, true);
    const pendingLifecycle = parseTextResult(ownerLifecyclePending);
    assert.equal(pendingLifecycle.status, "calling");
    assert.equal(pendingLifecycle.blocking, true);
    const pendingSerialized = JSON.stringify(pendingLifecycle);
    assert.ok(!pendingSerialized.includes("Should the production release proceed?"));
    assert.ok(!pendingSerialized.includes("Private release context"));

    const ownerSensitiveBefore = await ownerMcp.client.callTool({
      name: "get_escalation_status",
      arguments: { escalationId: escalation.id },
    });
    assert.equal(ownerSensitiveBefore.isError, true);
    const ownerError = parseTextResult(ownerSensitiveBefore);
    assert.equal(ownerError.status, 403);
    assert.deepEqual(ownerError.body, { error: "forbidden", requiredScope: "decision:read" });

    const persistedEscalation = controlPlane.getEscalation(escalation.id as string);
    assert.ok(persistedEscalation.callAttemptId);
    const attempt = store.callAttempts.get(persistedEscalation.callAttemptId);
    assert.ok(attempt?.providerCallId);
    provider.complete(attempt.providerCallId, {
      status: "completed",
      providerCallId: attempt.providerCallId,
      answer: "Proceed with the staged release.",
      structured: { approved: true, rollout: "staged" },
    });
    await controlPlane.reconcileEscalation(persistedEscalation.id);

    const ownerLifecycleResolved = await ownerMcp.client.callTool({
      name: "get_escalation_lifecycle_status",
      arguments: { escalationId: escalation.id },
    });
    assert.notEqual(ownerLifecycleResolved.isError, true);
    const resolvedLifecycle = parseTextResult(ownerLifecycleResolved);
    assert.equal(resolvedLifecycle.status, "resolved");
    assert.equal(resolvedLifecycle.callStatus, "completed");
    const resolvedSerialized = JSON.stringify(resolvedLifecycle);
    assert.ok(!resolvedSerialized.includes("Proceed with the staged release."));
    assert.ok(!resolvedSerialized.includes("approved"));

    const ownerSensitiveAfter = await ownerMcp.client.callTool({
      name: "get_escalation_status",
      arguments: { escalationId: escalation.id },
    });
    assert.equal(ownerSensitiveAfter.isError, true);
    const ownerResolvedError = parseTextResult(ownerSensitiveAfter);
    assert.equal(ownerResolvedError.status, 403);
    assert.deepEqual(ownerResolvedError.body, { error: "forbidden", requiredScope: "decision:read" });

    const agentSensitive = await agentMcp.client.callTool({
      name: "get_escalation_status",
      arguments: { escalationId: escalation.id },
    });
    assert.notEqual(agentSensitive.isError, true);
    const agentDecision = parseTextResult(agentSensitive) as {
      escalation?: { status?: string };
      decision?: { answer?: string; structured?: Record<string, unknown> };
    };
    assert.equal(agentDecision.escalation?.status, "resolved");
    assert.equal(agentDecision.decision?.answer, "Proceed with the staged release.");
    assert.deepEqual(agentDecision.decision?.structured, { approved: true, rollout: "staged" });
  } finally {
    await ownerMcp.client.close();
    await ownerMcp.server.close();
    await agentMcp.client.close();
    await agentMcp.server.close();
    await new Promise<void>((resolve) => http.close(() => resolve()));
  }
});
