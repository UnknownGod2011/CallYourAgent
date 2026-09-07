import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { FakeCallProvider } from "./call-provider.js";
import { ControlPlane } from "./control-plane.js";
import { credentialForRole } from "./credential-roles.js";
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

export interface OperatorDemoAdvanceResult {
  decisionAnswer: string;
  resumedScope: string | undefined;
  unresolvedBlockingScopes: string[];
  acknowledgedInstructionIds: string[];
  queuedInstructionCount: number;
}

export interface OperatorDemoServerOptions {
  host?: string;
  port?: number;
  /** Browser-facing read/audit token. It intentionally has no mutation scopes. */
  apiToken?: string;
  /** Optional owner-facing token: read/audit + owner callback only. */
  ownerToken?: string;
}

export interface OperatorDemoServer {
  server: Server;
  fixture: OperatorDemoFixtureResult;
  baseUrl: string;
  operatorUrl: string;
  /** Browser-facing read/audit token; retained as apiToken for CLI/test compatibility. */
  apiToken: string;
  /** Owner-facing token that can observe the run and request callbacks, but cannot mutate agent state or reconcile calls. */
  ownerToken: string;
  advance(): Promise<OperatorDemoAdvanceResult>;
  close(): Promise<void>;
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

/**
 * Advances the seeded fixture through the existing domain operations only.
 *
 * The fake provider supplies terminal evidence for the already-created decision call,
 * normal reconciliation records the owner decision and releases only that blocked
 * scope, and the agent then pulls and acknowledges the exact queued steering ids at a
 * safe checkpoint. No demo-only mutation endpoint or alternate state machine exists.
 */
export async function advanceOperatorDemoFixture(
  controlPlane: ControlPlane,
  provider: FakeCallProvider,
  fixture: OperatorDemoFixtureResult,
): Promise<OperatorDemoAdvanceResult> {
  const escalation = controlPlane.getEscalation(fixture.blockingEscalationId);
  assert.ok(escalation.callAttemptId, "blocking demo escalation must have a call attempt");
  const decisionAttempt = controlPlane.getCallAttempt(escalation.callAttemptId);
  assert.ok(decisionAttempt.providerCallId, "blocking demo decision must have a provider call id");

  provider.complete(decisionAttempt.providerCallId, {
    status: "completed",
    answer: "Approved. Proceed once final validation is complete.",
    structured: {
      approved: true,
      condition: "final validation complete",
    },
  });
  const resolved = await controlPlane.reconcileEscalation(escalation.id);
  assert.equal(resolved.status, "resolved", "demo decision reconciliation must resolve the blocked escalation");

  const checkpoint = controlPlane.checkpoint(fixture.runId, false);
  assert.deepEqual(checkpoint.unresolvedBlockingScopes, [], "resolved decision must release only the blocked scope");
  assert.equal(checkpoint.queuedInstructions.length, 1, "demo steering should still be queued at the safe checkpoint");

  const acknowledged = controlPlane.acknowledgeInstructions(
    fixture.runId,
    checkpoint.queuedInstructions.map((instruction) => instruction.id),
  );
  controlPlane.heartbeat(fixture.runId, {
    summary: "Owner approval recorded; callback steering incorporated at a safe checkpoint; production deploy resumed.",
    currentScope: "production-deploy",
  });

  const overview = getRunOverview(controlPlane, fixture.runId);
  assert.deepEqual(overview.unresolvedBlockingScopes, []);
  assert.equal(overview.queuedInstructionCount, 0);

  return {
    decisionAnswer: controlPlane.getDecision(escalation.id)?.answer ?? "",
    resumedScope: overview.run.currentScope,
    unresolvedBlockingScopes: overview.unresolvedBlockingScopes,
    acknowledgedInstructionIds: acknowledged.map((instruction) => instruction.id),
    queuedInstructionCount: overview.queuedInstructionCount,
  };
}

/**
 * Starts the deterministic operator-demo fixture through the same HTTP boundary used
 * by the browser console. Tests can pass port 0 to let the OS allocate an ephemeral
 * localhost port without inventing a second demo server implementation.
 */
export async function startOperatorDemoServer(
  options: OperatorDemoServerOptions = {},
): Promise<OperatorDemoServer> {
  const host = options.host?.trim() || "127.0.0.1";
  const port = options.port ?? 8788;
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error("operator demo port must be an integer from 0 through 65535");
  }

