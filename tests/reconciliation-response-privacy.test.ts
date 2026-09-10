import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import type { AddressInfo } from "node:net";
import { FakeCallProvider } from "../src/call-provider.js";
import { CallYourAgentClient } from "../src/client.js";
import { ControlPlane } from "../src/control-plane.js";
import { createControlPlaneHttpServer } from "../src/http-server.js";
import { InMemoryControlPlaneStore } from "../src/store.js";

const servers: Array<ReturnType<typeof createControlPlaneHttpServer>> = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

async function fixture() {
  const store = new InMemoryControlPlaneStore();
  const provider = new FakeCallProvider();
  const controlPlane = new ControlPlane(store, provider);
  const server = createControlPlaneHttpServer(controlPlane, {
    apiCredentials: [
      { id: "agent", token: "agent-token", scopes: ["agent:read", "agent:write", "decision:read"] },
      { id: "owner", token: "owner-token", scopes: ["agent:read", "owner:callback"] },
      { id: "reconciler", token: "reconciler-token", scopes: ["calls:reconcile"] },
    ],
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  return {
    store,
    provider,
    agent: new CallYourAgentClient({ baseUrl, apiToken: "agent-token" }),
    owner: new CallYourAgentClient({ baseUrl, apiToken: "owner-token" }),
    reconciler: new CallYourAgentClient({ baseUrl, apiToken: "reconciler-token" }),
  };
}

test("decision reconciliation returns lifecycle state without decision or escalation content", async () => {
  const { store, provider, agent, reconciler } = await fixture();
  const registration = await agent.registerAgent({ name: "worker", platform: "claude-code", ownerId: "owner-private" });
  const run = await agent.startRun({ agentId: registration.id, summary: "Sensitive acquisition integration", currentScope: "release-approval" });
  const escalation = await agent.requestOwnerDecision({
    runId: run.id,
    scopeId: "release-approval",
    question: "Approve the confidential acquisition release?",
    context: "SECRET_CUSTOMER_CONTEXT",
    blocking: true,
    idempotencyKey: "SECRET_DECISION_KEY",
  });
  const attempt = store.callAttempts.get(escalation.callAttemptId!)!;
  provider.complete(attempt.providerCallId!, {
    status: "completed",
    answer: "SECRET_OWNER_ANSWER",
    structured: { approvalCode: "SECRET_APPROVAL_CODE" },
  });

  const result = await reconciler.reconcileEscalation(escalation.id);
  assert.equal(result.id, escalation.id);
  assert.equal(result.status, "resolved");
  assert.equal(result.callStatus, "completed");
  assert.deepEqual(Object.keys(result).sort(), [
    "blocking", "callStatus", "createdAt", "id", "priority", "runId", "scopeId", "status", "updatedAt",
  ]);

  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /confidential acquisition/);
  assert.doesNotMatch(serialized, /SECRET_CUSTOMER_CONTEXT/);
  assert.doesNotMatch(serialized, /SECRET_DECISION_KEY/);
  assert.doesNotMatch(serialized, /SECRET_OWNER_ANSWER/);
  assert.doesNotMatch(serialized, /SECRET_APPROVAL_CODE/);
  assert.doesNotMatch(serialized, /callAttemptId/);
  assert.doesNotMatch(serialized, /decisionId/);
  assert.doesNotMatch(serialized, /providerCallId/);
});

test("callback reconciliation returns callback lifecycle without replayable task or steering", async () => {
  const { store, provider, agent, owner, reconciler } = await fixture();
  const registration = await agent.registerAgent({ name: "worker", platform: "custom", ownerId: "owner-private" });
  const run = await agent.startRun({
    agentId: registration.id,
    summary: "SECRET_AGENT_STATUS",
    currentScope: "private-release",
  });
  const callback = await owner.requestOwnerCallback({
    runId: run.id,
    idempotencyKey: "SECRET_CALLBACK_KEY",
    prompt: "SECRET_CALLBACK_PROMPT",
  });
  const attempt = store.callAttempts.get(callback.id)!;
  provider.complete(attempt.providerCallId!, {
    status: "completed",
    instructions: ["SECRET_OWNER_STEERING"],
  });

  const result = await reconciler.reconcileCallback(callback.id);
  assert.equal(result.id, callback.id);
  assert.equal(result.status, "completed");
  assert.deepEqual(Object.keys(result).sort(), ["createdAt", "id", "runId", "status", "updatedAt"]);

  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /SECRET_AGENT_STATUS/);
  assert.doesNotMatch(serialized, /SECRET_CALLBACK_KEY/);
  assert.doesNotMatch(serialized, /SECRET_CALLBACK_PROMPT/);
  assert.doesNotMatch(serialized, /SECRET_OWNER_STEERING/);
  assert.doesNotMatch(serialized, /providerCallId/);
  assert.doesNotMatch(serialized, /idempotencyKey/);
  assert.doesNotMatch(serialized, /request/);
  assert.doesNotMatch(serialized, /metadata/);
  assert.doesNotMatch(serialized, /lastError/);
});
