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

async function start(reconciliationsPerWindow = 60) {
  const controlPlane = new ControlPlane(new InMemoryControlPlaneStore(), new FakeCallProvider());
  const server = createControlPlaneHttpServer(controlPlane, {
    apiToken: "test-secret",
    rateLimits: { reconciliationsPerWindow, windowMs: 60_000 },
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

async function request(base: string, path: string, method: "GET" | "POST", body?: unknown) {
  return fetch(`${base}${path}`, {
    method,
    headers: {
      authorization: "Bearer test-secret",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test("malformed percent-encoding in path identifiers returns privacy-safe 400 across routes", async () => {
  const base = await start();
  const malformed = "%ZZsensitive-fragment";
  const cases: Array<{ method: "GET" | "POST"; path: string; body?: unknown }> = [
    { method: "GET", path: `/v1/runs/${malformed}` },
    { method: "GET", path: `/v1/runs/${malformed}/overview` },
    { method: "GET", path: `/v1/runs/${malformed}/audit` },
    { method: "POST", path: `/v1/runs/${malformed}/heartbeat`, body: {} },
    { method: "POST", path: `/v1/runs/${malformed}/checkpoint`, body: {} },
    { method: "POST", path: `/v1/runs/${malformed}/instructions/ack`, body: { instructionIds: [] } },
    { method: "GET", path: `/v1/escalations/${malformed}/status` },
    { method: "GET", path: `/v1/escalations/${malformed}` },
    { method: "POST", path: `/v1/escalations/${malformed}/reconcile`, body: {} },
    { method: "GET", path: `/v1/callbacks/${malformed}` },
    { method: "POST", path: `/v1/callbacks/${malformed}/reconcile`, body: {} },
  ];

  for (const entry of cases) {
    const response = await request(base, entry.path, entry.method, entry.body);
    assert.equal(response.status, 400, `${entry.method} ${entry.path}`);
    const payload = await response.json();
    assert.deepEqual(payload, { error: "invalid_path_identifier" }, `${entry.method} ${entry.path}`);
    assert.equal(JSON.stringify(payload).includes("sensitive-fragment"), false);
    assert.equal(JSON.stringify(payload).includes("%ZZ"), false);
  }
});

test("malformed reconciliation path does not consume the reconciliation rate-limit budget", async () => {
  const base = await start(1);

  const malformed = await request(base, "/v1/escalations/%ZZ/reconcile", "POST", {});
  assert.equal(malformed.status, 400);
  assert.deepEqual(await malformed.json(), { error: "invalid_path_identifier" });

  const validUnknown = await request(base, "/v1/escalations/unknown-escalation/reconcile", "POST", {});
  assert.equal(validUnknown.status, 404);
  assert.deepEqual(await validUnknown.json(), { error: "not_found" });

  const exhausted = await request(base, "/v1/escalations/another-unknown/reconcile", "POST", {});
  assert.equal(exhausted.status, 429);
  const payload = await exhausted.json() as { error: string };
  assert.equal(payload.error, "rate_limited");
});
