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
    apiCredentials: [{ id: "auditor", token: "audit-secret", scopes: ["audit:read"] }],
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

async function audit(base: string, query = "") {
  return fetch(`${base}/v1/runs/unknown-run/audit${query}`, {
    headers: { authorization: "Bearer audit-secret" },
  });
}

test("audit limit rejects duplicate query parameters before domain lookup", async () => {
  const base = await start();
  const response = await audit(base, "?limit=10&limit=20");
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "Audit event limit must be an integer from 1 to 500" });
});

test("audit limit rejects coercive and out-of-range numeric forms", async () => {
  const base = await start();
  const invalidQueries = [
    "?limit=",
    "?limit=%20",
    "?limit=0",
    "?limit=-1",
    "?limit=1.5",
    "?limit=1e2",
    "?limit=%2B10",
    "?limit=050",
    "?limit=501",
  ];

  for (const query of invalidQueries) {
    const response = await audit(base, query);
    assert.equal(response.status, 400, query);
    assert.deepEqual(await response.json(), { error: "Audit event limit must be an integer from 1 to 500" }, query);
  }
});

test("audit limit preserves omitted/default and canonical integer behavior", async () => {
  const base = await start();

  const omitted = await audit(base);
  assert.equal(omitted.status, 404);
  assert.deepEqual(await omitted.json(), { error: "not_found" });

  for (const value of ["1", "100", "500"]) {
    const response = await audit(base, `?limit=${value}`);
    assert.equal(response.status, 404, value);
    assert.deepEqual(await response.json(), { error: "not_found" }, value);
  }
});
