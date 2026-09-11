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

async function callback(base: string, body: unknown) {
  return fetch(`${base}/v1/callbacks`, {
    method: "POST",
    headers: {
      authorization: "Bearer test-secret",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

test("invalid callback bodies do not consume owner callback rate-limit budget", async () => {
  const base = await start();

  const malformed = await callback(base, {
    runId: "unknown-run",
    idempotencyKey: 42,
  });
  assert.equal(malformed.status, 400);
  assert.deepEqual(await malformed.json(), { error: "idempotencyKey is required" });

  const firstValid = await callback(base, {
    runId: "unknown-run",
    idempotencyKey: "callback-valid-1",
  });
  assert.equal(firstValid.status, 404);
  assert.deepEqual(await firstValid.json(), { error: "not_found" });

  const secondValid = await callback(base, {
    runId: "unknown-run",
    idempotencyKey: "callback-valid-2",
  });
  assert.equal(secondValid.status, 429);
  const limited = await secondValid.json() as { error?: string };
  assert.equal(limited.error, "rate_limited");
});
