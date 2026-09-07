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

test("operator console is a static privacy-safe shell with explicit causal timeline stages", async () => {
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

  assert.match(body, /Needs owner/);
  assert.match(body, /Phone call/);
  assert.match(body, /Decision/);
  assert.match(body, /Callback/);
  assert.match(body, /Steering queued/);
  assert.match(body, /Steering acknowledged/);
  assert.match(body, /owner_decision_recorded/);
  assert.match(body, /owner_instruction_queued/);
  assert.match(body, /owner_instruction_consumed/);
  assert.match(body, /data-stage/);

  assert.match(body, /\/v1\/auth\/capabilities/);
  assert.match(body, /Owner callback enabled/);
  assert.match(body, /Read-only/);
  assert.match(body, /id="callback" class="secondary" disabled/);
  assert.match(body, /scopes\.includes\('owner:callback'\)/);
  assert.match(body, /token'\)\.addEventListener\('input', resetCapabilities\)/);
  assert.match(body, /server independently enforces the scope/i);

  assert.doesNotMatch(body, /queuedInstructions/);
  assert.doesNotMatch(body, /operator-test-secret/);
  assert.doesNotMatch(body, /hook-secret/);
  assert.match(body, /without exposing decision answers, callback transcripts, or owner instruction text/i);

  const protectedOverview = await fetch(`${base}/v1/runs/not-a-run/overview`);
  assert.equal(protectedOverview.status, 401);
});
