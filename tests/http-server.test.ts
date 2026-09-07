import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import type { AddressInfo } from "node:net";
import { ControlPlane } from "../src/control-plane.js";
import { FakeCallProvider } from "../src/call-provider.js";
import { createControlPlaneHttpServer, type HttpServerOptions } from "../src/http-server.js";
import { InMemoryControlPlaneStore } from "../src/store.js";

const servers: Array<ReturnType<typeof createControlPlaneHttpServer>> = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

async function start(options: HttpServerOptions = { apiToken: "agent-secret", calleWebhookToken: "hook-secret" }) {
  const provider = new FakeCallProvider();
  const controlPlane = new ControlPlane(new InMemoryControlPlaneStore(), provider);
  const server = createControlPlaneHttpServer(controlPlane, options);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return { base: `http://127.0.0.1:${address.port}`, provider };
}

async function api(base: string, path: string, init: RequestInit = {}, token = "agent-secret") {
  return fetch(`${base}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

test("health and readiness are unauthenticated but readiness does not claim provider reachability", async () => {
  const { base } = await start({
    apiToken: "agent-secret",
    readiness: {
      ready: true,
      providerMode: "calle",
      storeMode: "sqlite",
      liveCallConfiguration: "configured",
      publicWebhookConfiguration: "configured",
      providerNetworkChecked: false,
    },
  });

  const health = await fetch(`${base}/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { ok: true });

  const ready = await fetch(`${base}/ready`);
  assert.equal(ready.status, 200);
  assert.deepEqual(await ready.json(), {
    ready: true,
    providerMode: "calle",
    storeMode: "sqlite",
    liveCallConfiguration: "configured",
    publicWebhookConfiguration: "configured",
    providerNetworkChecked: false,
  });
});

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

test("scoped credentials isolate owner callbacks and reconciliation from normal agent tools", async () => {
  const { base } = await start({
    apiCredentials: [
      { id: "agent", token: "agent-scoped", scopes: ["agent:read", "agent:write", "audit:read"] },
      { id: "owner", token: "owner-scoped", scopes: ["owner:callback", "agent:read"] },
      { id: "reconciler", token: "reconcile-scoped", scopes: ["calls:reconcile"] },
    ],
    rateLimits: { ownerCallbacksPerWindow: 1, reconciliationsPerWindow: 1, windowMs: 60_000 },
  });

  const agentResponse = await api(base, "/v1/agents", {
    method: "POST", body: JSON.stringify({ name: "Claude", platform: "claude-code", ownerId: "owner-1" }),
  }, "agent-scoped");
  assert.equal(agentResponse.status, 201);
  const agent = await agentResponse.json() as { id: string };
  const runResponse = await api(base, "/v1/runs", {
    method: "POST", body: JSON.stringify({ agentId: agent.id, summary: "Working" }),
  }, "agent-scoped");
  const run = await runResponse.json() as { id: string };

  const agentCallback = await api(base, "/v1/callbacks", {
    method: "POST", body: JSON.stringify({ runId: run.id, idempotencyKey: "blocked-agent-callback" }),
  }, "agent-scoped");
  assert.equal(agentCallback.status, 403);
  assert.equal((await agentCallback.json() as { requiredScope: string }).requiredScope, "owner:callback");

  const ownerCallback = await api(base, "/v1/callbacks", {
    method: "POST", body: JSON.stringify({ runId: run.id, idempotencyKey: "owner-callback-1" }),
  }, "owner-scoped");
  assert.equal(ownerCallback.status, 201);

  const ownerCallbackLimited = await api(base, "/v1/callbacks", {
    method: "POST", body: JSON.stringify({ runId: run.id, idempotencyKey: "owner-callback-2" }),
  }, "owner-scoped");
  assert.equal(ownerCallbackLimited.status, 429);
  assert.ok(Number(ownerCallbackLimited.headers.get("retry-after")) >= 1);

  const agentReconcile = await api(base, "/v1/escalations/unknown/reconcile", { method: "POST", body: "{}" }, "agent-scoped");
  assert.equal(agentReconcile.status, 403);

  const reconcilerFirst = await api(base, "/v1/escalations/unknown/reconcile", { method: "POST", body: "{}" }, "reconcile-scoped");
  assert.equal(reconcilerFirst.status, 404);
  const reconcilerLimited = await api(base, "/v1/escalations/unknown/reconcile", { method: "POST", body: "{}" }, "reconcile-scoped");
  assert.equal(reconcilerLimited.status, 429);
});

test("CALL-E webhook ingress requires URL token and event header/body agreement", async () => {
  const { base } = await start();
  const body = JSON.stringify({ id: "evt_1", data: { id: "call_unknown", status: "completed", structured_result: { answer: "yes" } } });

  const unauthorized = await fetch(`${base}/webhooks/calle`, { method: "POST", headers: { "content-type": "application/json", "CALL-E-Event-Id": "evt_1" }, body });
  assert.equal(unauthorized.status, 401);

  const mismatch = await fetch(`${base}/webhooks/calle?token=hook-secret`, { method: "POST", headers: { "content-type": "application/json", "CALL-E-Event-Id": "evt_other" }, body });
  assert.equal(mismatch.status, 400);
});
