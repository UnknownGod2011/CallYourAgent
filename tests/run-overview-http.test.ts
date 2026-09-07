import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import type { AddressInfo } from "node:net";
import { FakeCallProvider } from "../src/call-provider.js";
import { CallYourAgentClient } from "../src/client.js";
import { ControlPlane } from "../src/control-plane.js";
import { createControlPlaneHttpServer } from "../src/http-server.js";
import { InMemoryControlPlaneStore } from "../src/store.js";

const servers: Array<ReturnType<typeof createControlPlaneHttpServer>> = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

test("run overview is authenticated, privacy-safe, and non-consuming through HTTP and typed client", async () => {
  const provider = new FakeCallProvider();
  const controlPlane = new ControlPlane(new InMemoryControlPlaneStore(), provider);
  const server = createControlPlaneHttpServer(controlPlane, {
    apiCredentials: [
      { id: "agent", token: "agent-read-write", scopes: ["agent:read", "agent:write"] },
      { id: "owner", token: "owner-callback", scopes: ["owner:callback", "agent:read"] },
    ],
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const agentClient = new CallYourAgentClient({ baseUrl, apiToken: "agent-read-write" });
  const ownerClient = new CallYourAgentClient({ baseUrl, apiToken: "owner-callback" });

  const agent = await agentClient.registerAgent({ name: "worker", platform: "test", ownerId: "owner-1" });
  const run = await agentClient.startRun({ agentId: agent.id, summary: "Independent work continues", currentScope: "research" });
  await agentClient.requestOwnerDecision({
    runId: run.id,
    scopeId: "production-deploy",
    question: "Approve production deploy?",
    blocking: true,
    idempotencyKey: "overview-blocking-decision",
  });

  const callback = await ownerClient.requestOwnerCallback({ runId: run.id, idempotencyKey: "overview-callback" });
  assert.ok(callback.providerCallId);
  provider.complete(callback.providerCallId!, {
    status: "completed",
    providerCallId: callback.providerCallId,
    instructions: ["Keep the canary at ten percent", "Do not expose the secret launch note"],
  });
  await ownerClient.reconcileCallback(callback.id);

  const unauthorized = await fetch(`${baseUrl}/v1/runs/${encodeURIComponent(run.id)}/overview`);
  assert.equal(unauthorized.status, 401);

  const overview = await agentClient.getRunOverview(run.id);
  assert.equal(overview.run.currentScope, "research");
  assert.deepEqual(overview.unresolvedBlockingScopes, ["production-deploy"]);
  assert.equal(overview.queuedInstructionCount, 2);

  const serialized = JSON.stringify(overview);
  assert.doesNotMatch(serialized, /Keep the canary at ten percent/);
  assert.doesNotMatch(serialized, /Do not expose the secret launch note/);
  assert.doesNotMatch(serialized, /queuedInstructions/);

  const checkpoint = await agentClient.checkpoint(run.id);
  assert.equal(checkpoint.queuedInstructions.length, 2);
  assert.deepEqual(checkpoint.queuedInstructions.map((instruction) => instruction.status), ["queued", "queued"]);
});
