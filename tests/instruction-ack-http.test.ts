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

test("HTTP instruction acknowledgement consumes exact ids and leaves later steering queued", async () => {
  const store = new InMemoryControlPlaneStore();
  const control = new ControlPlane(store, new FakeCallProvider());
  const server = createControlPlaneHttpServer(control, { apiToken: "agent-secret" });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${address.port}`;

  const agent = control.registerAgent({ name: "agent", platform: "test", ownerId: "owner-1" });
  const run = control.startRun(agent.id, "Working");
  const first = control.enqueueInstruction(run.id, "Use exact acknowledgement");
  const checkpoint = control.checkpoint(run.id);
  const later = control.enqueueInstruction(run.id, "Arrived after checkpoint");

  const response = await fetch(`${base}/v1/runs/${encodeURIComponent(run.id)}/instructions/ack`, {
    method: "POST",
    headers: { authorization: "Bearer agent-secret", "content-type": "application/json" },
    body: JSON.stringify({ instructionIds: checkpoint.queuedInstructions.map((item) => item.id) }),
  });
  assert.equal(response.status, 200);
  const body = await response.json() as { instructions: Array<{ id: string; status: string }> };
  assert.deepEqual(body.instructions.map((item) => [item.id, item.status]), [[first.id, "consumed"]]);
  assert.equal(store.instructions.get(first.id)?.status, "consumed");
  assert.equal(store.instructions.get(later.id)?.status, "queued");

  const malformed = await fetch(`${base}/v1/runs/${encodeURIComponent(run.id)}/instructions/ack`, {
    method: "POST",
    headers: { authorization: "Bearer agent-secret", "content-type": "application/json" },
    body: JSON.stringify({ instructionIds: [""] }),
  });
  assert.equal(malformed.status, 400);
});
