import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import type { AddressInfo } from "node:net";
import type { ControlPlane } from "../src/control-plane.js";
import { createControlPlaneHttpServer } from "../src/http-server.js";

const servers: Array<ReturnType<typeof createControlPlaneHttpServer>> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

async function start(controlPlane: ControlPlane) {
  const server = createControlPlaneHttpServer(controlPlane, { apiToken: "agent-secret" });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

function authorized(path: string, init: RequestInit = {}) {
  return {
    path,
    init: {
      ...init,
      headers: { authorization: "Bearer agent-secret", "content-type": "application/json", ...(init.headers ?? {}) },
    },
  };
}

test("unexpected control-plane failures do not leak sensitive exception messages", async () => {
  const sensitive = "private-provider-detail owner-contact instruction-text";
  const controlPlane = {
    getRun() {
      throw new Error(sensitive);
    },
  } as unknown as ControlPlane;
  const base = await start(controlPlane);
  const request = authorized("/v1/runs/run-1");
  const response = await fetch(`${base}${request.path}`, request.init);
  const body = await response.text();

  assert.equal(response.status, 500);
  assert.deepEqual(JSON.parse(body), { error: "internal_error" });
  assert.equal(body.includes(sensitive), false);
  assert.equal(body.includes("owner-contact"), false);
  assert.equal(body.includes("instruction-text"), false);
});

test("unknown resource errors are privacy-safe and do not echo attacker-controlled identifiers", async () => {
  const sensitiveId = "run-private-contact-detail";
  const controlPlane = {
    getRun() {
      throw new Error(`Unknown run: ${sensitiveId}`);
    },
  } as unknown as ControlPlane;
  const base = await start(controlPlane);
  const request = authorized(`/v1/runs/${encodeURIComponent(sensitiveId)}`);
  const response = await fetch(`${base}${request.path}`, request.init);
  const body = await response.text();

  assert.equal(response.status, 404);
  assert.deepEqual(JSON.parse(body), { error: "not_found" });
  assert.equal(body.includes(sensitiveId), false);
});

test("transport validation remains actionable without exposing runtime details", async () => {
  const controlPlane = {} as ControlPlane;
  const base = await start(controlPlane);
  const request = authorized("/v1/agents", { method: "POST", body: "{" });
  const response = await fetch(`${base}${request.path}`, request.init);

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "invalid_json" });
});
