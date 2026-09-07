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
  const controlPlane = new ControlPlane(new InMemoryControlPlaneStore(), new FakeCallProvider());
  const server = createControlPlaneHttpServer(controlPlane, { apiToken: "operator-test-secret", calleWebhookToken: "hook-secret" });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

test("operator console is a static shell over the privacy-safe overview while control-plane data remains authenticated", async () => {
  const base = await start();
  const page = await fetch(`${base}/operator`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-type") ?? "", /^text\/html/);
  assert.match(page.headers.get("content-security-policy") ?? "", /connect-src 'self'/);
  assert.equal(page.headers.get("cache-control"), "no-store");

  const body = await page.text();
  assert.match(body, /CallYourAgent/);
  assert.match(body, /durable audit history/i);
  assert.match(body, /owner:callback/);
  assert.match(body, /Active scope/);
  assert.match(body, /Blocked scopes/);
  assert.match(body, /Pending steering/);
  assert.match(body, /\/v1\/runs\/.*\/overview/);
  assert.match(body, /queuedInstructionCount/);
  assert.doesNotMatch(body, /queuedInstructions/);
  assert.doesNotMatch(body, /operator-test-secret/);
  assert.doesNotMatch(body, /hook-secret/);

  const protectedOverview = await fetch(`${base}/v1/runs/not-a-run/overview`);
  assert.equal(protectedOverview.status, 401);
});
