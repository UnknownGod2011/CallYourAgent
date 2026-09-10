import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import type { AddressInfo } from "node:net";
import { ControlPlane } from "../src/control-plane.js";
import { FakeCallProvider } from "../src/call-provider.js";
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
  const server = createControlPlaneHttpServer(controlPlane, { apiToken: "agent-secret" });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${address.port}`;

  const api = (path: string, body: unknown) => fetch(`${base}${path}`, {
    method: "POST",
    headers: { authorization: "Bearer agent-secret", "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  const agentResponse = await api("/v1/agents", { name: "worker", platform: "test", ownerId: "owner-1" });
  assert.equal(agentResponse.status, 201);
  const agent = await agentResponse.json() as { id: string };
  const runResponse = await api("/v1/runs", { agentId: agent.id, summary: "Working" });
  assert.equal(runResponse.status, 201);
  const run = await runResponse.json() as { id: string };
  return { api, runId: run.id, store };
}

function decision(runId: string, overrides: Record<string, unknown> = {}) {
  return {
    runId,
    scopeId: "release",
    question: "Ship this release?",
    blocking: true,
    idempotencyKey: `decision-${Math.random()}`,
    ...overrides,
  };
}

test("owner-decision HTTP rejects invalid priority before durable mutation", async () => {
  const { api, runId, store } = await fixture();
  const response = await api("/v1/escalations", decision(runId, { priority: "urgent" }));

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "priority must be one of: low, normal, high, critical" });
  assert.equal(store.escalations.size, 0);
  assert.equal(store.callAttempts.size, 0);
});

test("owner-decision HTTP rejects malformed expiresAt before durable mutation", async () => {
  const { api, runId, store } = await fixture();
  for (const expiresAt of ["tomorrow", "2026-09-11T12:00:00", 12345, "2026-02-31T12:00:00Z"]) {
    const response = await api("/v1/escalations", decision(runId, { expiresAt }));
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "expiresAt must be an ISO 8601 date-time with timezone" });
  }
  assert.equal(store.escalations.size, 0);
  assert.equal(store.callAttempts.size, 0);
});

test("owner-decision HTTP accepts valid priority and zoned ISO expiry", async () => {
  const { api, runId, store } = await fixture();
  const expiresAt = "2099-01-02T03:04:05.678+05:30";
  const response = await api("/v1/escalations", decision(runId, { priority: "high", expiresAt }));

  assert.equal(response.status, 201);
  const escalation = await response.json() as { priority: string; expiresAt?: string };
  assert.equal(escalation.priority, "high");
  assert.equal(escalation.expiresAt, expiresAt);
  assert.equal(store.escalations.size, 1);
  assert.equal(store.callAttempts.size, 1);
});
