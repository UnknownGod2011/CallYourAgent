import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import type { AddressInfo } from "node:net";
import { FakeCallProvider } from "../src/call-provider.js";
import { CallYourAgentClient, CallYourAgentHttpError } from "../src/client.js";
import { ControlPlane } from "../src/control-plane.js";
import { createControlPlaneHttpServer } from "../src/http-server.js";
import { InMemoryControlPlaneStore } from "../src/store.js";

const servers: Array<ReturnType<typeof createControlPlaneHttpServer>> = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

async function start(token = "agent-secret") {
  const provider = new FakeCallProvider();
  const controlPlane = new ControlPlane(new InMemoryControlPlaneStore(), provider);
  const server = createControlPlaneHttpServer(controlPlane, { apiToken: token });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  const client = new CallYourAgentClient({ baseUrl: `http://127.0.0.1:${address.port}/`, apiToken: token });
  return { client, provider };
}

test("typed client exposes authenticated credential capabilities", async () => {
  const { client } = await start();
  const capabilities = await client.getCredentialCapabilities();
  assert.equal(capabilities.credentialId, "legacy");
  assert.deepEqual(capabilities.scopes, [
    "agent:read",
    "agent:write",
    "audit:read",
    "owner:callback",
    "calls:reconcile",
  ]);
  assert.ok(!capabilities.scopes.includes("*" as never));
});

test("typed client drives register, run, escalation, status, and checkpoint flow", async () => {
  const { client } = await start();
  assert.deepEqual(await client.health(), { ok: true });

  const agent = await client.registerAgent({ name: "Claude", platform: "claude-code", ownerId: "owner-1" });
  const run = await client.startRun({ agentId: agent.id, summary: "Investigating", currentScope: "research" });

  const updated = await client.reportStatus(run.id, { summary: "Research complete", currentScope: "implementation" });
  assert.equal(updated.summary, "Research complete");

  const escalation = await client.escalate({
    runId: run.id,
    scopeId: "purchase",
    question: "Approve option A?",
    blocking: false,
    idempotencyKey: "decision-1",
  });
  const status = await client.getEscalationStatus(escalation.id);
  assert.equal(status.escalation.id, escalation.id);
  assert.equal(status.decision, null);

  const checkpoint = await client.checkpoint(run.id);
  assert.deepEqual(checkpoint.unresolvedBlockingScopes, []);
  assert.deepEqual(checkpoint.queuedInstructions, []);
});

test("typed client drives owner-requested callback path with privacy-safe views", async () => {
  const { client } = await start();
  const agent = await client.registerAgent({ name: "Worker", platform: "custom", ownerId: "owner-1" });
  const run = await client.startRun({ agentId: agent.id, summary: "Implementing authentication" });

  const callback = await client.requestOwnerCallback({ runId: run.id, idempotencyKey: "callback-1", prompt: "Give me a status update" });
  const fetched = await client.getCallback(callback.id);
  assert.equal(fetched.id, callback.id);
  assert.equal(fetched.runId, run.id);
  assert.equal(fetched.status, callback.status);
  assert.deepEqual(Object.keys(fetched).sort(), ["createdAt", "id", "runId", "status", "updatedAt"]);
});

test("typed client exposes HTTP failures with status and server body", async () => {
  const { client } = await start("correct-token");
  const unauthorized = new CallYourAgentClient({ baseUrl: client.baseUrl, apiToken: "wrong-token" });

  await assert.rejects(
    () => unauthorized.registerAgent({ name: "Agent", platform: "test", ownerId: "owner" }),
    (error: unknown) => {
      assert.ok(error instanceof CallYourAgentHttpError);
      assert.equal(error.status, 401);
      assert.deepEqual(error.body, { error: "unauthorized" });
      return true;
    },
  );
});