  const apiToken = options.apiToken?.trim() || "cya-local-demo-read-token";
  const ownerToken = options.ownerToken?.trim() || "cya-local-demo-owner-token";
  if (apiToken === ownerToken) throw new Error("operator demo read and owner tokens must be different");

  const store = new InMemoryControlPlaneStore();
  const provider = new FakeCallProvider();
  const controlPlane = new ControlPlane(store, provider);
  const fixture = await seedOperatorDemoFixture(controlPlane, provider);
  const server = createControlPlaneHttpServer(controlPlane, {
    apiCredentials: [
      credentialForRole("operator-demo-browser", apiToken, "operator-read"),
      credentialForRole("operator-demo-owner", ownerToken, "owner"),
    ],
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
  let advancePromise: Promise<OperatorDemoAdvanceResult> | undefined;

  return {
    server,
    fixture,
    baseUrl,
    operatorUrl: `${baseUrl}/operator`,
    apiToken,
    ownerToken,
    advance: () => {
      advancePromise ??= advanceOperatorDemoFixture(controlPlane, provider, fixture);
      return advancePromise;
    },
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
}

async function runOperatorDemoServer(): Promise<void> {
  const host = process.env.CYA_OPERATOR_DEMO_HOST?.trim() || "127.0.0.1";
  const rawPort = process.env.CYA_OPERATOR_DEMO_PORT?.trim();
  const port = rawPort ? Number(rawPort) : 8788;
  const apiToken = process.env.CYA_OPERATOR_DEMO_TOKEN?.trim() || "cya-local-demo-read-token";
  const ownerToken = process.env.CYA_OPERATOR_DEMO_OWNER_TOKEN?.trim() || "cya-local-demo-owner-token";
  const demo = await startOperatorDemoServer({ host, port, apiToken, ownerToken });

  console.log(JSON.stringify({
    ok: true,
    mode: "deterministic-fake-provider",
    operatorUrl: demo.operatorUrl,
    runId: demo.fixture.runId,
    apiToken: demo.apiToken,
    tokenScopes: ["agent:read", "audit:read"],
    ownerCallbackToken: demo.ownerToken,
    ownerTokenScopes: ["agent:read", "audit:read", "owner:callback"],
    expectedIndicators: {
      activeScope: demo.fixture.activeScope,
      blockedScopes: demo.fixture.unresolvedBlockingScopes,
      pendingSteering: demo.fixture.queuedInstructionCount,
    },
    nextAction: "Use the read token to observe. Use the separate owner token only when demonstrating owner-requested callback. Then press Enter here to resolve the seeded decision and safely acknowledge steering.",
    note: "Local hackathon fixture only. Neither browser token has agent-write or reconciliation authority. This does not claim a live CALL-E phone call.",
  }, null, 2));

  process.stdin.setEncoding("utf8");
  process.stdin.once("data", () => {
    void demo.advance().then((advanced) => {
      console.log(JSON.stringify({
        ok: true,
        advanced: true,
        result: advanced,
        nextAction: "Refresh /operator to see Decision and Steering acknowledged, with production-deploy resumed.",
      }, null, 2));
    }).catch((error) => {
      console.error("CallYourAgent operator demo advance failed", error);
      process.exitCode = 1;
    });
  });

  const close = () => {
    void demo.close().catch((error) => {
      console.error("CallYourAgent operator demo shutdown failed", error);
      process.exitCode = 1;
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
