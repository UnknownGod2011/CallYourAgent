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
  const controlPlane = new ControlPlane(new InMemoryControlPlaneStore(), new FakeCallProvider());
  const server = createControlPlaneHttpServer(controlPlane, { apiToken: "test-secret" });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return { controlPlane, base: `http://127.0.0.1:${address.port}` };
}

function post(base: string, path: string, body: unknown) {
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: { authorization: "Bearer test-secret", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("instruction acknowledgement for another run is a privacy-safe 409 conflict", async () => {
  const { controlPlane, base } = await fixture();
  const agent = controlPlane.registerAgent({ name: "worker", platform: "test", ownerId: "owner" });
  const firstRun = controlPlane.startRun(agent.id, "first run");
  const secondRun = controlPlane.startRun(agent.id, "second run");
  const instruction = controlPlane.enqueueInstruction(firstRun.id, "secret steering text");

  const response = await post(base, `/v1/runs/${secondRun.id}/instructions/ack`, {
    instructionIds: [instruction.id],
  });

  assert.equal(response.status, 409);
  const body = await response.json() as { error: string };
  assert.deepEqual(body, { error: "instruction_run_mismatch" });
  const serialized = JSON.stringify(body);
  assert.equal(serialized.includes(instruction.id), false);
  assert.equal(serialized.includes(firstRun.id), false);
  assert.equal(serialized.includes(secondRun.id), false);
  assert.equal(controlPlane.checkpoint(firstRun.id).queuedInstructions[0]?.id, instruction.id);
});

test("reconciling an owner-decision call as a callback is a privacy-safe 409 conflict", async () => {
  const { controlPlane, base } = await fixture();
  const agent = controlPlane.registerAgent({ name: "worker", platform: "test", ownerId: "owner" });
  const run = controlPlane.startRun(agent.id, "deploying");
  const escalation = await controlPlane.requestOwnerDecision({
    runId: run.id,
    scopeId: "release",
    question: "Ship?",
    blocking: true,
    idempotencyKey: "release-decision",
  });
  assert.ok(escalation.callAttemptId);

  const response = await post(base, `/v1/callbacks/${escalation.callAttemptId}/reconcile`, {});

  assert.equal(response.status, 409);
  const body = await response.json() as { error: string };
  assert.deepEqual(body, { error: "callback_purpose_mismatch" });
  assert.equal(JSON.stringify(body).includes(escalation.callAttemptId!), false);
});
