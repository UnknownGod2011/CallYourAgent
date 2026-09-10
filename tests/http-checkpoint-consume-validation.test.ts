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

async function fixture() {
  const store = new InMemoryControlPlaneStore();
  const controlPlane = new ControlPlane(store, new FakeCallProvider());
  const agent = controlPlane.registerAgent({ name: "worker", platform: "custom", ownerId: "owner-1" });
  const run = controlPlane.startRun(agent.id, "working", "implementation");
  store.instructions.set("instruction-1", {
    id: "instruction-1",
    runId: run.id,
    text: "Use the safer rollout plan",
    source: "api",
    status: "queued",
    createdAt: new Date().toISOString(),
  });

  const server = createControlPlaneHttpServer(controlPlane, { apiToken: "agent-secret" });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return { base: `http://127.0.0.1:${address.port}`, runId: run.id, store };
}

async function checkpoint(base: string, runId: string, body: unknown) {
  return fetch(`${base}/v1/runs/${runId}/checkpoint`, {
    method: "POST",
    headers: { authorization: "Bearer agent-secret", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("checkpoint rejects a supplied non-boolean consume without consuming queued instructions", async () => {
  const malformedValues: unknown[] = ["true", 1, null, [], {}];

  for (const consume of malformedValues) {
    const { base, runId, store } = await fixture();
    const response = await checkpoint(base, runId, { consume });

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "consume must be boolean" });
    assert.equal(store.instructions.get("instruction-1")?.status, "queued");
  }
});

test("checkpoint keeps omission as non-consuming and literal true as the only consuming form", async () => {
  const { base, runId, store } = await fixture();

  const omitted = await checkpoint(base, runId, {});
  assert.equal(omitted.status, 200);
  assert.equal(store.instructions.get("instruction-1")?.status, "queued");

  const consuming = await checkpoint(base, runId, { consume: true });
  assert.equal(consuming.status, 200);
  const payload = await consuming.json() as { queuedInstructions: Array<{ id: string; status: string }> };
  assert.deepEqual(payload.queuedInstructions.map((instruction) => instruction.id), ["instruction-1"]);
  assert.equal(store.instructions.get("instruction-1")?.status, "consumed");
});
