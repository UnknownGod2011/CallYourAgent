import assert from "node:assert/strict";
import test from "node:test";
import { FakeCallProvider } from "../src/call-provider.js";
import { ControlPlane } from "../src/control-plane.js";
import { InMemoryControlPlaneStore } from "../src/store.js";

test("opt-in fake auto-completion resolves a branch decision through normal reconciliation", async () => {
  const store = new InMemoryControlPlaneStore();
  const provider = new FakeCallProvider({ autoCompleteAfterObservations: 1 });
  const control = new ControlPlane(store, provider);
  const agent = control.registerAgent({ name: "auto-complete-agent", platform: "test", ownerId: "owner-1" });
  const run = control.startRun(agent.id, "Working independently", "independent-work");

  const escalation = await control.requestOwnerDecision({
    runId: run.id,
    scopeId: "release-approval",
    question: "Proceed with release?",
    blocking: true,
    priority: "high",
    idempotencyKey: "release-approval-v1",
  });

  const before = control.checkpoint(run.id);
  assert.deepEqual(before.unresolvedBlockingScopes, ["release-approval"]);
  assert.equal(before.run.currentScope, "independent-work");

  const reconciled = await control.reconcileEscalation(escalation.id);
  assert.equal(reconciled.escalation.status, "resolved");
  assert.equal(reconciled.decision?.answer, "Proceed with the requested scope.");
  assert.deepEqual(reconciled.decision?.structured, {
    decision: "proceed",
    source: "deterministic_fake_provider",
  });

  const after = control.checkpoint(run.id);
  assert.deepEqual(after.unresolvedBlockingScopes, []);
  assert.equal(after.run.currentScope, "independent-work");
});

test("opt-in fake auto-completion queues callback steering for safe checkpoint acknowledgement", async () => {
  const store = new InMemoryControlPlaneStore();
  const provider = new FakeCallProvider({ autoCompleteAfterObservations: 1 });
  const control = new ControlPlane(store, provider);
  const agent = control.registerAgent({ name: "callback-agent", platform: "test", ownerId: "owner-1" });
  const run = control.startRun(agent.id, "Building feature", "implementation");

  const callback = await control.requestOwnerCallback({
    runId: run.id,
    idempotencyKey: "owner-callback-v1",
    prompt: "Give me progress and let me steer",
  });

  const reconciled = await control.reconcileCallback(callback.id);
  assert.equal(reconciled.status, "completed");

  const checkpoint = control.checkpoint(run.id);
  assert.equal(checkpoint.queuedInstructions.length, 1);
  assert.equal(
    checkpoint.queuedInstructions[0]?.text,
    "Continue the current plan and report progress at the next safe checkpoint.",
  );
  assert.equal(checkpoint.queuedInstructions[0]?.status, "queued");

  const consumed = control.acknowledgeInstructions(run.id, [checkpoint.queuedInstructions[0]!.id]);
  assert.equal(consumed.length, 1);
  assert.equal(consumed[0]?.status, "consumed");
  assert.equal(control.checkpoint(run.id).queuedInstructions.length, 0);
});

test("fake auto-completion is disabled by default and validates its observation threshold", async () => {
  const provider = new FakeCallProvider();
  const started = await provider.start({
    idempotencyKey: "manual-fake-call",
    purpose: "owner_callback",
    task: "Call owner",
    metadata: {},
  });

  assert.deepEqual(await provider.observe(started.providerCallId), {
    providerCallId: started.providerCallId,
    status: "queued",
  });

  assert.throws(
    () => new FakeCallProvider({ autoCompleteAfterObservations: 0 }),
    /positive integer/,
  );
});
