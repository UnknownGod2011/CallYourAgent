import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { FakeCallProvider } from "./call-provider.js";
import { ControlPlane } from "./control-plane.js";
import { createControlPlaneHttpServer } from "./http-server.js";
import { getRunOverview } from "./run-overview.js";
import { InMemoryControlPlaneStore } from "./store.js";

export interface OperatorDemoFixtureResult {
  agentId: string;
  runId: string;
  blockingEscalationId: string;
  callbackId: string;
  activeScope: string | undefined;
  unresolvedBlockingScopes: string[];
  queuedInstructionCount: number;
  duplicateEscalationDeduped: boolean;
  duplicateCallbackDeduped: boolean;
}

/**
 * Seeds the exact branch-safe state used by the operator-console demo.
 *
 * This is intentionally orchestration over the real ControlPlane + FakeCallProvider,
 * not a demo-only state machine. The blocking decision remains unresolved, an
 * independent scope keeps reporting progress, and callback steering is left queued
 * for the agent's next safe checkpoint.
 */
export async function seedOperatorDemoFixture(
  controlPlane: ControlPlane,
  provider: FakeCallProvider,
): Promise<OperatorDemoFixtureResult> {
  const agent = controlPlane.registerAgent({
    name: "Hackathon demo agent",
    platform: "generic-sdk",
    ownerId: "demo-owner",
  });
  const run = controlPlane.startRun(
    agent.id,
    "Preparing release while independent validation continues",
    "validation",
  );

  const blockingRequest = {
    runId: run.id,
    scopeId: "production-deploy",
    question: "Approve the production deployment?",
    context: "Only production-deploy should wait. Validation and documentation can continue.",
    blocking: true,
    priority: "high" as const,
    idempotencyKey: `operator-demo:${run.id}:deploy`,
  };
  const blocking = await controlPlane.requestOwnerDecision(blockingRequest);
  const duplicateBlocking = await controlPlane.requestOwnerDecision(blockingRequest);
  assert.equal(duplicateBlocking.id, blocking.id, "demo escalation retry must deduplicate");

  controlPlane.heartbeat(run.id, {
    summary: "Production deploy is waiting for owner approval; validation and documentation continue.",
    currentScope: "documentation",
  });

  const callbackRequest = {
    runId: run.id,
    idempotencyKey: `operator-demo:${run.id}:callback`,
    prompt: "Brief the owner on current progress and capture one steering instruction.",
  };
  const callback = await controlPlane.requestOwnerCallback(callbackRequest);
  const duplicateCallback = await controlPlane.requestOwnerCallback(callbackRequest);
  assert.equal(duplicateCallback.id, callback.id, "demo callback retry must deduplicate");
  assert.ok(callback.providerCallId, "fake callback should have a provider call id");

  provider.complete(callback.providerCallId, {
    status: "completed",
    instructions: ["Keep production deploy paused until the final validation report is ready."],
  });
  await controlPlane.reconcileCallback(callback.id);

  const overview = getRunOverview(controlPlane, run.id);
  assert.equal(overview.run.currentScope, "documentation");
  assert.deepEqual(overview.unresolvedBlockingScopes, ["production-deploy"]);
  assert.equal(overview.queuedInstructionCount, 1);

  return {
    agentId: agent.id,
    runId: run.id,
    blockingEscalationId: blocking.id,
    callbackId: callback.id,
    activeScope: overview.run.currentScope,
    unresolvedBlockingScopes: overview.unresolvedBlockingScopes,
    queuedInstructionCount: overview.queuedInstructionCount,
    duplicateEscalationDeduped: duplicateBlocking.id === blocking.id,
    duplicateCallbackDeduped: duplicateCallback.id === callback.id,
  };
}

async function runOperatorDemoServer(): Promise<void> {
  const host = process.env.CYA_OPERATOR_DEMO_HOST?.trim() || "127.0.0.1";
  const rawPort = process.env.CYA_OPERATOR_DEMO_PORT?.trim();
  const port = rawPort ? Number(rawPort) : 8788;
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error("CYA_OPERATOR_DEMO_PORT must be an integer from 0 through 65535");
  }

  const apiToken = process.env.CYA_OPERATOR_DEMO_TOKEN?.trim() || "cya-local-demo-token";
  const store = new InMemoryControlPlaneStore();
  const provider = new FakeCallProvider();
  const controlPlane = new ControlPlane(store, provider);
  const fixture = await seedOperatorDemoFixture(controlPlane, provider);
  const server = createControlPlaneHttpServer(controlPlane, {
    apiToken,
    readiness: {
      ready: true,
      providerMode: "fake",
      storeMode: "memory",
      liveCallConfiguration: "not_applicable",
      publicWebhookConfiguration: "not_applicable",
      providerNetworkChecked: false,
    },
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  const address = server.address() as AddressInfo;
  const baseUrl = `http://${host}:${address.port}`;

  console.log(JSON.stringify({
    ok: true,
    mode: "deterministic-fake-provider",
    operatorUrl: `${baseUrl}/operator`,
    runId: fixture.runId,
    apiToken,
    expectedIndicators: {
      activeScope: fixture.activeScope,
      blockedScopes: fixture.unresolvedBlockingScopes,
      pendingSteering: fixture.queuedInstructionCount,
    },
    note: "Local hackathon fixture only. This does not claim a live CALL-E phone call.",
  }, null, 2));

  const close = () => {
    server.close((error) => {
      if (error) {
        console.error("CallYourAgent operator demo shutdown failed", error);
        process.exitCode = 1;
      }
    });
  };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void runOperatorDemoServer().catch((error) => {
    console.error("CallYourAgent operator demo failed", error);
    process.exitCode = 1;
  });
}
