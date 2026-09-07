import assert from "node:assert/strict";
import { FakeCallProvider } from "./call-provider.js";
import { ControlPlane } from "./control-plane.js";
import { InMemoryControlPlaneStore } from "./store.js";

export interface DeterministicDemoResult {
  agentId: string;
  runId: string;
  nonBlockingEscalationId: string;
  blockingEscalationId: string;
  callbackId: string;
  unrelatedWorkContinued: boolean;
  blockedScopesBeforeDecision: string[];
  blockedScopesAfterDecision: string[];
  callbackIncludedCurrentStatus: boolean;
  queuedInstructionTexts: string[];
  consumedInstructionCount: number;
  auditEventTypes: string[];
}

/**
 * Runs the complete fake-provider product story without credentials or phone credits.
 * Assertions intentionally fail the demo if a core product invariant regresses.
 */
export async function runDeterministicDemo(): Promise<DeterministicDemoResult> {
  const store = new InMemoryControlPlaneStore();
  const provider = new FakeCallProvider();
  const controlPlane = new ControlPlane(store, provider);

  const agent = controlPlane.registerAgent({
    name: "Demo autonomous agent",
    platform: "generic-sdk",
    ownerId: "demo-owner",
  });
  const run = controlPlane.startRun(agent.id, "Preparing a release", "research");

  const nonBlocking = await controlPlane.requestOwnerDecision({
    runId: run.id,
    scopeId: "copy-choice",
    question: "Which launch headline should I use?",
    context: "This choice can arrive later; implementation can continue.",
    blocking: false,
    priority: "normal",
    idempotencyKey: "demo:headline:v1",
  });
  assert.ok(nonBlocking.callAttemptId, "non-blocking escalation should schedule a fake call");

  const checkpointAfterNonBlocking = controlPlane.checkpoint(run.id);
  assert.deepEqual(
    checkpointAfterNonBlocking.unresolvedBlockingScopes,
    [],
    "a non-blocking owner decision must not freeze the run",
  );

  const continuedRun = controlPlane.heartbeat(run.id, {
    summary: "Headline decision pending; tests are still running",
    currentScope: "test-suite",
  });
  const unrelatedWorkContinued = continuedRun.currentScope === "test-suite";
  assert.equal(unrelatedWorkContinued, true, "unrelated work should continue while a non-blocking decision is pending");

  const blocking = await controlPlane.requestOwnerDecision({
    runId: run.id,
    scopeId: "production-deploy",
    question: "Approve production deployment now?",
    context: "Only the production-deploy branch must wait for approval.",
    blocking: true,
    priority: "high",
    idempotencyKey: "demo:deploy:v1",
  });
  assert.ok(blocking.callAttemptId, "blocking escalation should schedule a fake call");

  const beforeDecision = controlPlane.checkpoint(run.id);
  assert.deepEqual(beforeDecision.unresolvedBlockingScopes, ["production-deploy"]);

  controlPlane.heartbeat(run.id, {
    summary: "Production deploy is blocked; documentation work continues",
    currentScope: "documentation",
  });

  const blockingAttempt = controlPlane.getCallAttempt(blocking.callAttemptId);
  assert.ok(blockingAttempt.providerCallId);
  provider.complete(blockingAttempt.providerCallId, {
    status: "completed",
    answer: "Approved after tests pass",
    structured: { approved: true, condition: "tests_pass" },
  });
  await controlPlane.reconcileEscalation(blocking.id);

  const afterDecision = controlPlane.checkpoint(run.id);
  assert.deepEqual(afterDecision.unresolvedBlockingScopes, [], "resolved blocking scope should resume");

  const nonBlockingAttempt = controlPlane.getCallAttempt(nonBlocking.callAttemptId);
  assert.ok(nonBlockingAttempt.providerCallId);
  provider.complete(nonBlockingAttempt.providerCallId, {
    status: "completed",
    answer: "Use the concise headline",
    structured: { headline: "concise" },
  });
  await controlPlane.reconcileEscalation(nonBlocking.id);

  controlPlane.heartbeat(run.id, {
    summary: "Tests passed; preparing final deployment",
    currentScope: "release",
  });

  const callback = await controlPlane.requestOwnerCallback({
    runId: run.id,
    idempotencyKey: "demo:callback:v1",
    prompt: "Give the owner a status briefing and capture any steering.",
  });
  const callbackIncludedCurrentStatus = callback.request.task.includes("Tests passed; preparing final deployment")
    && callback.request.task.includes("Current scope: release");
  assert.equal(callbackIncludedCurrentStatus, true, "callback must contain a current status snapshot");
  assert.ok(callback.providerCallId);

  provider.complete(callback.providerCallId, {
    status: "completed",
    instructions: [
      "Deploy only after the final smoke test.",
      "Send me the release summary after deployment.",
    ],
  });
  await controlPlane.reconcileCallback(callback.id);

  const queuedCheckpoint = controlPlane.checkpoint(run.id, false);
  assert.deepEqual(
    queuedCheckpoint.queuedInstructions.map((instruction) => instruction.text),
    ["Deploy only after the final smoke test.", "Send me the release summary after deployment."],
    "callback steering must become durable queued instructions",
  );

  const consumedCheckpoint = controlPlane.checkpoint(run.id, true);
  assert.equal(consumedCheckpoint.queuedInstructions.length, 2, "safe checkpoint should consume the queued steering");
  assert.equal(controlPlane.checkpoint(run.id, false).queuedInstructions.length, 0, "consumed steering must leave the queue");

  const audit = controlPlane.listAuditEvents(run.id, 500);
  const auditEventTypes = audit.map((event) => event.type);
  for (const requiredType of [
    "escalation_created",
    "owner_decision_recorded",
    "owner_callback_requested",
    "owner_instruction_queued",
    "owner_instruction_consumed",
  ]) {
    assert.ok(auditEventTypes.includes(requiredType as never), `audit timeline should contain ${requiredType}`);
  }

  return {
    agentId: agent.id,
    runId: run.id,
    nonBlockingEscalationId: nonBlocking.id,
    blockingEscalationId: blocking.id,
    callbackId: callback.id,
    unrelatedWorkContinued,
    blockedScopesBeforeDecision: beforeDecision.unresolvedBlockingScopes,
    blockedScopesAfterDecision: afterDecision.unresolvedBlockingScopes,
    callbackIncludedCurrentStatus,
    queuedInstructionTexts: queuedCheckpoint.queuedInstructions.map((instruction) => instruction.text),
    consumedInstructionCount: consumedCheckpoint.queuedInstructions.length,
    auditEventTypes,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void runDeterministicDemo()
    .then((result) => {
      console.log(JSON.stringify({ ok: true, demo: result }, null, 2));
    })
    .catch((error) => {
      console.error("CallYourAgent deterministic demo failed", error);
      process.exitCode = 1;
    });
}
