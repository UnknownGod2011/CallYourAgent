import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import type { AddressInfo } from "node:net";
import { FakeCallProvider } from "../src/call-provider.js";
import { ControlPlane } from "../src/control-plane.js";
import { createControlPlaneHttpServer } from "../src/http-server.js";
import { InMemoryControlPlaneStore } from "../src/store.js";

const servers: Array<ReturnType<typeof createControlPlaneHttpServer>> = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

test("agent:read can inspect escalation lifecycle without receiving decision or replay material", async () => {
  const store = new InMemoryControlPlaneStore();
  const provider = new FakeCallProvider();
  const controlPlane = new ControlPlane(store, provider);

  const agent = controlPlane.registerAgent({ name: "worker", platform: "custom", ownerId: "owner-1" });
  const run = controlPlane.startRun(agent.id, "Preparing release", "deploy");
  const escalation = await controlPlane.requestOwnerDecision({
    runId: run.id,
    scopeId: "deploy",
    question: "Should the private rollout continue?",
    context: "Sensitive deployment context",
    blocking: true,
    idempotencyKey: "private-deploy-approval-v1",
  });

  assert.ok(escalation.callAttemptId);
  const attempt = store.callAttempts.get(escalation.callAttemptId);
  assert.ok(attempt?.providerCallId);
  provider.complete(attempt.providerCallId, {
    status: "completed",
    providerCallId: attempt.providerCallId,
    answer: "Proceed with wave two.",
    structured: { approved: true },
  });
  await controlPlane.reconcileEscalation(escalation.id);

  const server = createControlPlaneHttpServer(controlPlane, {
    apiCredentials: [
      { id: "operator", token: "operator-token", scopes: ["agent:read", "audit:read"] },
      { id: "agent", token: "agent-token", scopes: ["agent:read", "decision:read"] },
    ],
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const safeResponse = await fetch(`${baseUrl}/v1/escalations/${encodeURIComponent(escalation.id)}/status`, {
    headers: { authorization: "Bearer operator-token" },
  });
  assert.equal(safeResponse.status, 200);
  const safeBody = await safeResponse.json() as Record<string, unknown>;
  assert.deepEqual(Object.keys(safeBody).sort(), [
    "blocking",
    "callStatus",
    "createdAt",
    "id",
    "priority",
    "runId",
    "scopeId",
    "status",
    "updatedAt",
  ]);
  assert.equal(safeBody.id, escalation.id);
  assert.equal(safeBody.runId, run.id);
  assert.equal(safeBody.scopeId, "deploy");
  assert.equal(safeBody.blocking, true);
  assert.equal(safeBody.status, "resolved");
  assert.equal(safeBody.callStatus, "completed");

  const serialized = JSON.stringify(safeBody);
  assert.equal(serialized.includes("Should the private rollout continue?"), false);
  assert.equal(serialized.includes("Sensitive deployment context"), false);
  assert.equal(serialized.includes("Proceed with wave two."), false);
  assert.equal(serialized.includes("private-deploy-approval-v1"), false);
  assert.equal(serialized.includes(attempt.providerCallId), false);
  assert.equal("question" in safeBody, false);
  assert.equal("context" in safeBody, false);
  assert.equal("idempotencyKey" in safeBody, false);
  assert.equal("callAttemptId" in safeBody, false);
  assert.equal("decisionId" in safeBody, false);
  assert.equal("decision" in safeBody, false);

  const sensitiveResponse = await fetch(`${baseUrl}/v1/escalations/${encodeURIComponent(escalation.id)}`, {
    headers: { authorization: "Bearer operator-token" },
  });
  assert.equal(sensitiveResponse.status, 403);
  assert.deepEqual(await sensitiveResponse.json(), { error: "forbidden", requiredScope: "decision:read" });

  const agentResponse = await fetch(`${baseUrl}/v1/escalations/${encodeURIComponent(escalation.id)}`, {
    headers: { authorization: "Bearer agent-token" },
  });
  assert.equal(agentResponse.status, 200);
  const agentBody = await agentResponse.json() as { decision: { answer: string } | null };
  assert.equal(agentBody.decision?.answer, "Proceed with wave two.");
});
