import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import type { AddressInfo } from "node:net";
import { ControlPlane } from "../src/control-plane.js";
import { FakeCallProvider } from "../src/call-provider.js";
import { createControlPlaneHttpServer, type ApiCredential } from "../src/http-server.js";
import { InMemoryControlPlaneStore } from "../src/store.js";

const servers: Array<ReturnType<typeof createControlPlaneHttpServer>> = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

async function start(apiCredentials: ApiCredential[], apiToken?: string) {
  const controlPlane = new ControlPlane(new InMemoryControlPlaneStore(), new FakeCallProvider());
  const server = createControlPlaneHttpServer(controlPlane, { apiCredentials, apiToken });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

async function capabilities(base: string, token?: string) {
  const response = await fetch(`${base}/v1/auth/capabilities`, {
    headers: token ? { authorization: `Bearer ${token}` } : undefined,
  });
  return { response, body: await response.json() as Record<string, unknown> };
}

test("capabilities endpoint exposes only authenticated credential identity and effective scopes", async () => {
  const base = await start([
    { id: "read-only", token: "read-secret", scopes: ["agent:read", "audit:read"] },
    { id: "agent", token: "agent-secret", scopes: ["agent:read", "agent:write", "decision:read", "audit:read"] },
    { id: "owner", token: "owner-secret", scopes: ["agent:read", "audit:read", "owner:callback"] },
  ]);

  const unauthenticated = await capabilities(base);
  assert.equal(unauthenticated.response.status, 401);

  const readOnly = await capabilities(base, "read-secret");
  assert.equal(readOnly.response.status, 200);
  assert.equal(readOnly.response.headers.get("cache-control"), "no-store");
  assert.deepEqual(readOnly.body, {
    credentialId: "read-only",
    scopes: ["agent:read", "audit:read"],
  });

  const agent = await capabilities(base, "agent-secret");
  assert.equal(agent.response.status, 200);
  assert.deepEqual(agent.body, {
    credentialId: "agent",
    scopes: ["agent:read", "agent:write", "decision:read", "audit:read"],
  });

  const owner = await capabilities(base, "owner-secret");
  assert.equal(owner.response.status, 200);
  assert.deepEqual(owner.body, {
    credentialId: "owner",
    scopes: ["agent:read", "audit:read", "owner:callback"],
  });

  const serialized = JSON.stringify([readOnly.body, agent.body, owner.body]);
  assert.doesNotMatch(serialized, /read-secret|agent-secret|owner-secret/);
  assert.doesNotMatch(serialized, /token/i);
  assert.doesNotMatch(JSON.stringify([readOnly.body, owner.body]), /decision:read|agent:write|calls:reconcile/);
});

test("legacy wildcard credential reports concrete effective capabilities instead of wildcard", async () => {
  const base = await start([], "legacy-secret");
  const legacy = await capabilities(base, "legacy-secret");

  assert.equal(legacy.response.status, 200);
  assert.deepEqual(legacy.body, {
    credentialId: "legacy",
    scopes: ["agent:read", "agent:write", "decision:read", "audit:read", "owner:callback", "calls:reconcile"],
  });
  assert.doesNotMatch(JSON.stringify(legacy.body), /legacy-secret|"\*"/);
});
