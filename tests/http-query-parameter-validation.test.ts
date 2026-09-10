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

async function start() {
  const controlPlane = new ControlPlane(new InMemoryControlPlaneStore(), new FakeCallProvider());
  const server = createControlPlaneHttpServer(controlPlane, {
    apiToken: "test-secret",
    rateLimits: { ownerCallbacksPerWindow: 1, windowMs: 60_000 },
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

function authHeaders(extra: Record<string, string> = {}) {
  return { authorization: "Bearer test-secret", ...extra };
}

test("authenticated v1 routes reject undocumented query parameters without reflecting them", async () => {
  const base = await start();
  const response = await fetch(`${base}/v1/runs/unknown-run?debug=owner-secret`, {
    headers: authHeaders(),
  });

  assert.equal(response.status, 400);
  const body = await response.json();
  assert.deepEqual(body, { error: "unexpected_query_parameter" });
  assert.equal(JSON.stringify(body).includes("owner-secret"), false);

  const canonical = await fetch(`${base}/v1/runs/unknown-run`, { headers: authHeaders() });
  assert.equal(canonical.status, 404);
  assert.deepEqual(await canonical.json(), { error: "not_found" });
});

test("audit accepts only its documented limit query key", async () => {
  const base = await start();

  const valid = await fetch(`${base}/v1/runs/unknown-run/audit?limit=10`, { headers: authHeaders() });
  assert.equal(valid.status, 404);

  const unexpected = await fetch(`${base}/v1/runs/unknown-run/audit?limit=10&cursor=abc`, { headers: authHeaders() });
  assert.equal(unexpected.status, 400);
  assert.deepEqual(await unexpected.json(), { error: "unexpected_query_parameter" });
});

test("unexpected callback query fails before body parsing and does not consume callback rate-limit budget", async () => {
  const base = await start();

  const malformed = await fetch(`${base}/v1/callbacks?dryRun=true`, {
    method: "POST",
    headers: authHeaders({ "content-type": "application/json" }),
    body: "{ definitely not json",
  });
  assert.equal(malformed.status, 400);
  assert.deepEqual(await malformed.json(), { error: "unexpected_query_parameter" });

  const request = {
    runId: "unknown-run",
    idempotencyKey: "callback-query-budget",
  };
  const firstCanonical = await fetch(`${base}/v1/callbacks`, {
    method: "POST",
    headers: authHeaders({ "content-type": "application/json" }),
    body: JSON.stringify(request),
  });
  assert.equal(firstCanonical.status, 404);
  assert.deepEqual(await firstCanonical.json(), { error: "not_found" });

  const secondCanonical = await fetch(`${base}/v1/callbacks`, {
    method: "POST",
    headers: authHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({ ...request, idempotencyKey: "callback-query-budget-2" }),
  });
  assert.equal(secondCanonical.status, 429);
  const rateLimited = await secondCanonical.json() as { error?: string };
  assert.equal(rateLimited.error, "rate_limited");
});
