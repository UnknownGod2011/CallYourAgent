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

test("owner decision answers require explicit decision:read in addition to agent:read", async () => {
  const store = new InMemoryControlPlaneStore();
  const provider = new FakeCallProvider();
  const controlPlane = new ControlPlane(store, provider);

  const agent = controlPlane.registerAgent({ name: "worker", platform: "custom", ownerId: "owner-1" });
  const run = controlPlane.startRun(agent.id, "Preparing production rollout", "deploy");
  const escalation = await controlPlane.requestOwnerDecision({
    runId: run.id,
    scopeId: "deploy",
    question: "Should the rollout continue?",
    context: "Private rollout context",
    blocking: true,
    idempotencyKey: "deploy-approval-v1",
  });

  assert.ok(escalation.callAttemptId);
  const attempt = store.callAttempts.get(escalation.callAttemptId);
  assert.ok(attempt?.providerCallId);
  provider.complete(attempt.providerCallId, {
    status: "completed",
    providerCallId: attempt.providerCallId,
    answer: "Proceed with the staged rollout.",
    structured: { approved: true, wave: 2 },
  });
  await controlPlane.reconcileEscalation(escalation.id);

  const server = createControlPlaneHttpServer(controlPlane, {
    apiCredentials: [
      { id: "agent", token: "agent-token", scopes: ["agent:read", "agent:write", "decision:read"] },
      { id: "operator", token: "operator-token", scopes: ["agent:read", "audit:read"] },
      { id: "owner", token: "owner-token", scopes: ["agent:read", "audit:read", "owner:callback"] },
      { id: "decision-only", token: "decision-only-token", scopes: ["decision:read"] },
    ],
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${address.port}/v1/escalations/${encodeURIComponent(escalation.id)}`;

  const operatorResponse = await fetch(url, { headers: { authorization: "Bearer operator-token" } });
  assert.equal(operatorResponse.status, 403);
  assert.deepEqual(await operatorResponse.json(), { error: "forbidden", requiredScope: "decision:read" });

  const ownerResponse = await fetch(url, { headers: { authorization: "Bearer owner-token" } });
  assert.equal(ownerResponse.status, 403);
  assert.deepEqual(await ownerResponse.json(), { error: "forbidden", requiredScope: "decision:read" });

  const decisionOnlyResponse = await fetch(url, { headers: { authorization: "Bearer decision-only-token" } });
  assert.equal(decisionOnlyResponse.status, 403);
  assert.deepEqual(await decisionOnlyResponse.json(), { error: "forbidden", requiredScope: "agent:read" });

  const agentResponse = await fetch(url, { headers: { authorization: "Bearer agent-token" } });
  assert.equal(agentResponse.status, 200);
  const body = await agentResponse.json() as {
    escalation: { id: string; status: string };
    decision: { answer: string; structured?: Record<string, unknown> } | null;
  };
  assert.equal(body.escalation.id, escalation.id);
  assert.equal(body.escalation.status, "resolved");
  assert.equal(body.decision?.answer, "Proceed with the staged rollout.");
  assert.deepEqual(body.decision?.structured, { approved: true, wave: 2 });
});
