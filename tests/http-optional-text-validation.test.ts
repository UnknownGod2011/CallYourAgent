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
  const provider = new FakeCallProvider();
  const store = new InMemoryControlPlaneStore();
  const controlPlane = new ControlPlane(store, provider);
  const server = createControlPlaneHttpServer(controlPlane, { apiToken: "test-secret" });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${address.port}`;

  const post = (path: string, body: unknown) => fetch(`${base}${path}`, {
    method: "POST",
    headers: { authorization: "Bearer test-secret", "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  const agentResponse = await post("/v1/agents", { name: "worker", platform: "test", ownerId: "owner-1" });
  assert.equal(agentResponse.status, 201);
  const agent = await agentResponse.json() as { id: string };
  const runResponse = await post("/v1/runs", { agentId: agent.id, summary: "Working", currentScope: "docs" });
  assert.equal(runResponse.status, 201);
  const run = await runResponse.json() as { id: string; summary: string; currentScope?: string };
  return { post, run, store, controlPlane };
}

test("HTTP rejects non-string optional run and heartbeat fields without mutating run state", async () => {
  const { post, run, store, controlPlane } = await fixture();
  const runCount = store.runs.size;
  const auditCount = store.auditEvents.size;

  const invalidStart = await post("/v1/runs", {
    agentId: [...store.agents.keys()][0],
    summary: "Another run",
    currentScope: 42,
  });
  assert.equal(invalidStart.status, 400);
  assert.deepEqual(await invalidStart.json(), { error: "currentScope must be a string" });
  assert.equal(store.runs.size, runCount);
  assert.equal(store.auditEvents.size, auditCount);

  const invalidHeartbeat = await post(`/v1/runs/${encodeURIComponent(run.id)}/heartbeat`, {
    summary: { leaked: "not-text" },
  });
  assert.equal(invalidHeartbeat.status, 400);
  assert.deepEqual(await invalidHeartbeat.json(), { error: "summary must be a string" });
  const unchanged = controlPlane.getRun(run.id);
  assert.equal(unchanged.summary, "Working");
  assert.equal(unchanged.currentScope, "docs");
  assert.equal(store.auditEvents.size, auditCount);
});

test("HTTP rejects non-string escalation context before escalation or provider state exists", async () => {
  const { post, run, store } = await fixture();
  const auditCount = store.auditEvents.size;

  const response = await post("/v1/escalations", {
    runId: run.id,
    scopeId: "release",
    question: "Ship this release?",
    context: ["not", "text"],
    blocking: true,
    idempotencyKey: "decision-invalid-context",
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "context must be a string" });
  assert.equal(store.escalations.size, 0);
  assert.equal(store.callAttempts.size, 0);
  assert.equal(store.auditEvents.size, auditCount);
});

test("HTTP rejects non-string callback prompt before any call attempt or provider side effect", async () => {
  const { post, run, store } = await fixture();
  const auditCount = store.auditEvents.size;

  const response = await post("/v1/callbacks", {
    runId: run.id,
    idempotencyKey: "callback-invalid-prompt",
    prompt: 12345,
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "prompt must be a string" });
  assert.equal(store.callAttempts.size, 0);
  assert.equal(store.callbackByIdempotencyKey.size, 0);
  assert.equal(store.auditEvents.size, auditCount);
});

test("blank optional text remains compatible and normalizes to omitted", async () => {
  const { post, run, store } = await fixture();

  const callback = await post("/v1/callbacks", {
    runId: run.id,
    idempotencyKey: "callback-blank-prompt",
    prompt: "   ",
  });

  assert.equal(callback.status, 201);
  assert.equal(store.callAttempts.size, 1);
  const attempt = [...store.callAttempts.values()][0]!;
  assert.equal(attempt.request.task.includes("   "), false);
});
