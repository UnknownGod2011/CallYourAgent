import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { FakeCallProvider } from "../src/call-provider.js";
import { CallYourAgentClient } from "../src/client.js";
import { ControlPlane } from "../src/control-plane.js";
import { createControlPlaneHttpServer } from "../src/http-server.js";
import { SqliteControlPlaneStore } from "../src/sqlite-store.js";

const credentials = [
  { id: "agent", token: "sqlite-agent-token", scopes: ["agent:read", "agent:write", "audit:read"] as const },
  { id: "operator-read", token: "sqlite-read-token", scopes: ["agent:read", "audit:read"] as const },
  { id: "owner", token: "sqlite-owner-token", scopes: ["agent:read", "audit:read", "owner:callback"] as const },
  { id: "reconciler", token: "sqlite-reconciler-token", scopes: ["calls:reconcile"] as const },
];

async function listen(controlPlane: ControlPlane) {
  const server = createControlPlaneHttpServer(controlPlane, {
    apiCredentials: credentials.map((credential) => ({ ...credential, scopes: [...credential.scopes] })),
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

test("SQLite-backed owner/read credential split and privacy-safe callback overview survive restart", async () => {
  const directory = mkdtempSync(join(tmpdir(), "cya-owner-http-restart-"));
  const filename = join(directory, "state.db");
  const provider = new FakeCallProvider();
  let firstServer: Awaited<ReturnType<typeof listen>> | undefined;
  let secondServer: Awaited<ReturnType<typeof listen>> | undefined;
  let firstStore: SqliteControlPlaneStore | undefined;
  let secondStore: SqliteControlPlaneStore | undefined;

  try {
    firstStore = SqliteControlPlaneStore.open(filename);
    const firstControlPlane = new ControlPlane(firstStore, provider);
    firstServer = await listen(firstControlPlane);

    const agent = new CallYourAgentClient({ baseUrl: firstServer.baseUrl, apiToken: "sqlite-agent-token" });
    const owner = new CallYourAgentClient({ baseUrl: firstServer.baseUrl, apiToken: "sqlite-owner-token" });
    const reconciler = new CallYourAgentClient({ baseUrl: firstServer.baseUrl, apiToken: "sqlite-reconciler-token" });

    const registration = await agent.registerAgent({ name: "Durable worker", platform: "custom", ownerId: "owner-1" });
    const run = await agent.startRun({ agentId: registration.id, summary: "Preparing release", currentScope: "release" });
    const callback = await owner.requestOwnerCallback({
      runId: run.id,
      idempotencyKey: "sqlite-owner-callback-restart",
      prompt: "Give me the current release status and capture my private steering.",
    });
    assert.ok(callback.providerCallId);

    provider.complete(callback.providerCallId!, {
      status: "completed",
      providerCallId: callback.providerCallId,
      instructions: ["Keep this private: roll out to five percent first"],
    });
    await reconciler.reconcileCallback(callback.id);

    const beforeRestart = await owner.getRunOverview(run.id);
    assert.equal(beforeRestart.latestOwnerCallback?.id, callback.id);
    assert.equal(beforeRestart.latestOwnerCallback?.status, "completed");
    assert.equal(beforeRestart.queuedInstructionCount, 1);
    assert.doesNotMatch(JSON.stringify(beforeRestart), /roll out to five percent/i);
    assert.doesNotMatch(JSON.stringify(beforeRestart), /current release status/i);

    await firstServer.close();
    firstServer = undefined;
    firstStore.close();
    firstStore = undefined;

    secondStore = SqliteControlPlaneStore.open(filename);
    const secondControlPlane = new ControlPlane(secondStore, provider);
    secondServer = await listen(secondControlPlane);

    const readAfterRestart = new CallYourAgentClient({ baseUrl: secondServer.baseUrl, apiToken: "sqlite-read-token" });
    const ownerAfterRestart = new CallYourAgentClient({ baseUrl: secondServer.baseUrl, apiToken: "sqlite-owner-token" });

    const readOverview = await readAfterRestart.getRunOverview(run.id);
    const ownerOverview = await ownerAfterRestart.getRunOverview(run.id);
    for (const overview of [readOverview, ownerOverview]) {
      assert.equal(overview.run.id, run.id);
      assert.equal(overview.latestOwnerCallback?.id, callback.id);
      assert.equal(overview.latestOwnerCallback?.status, "completed");
      assert.equal(overview.queuedInstructionCount, 1);
      const serialized = JSON.stringify(overview);
      assert.doesNotMatch(serialized, /roll out to five percent/i);
      assert.doesNotMatch(serialized, /current release status/i);
      assert.doesNotMatch(serialized, /queuedInstructions/);
      assert.doesNotMatch(serialized, /request/);
    }

    const readCannotCallback = await fetch(`${secondServer.baseUrl}/v1/callbacks`, {
      method: "POST",
      headers: { authorization: "Bearer sqlite-read-token", "content-type": "application/json" },
      body: JSON.stringify({ runId: run.id, idempotencyKey: "read-must-not-call" }),
    });
    assert.equal(readCannotCallback.status, 403);

    const ownerCannotCheckpoint = await fetch(`${secondServer.baseUrl}/v1/runs/${encodeURIComponent(run.id)}/checkpoint`, {
      method: "POST",
      headers: { authorization: "Bearer sqlite-owner-token", "content-type": "application/json" },
      body: JSON.stringify({ consume: false }),
    });
    assert.equal(ownerCannotCheckpoint.status, 403);

    const ownerCannotReconcile = await fetch(`${secondServer.baseUrl}/v1/callbacks/${encodeURIComponent(callback.id)}/reconcile`, {
      method: "POST",
      headers: { authorization: "Bearer sqlite-owner-token", "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(ownerCannotReconcile.status, 403);

    const idempotentReplay = await ownerAfterRestart.requestOwnerCallback({
      runId: run.id,
      idempotencyKey: "sqlite-owner-callback-restart",
      prompt: "A retry must not place another phone call.",
    });
    assert.equal(idempotentReplay.id, callback.id);
    assert.equal(idempotentReplay.status, "completed");
    assert.equal(secondStore.callAttempts.size, 1, "restart retry must reuse the durable callback idempotency mapping");
  } finally {
    if (firstServer) await firstServer.close();
    if (secondServer) await secondServer.close();
    if (firstStore) firstStore.close();
    if (secondStore) secondStore.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
