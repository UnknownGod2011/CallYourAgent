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
      { id: "agent", token: "agent-token", scopes: ["agent:read", "agent:write"] },
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
    owner: new CallYourAgentClient({ baseUrl, apiToken: "owner-token" }),
    agent: new CallYourAgentClient({ baseUrl, apiToken: "agent-token" }),
  };
}

test("owner callback create/read responses never expose replayable phone task or recovery state", async () => {
  const { store, owner, agent } = await fixture();
  const registration = await agent.registerAgent({ name: "Claude", platform: "claude-code", ownerId: "owner-1" });
  const run = await agent.startRun({
    agentId: registration.id,
    summary: "Preparing a sensitive production deployment",
    currentScope: "production-deploy",
  });

  const callback = await owner.requestOwnerCallback({
    runId: run.id,
    idempotencyKey: "owner-callback-sensitive-v1",
    prompt: "Ask whether the private customer migration plan should change.",
  });

  assert.equal(callback.runId, run.id);
  assert.equal(callback.status, "queued");
  assert.deepEqual(Object.keys(callback).sort(), ["createdAt", "id", "runId", "status", "updatedAt"]);

  const persisted = store.callAttempts.get(callback.id);
  assert.ok(persisted);
  assert.match(persisted.request.task, /sensitive production deployment/);
  assert.match(persisted.request.task, /private customer migration plan/);
  assert.equal(persisted.idempotencyKey, "callback:owner-callback-sensitive-v1");

  const fetched = await owner.getCallback(callback.id);
  assert.deepEqual(fetched, callback);
  const serialized = JSON.stringify(fetched);
  assert.doesNotMatch(serialized, /sensitive production deployment/);
  assert.doesNotMatch(serialized, /private customer migration plan/);
  assert.doesNotMatch(serialized, /owner-callback-sensitive-v1/);
  assert.doesNotMatch(serialized, /providerCallId/);
  assert.doesNotMatch(serialized, /request/);
  assert.doesNotMatch(serialized, /metadata/);
});

test("callback idempotency still returns the same privacy-safe view", async () => {
  const { store, owner, agent } = await fixture();
  const registration = await agent.registerAgent({ name: "worker", platform: "custom", ownerId: "owner-1" });
  const run = await agent.startRun({ agentId: registration.id, summary: "Working" });

  const first = await owner.requestOwnerCallback({ runId: run.id, idempotencyKey: "same-callback" });
  const second = await owner.requestOwnerCallback({ runId: run.id, idempotencyKey: "same-callback" });

  assert.equal(second.id, first.id);
  assert.equal([...store.callAttempts.values()].filter((attempt) => attempt.purpose === "owner_callback").length, 1);
  assert.deepEqual(Object.keys(second).sort(), ["createdAt", "id", "runId", "status", "updatedAt"]);
});
