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

export interface OperatorDemoFreshCallbackResult {
  callbackId: string;
  providerCallId: string;
  queuedInstructionCount: number;
  queuedInstructionIds: string[];
}

export interface OperatorDemoFreshSteeringResult {
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
  completeFreshOwnerCallback(): Promise<OperatorDemoFreshCallbackResult>;
  consumeFreshOwnerSteering(): Promise<OperatorDemoFreshSteeringResult>;
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
 * Completes a callback that was newly requested through the normal owner HTTP/API
 * path after the seeded callback. The trusted demo process discovers the durable call
 * attempt, supplies deterministic provider evidence, and reconciles it through the
 * same ControlPlane method used in production. No browser reconciliation scope is
 * required and no steering text is returned to the browser-facing overview.
 */
export async function completeFreshOwnerCallback(
  controlPlane: ControlPlane,
  provider: FakeCallProvider,
  store: InMemoryControlPlaneStore,
  fixture: OperatorDemoFixtureResult,
): Promise<OperatorDemoFreshCallbackResult> {
  const candidates = [...store.callAttempts.values()]
    .filter((attempt) => attempt.purpose === "owner_callback"
      && attempt.correlationId === fixture.runId
      && attempt.id !== fixture.callbackId
      && !["completed", "failed"].includes(attempt.status))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const attempt = candidates[0];
  assert.ok(attempt, "request a fresh owner callback from /operator before completing this demo step");
  assert.ok(attempt.providerCallId, "fresh fake owner callback should have a provider call id");

  const before = new Set(
    controlPlane.checkpoint(fixture.runId, false).queuedInstructions.map((instruction) => instruction.id),
  );
  provider.complete(attempt.providerCallId, {
    status: "completed",
    instructions: ["Roll out to 25% first, review error rates, then continue only if the metrics stay healthy."],
  });
  const reconciled = await controlPlane.reconcileCallback(attempt.id);
  assert.equal(reconciled.status, "completed", "fresh owner callback must reconcile to completed");

  const checkpoint = controlPlane.checkpoint(fixture.runId, false);
  const queuedInstructionIds = checkpoint.queuedInstructions
    .filter((instruction) => !before.has(instruction.id))
    .map((instruction) => instruction.id);
  assert.equal(queuedInstructionIds.length, 1, "fresh owner callback must queue exactly one new steering instruction");

  return {
    callbackId: attempt.id,
    providerCallId: attempt.providerCallId,
    queuedInstructionCount: checkpoint.queuedInstructions.length,
    queuedInstructionIds,
  };
}

/**
 * Consumes only the steering created by completeFreshOwnerCallback, and only after an
 * explicit safe checkpoint. This keeps the demo faithful to the real worker contract:
 * human steering becomes durable queued state first and is acknowledged separately.
 */
export function consumeFreshOwnerSteering(
  controlPlane: ControlPlane,
  fixture: OperatorDemoFixtureResult,
  instructionIds: string[],
): OperatorDemoFreshSteeringResult {
  const checkpoint = controlPlane.checkpoint(fixture.runId, false);
  const available = new Set(checkpoint.queuedInstructions.map((instruction) => instruction.id));
  for (const instructionId of instructionIds) {
    assert.ok(available.has(instructionId), `fresh owner steering ${instructionId} must still be queued at the safe checkpoint`);
  }
  const acknowledged = controlPlane.acknowledgeInstructions(fixture.runId, instructionIds);
  const overview = getRunOverview(controlPlane, fixture.runId);
  return {
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
  let freshCallbackPromise: Promise<OperatorDemoFreshCallbackResult> | undefined;
  let freshSteeringResult: OperatorDemoFreshSteeringResult | undefined;

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
    completeFreshOwnerCallback: () => {
      freshCallbackPromise ??= completeFreshOwnerCallback(controlPlane, provider, store, fixture);
      return freshCallbackPromise;
    },
    consumeFreshOwnerSteering: async () => {
      if (freshSteeringResult) return freshSteeringResult;
      const completed = await (freshCallbackPromise ?? completeFreshOwnerCallback(controlPlane, provider, store, fixture));
      freshCallbackPromise ??= Promise.resolve(completed);
      freshSteeringResult = consumeFreshOwnerSteering(controlPlane, fixture, completed.queuedInstructionIds);
      return freshSteeringResult;
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
    nextAction: "Stage 1: load the run with the read token, then press Enter here to resolve the seeded decision and safely acknowledge its steering.",
    note: "Local hackathon fixture only. Neither browser token has agent-write or reconciliation authority. This does not claim a live CALL-E phone call.",
  }, null, 2));

  let step = 0;
  let inputChain = Promise.resolve();
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", () => {
    inputChain = inputChain.then(async () => {
      if (step === 0) {
        const advanced = await demo.advance();
        step = 1;
        console.log(JSON.stringify({
          ok: true,
          stage: "seeded-decision-resolved",
          result: advanced,
          nextAction: "Refresh /operator. Then paste the separate owner token, load the same run, click Call me about this run, and press Enter here again.",
        }, null, 2));
        return;
      }
      if (step === 1) {
        const completed = await demo.completeFreshOwnerCallback();
        step = 2;
        console.log(JSON.stringify({
          ok: true,
          stage: "fresh-owner-callback-reconciled",
          result: completed,
          nextAction: "Refresh /operator: fresh steering is now durably queued. Press Enter here once more to acknowledge only that steering at a safe checkpoint.",
        }, null, 2));
        return;
      }
      if (step === 2) {
        const consumed = await demo.consumeFreshOwnerSteering();
        step = 3;
        console.log(JSON.stringify({
          ok: true,
          stage: "fresh-owner-steering-acknowledged",
          result: consumed,
          nextAction: "Refresh /operator to see the fresh Callback → Steering queued → Steering acknowledged sequence.",
        }, null, 2));
        return;
      }
      console.log(JSON.stringify({ ok: true, stage: "complete", nextAction: "Demo flow already completed. Refresh /operator or stop with Ctrl+C." }, null, 2));
    }).catch((error) => {
      console.error("CallYourAgent operator demo step failed", error);
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
