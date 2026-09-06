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

async function start() {
  const provider = new FakeCallProvider();
  const controlPlane = new ControlPlane(new InMemoryControlPlaneStore(), provider);
  const server = createControlPlaneHttpServer(controlPlane, { apiToken: "agent-secret", calleWebhookToken: "hook-secret" });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return { base: `http://127.0.0.1:${address.port}`, provider };
}

async function api(base: string, path: string, init: RequestInit = {}) {
  return fetch(`${base}${path}`, {
    ...init,
    headers: { authorization: "Bearer agent-secret", "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

test("agent API requires bearer auth and preserves non-blocking checkpoint semantics", async () => {
  const { base } = await start();
  assert.equal((await fetch(`${base}/health`)).status, 200);
  assert.equal((await fetch(`${base}/v1/agents`, { method: "POST", body: "{}" })).status, 401);

  const agentResponse = await api(base, "/v1/agents", { method: "POST", body: JSON.stringify({ name: "Claude", platform: "claude-code", ownerId: "owner-1" }) });
  assert.equal(agentResponse.status, 201);
  const agent = await agentResponse.json() as { id: string };

  const runResponse = await api(base, "/v1/runs", { method: "POST", body: JSON.stringify({ agentId: agent.id, summary: "Working", currentScope: "research" }) });
  const run = await runResponse.json() as { id: string };

  const escalationResponse = await api(base, "/v1/escalations", { method: "POST", body: JSON.stringify({
    runId: run.id, scopeId: "purchase", question: "Approve option A?", blocking: false, idempotencyKey: "decision-1",
  }) });
  assert.equal(escalationResponse.status, 201);

  const checkpointResponse = await api(base, `/v1/runs/${run.id}/checkpoint`, { method: "POST", body: JSON.stringify({ consume: false }) });
  const checkpoint = await checkpointResponse.json() as { unresolvedBlockingScopes: string[] };
  assert.deepEqual(checkpoint.unresolvedBlockingScopes, []);
});

test("CALL-E webhook ingress requires URL token and event header/body agreement", async () => {
  const { base } = await start();
  const body = JSON.stringify({ id: "evt_1", data: { id: "call_unknown", status: "completed", structured_result: { answer: "yes" } } });

  const unauthorized = await fetch(`${base}/webhooks/calle`, { method: "POST", headers: { "content-type": "application/json", "CALL-E-Event-Id": "evt_1" }, body });
  assert.equal(unauthorized.status, 401);

  const mismatch = await fetch(`${base}/webhooks/calle?token=hook-secret`, { method: "POST", headers: { "content-type": "application/json", "CALL-E-Event-Id": "evt_other" }, body });
  assert.equal(mismatch.status, 400);
});
