import assert from "node:assert/strict";
import test from "node:test";
import { FakeCallProvider } from "../src/call-provider.js";
import { ControlPlane } from "../src/control-plane.js";
import { InMemoryControlPlaneStore } from "../src/store.js";

test("owner decision terminal effects use one durable decision identity even with stale entity status", async () => {
  const store = new InMemoryControlPlaneStore();
  const provider = new FakeCallProvider();
  const control = new ControlPlane(store, provider);
  const agent = control.registerAgent({ name: "terminal-decision-agent", platform: "test", ownerId: "owner-1" });
  const run = control.startRun(agent.id, "Continue independent documentation", "documentation");
  const escalation = await control.requestOwnerDecision({
    runId: run.id,
    scopeId: "release-approval",
    question: "Should the release proceed?",
    blocking: true,
    idempotencyKey: "terminal-decision-1",
  });

  assert.ok(escalation.callAttemptId);
  const started = control.getCallAttempt(escalation.callAttemptId);
  assert.ok(started.providerCallId);
  provider.complete(started.providerCallId, {
    providerCallId: started.providerCallId,
    status: "completed",
    answer: "Proceed.",
    structured: { decision: "proceed" },
  });

  const resolved = await control.reconcileEscalation(escalation.id);
  assert.equal(resolved.status, "resolved");
  assert.ok(resolved.decisionId);
  assert.equal(store.decisionByEscalationId.get(escalation.id), resolved.decisionId);
  assert.equal(store.decisions.size, 1);
  assert.equal(control.getDecision(escalation.id)?.answer, "Proceed.");

  // Simulate a stale worker that did not observe the already-committed terminal
  // entity statuses. The explicit terminal-effect claim must still prevent a
  // second owner decision from being created.
  store.callAttempts.set(started.id, { ...control.getCallAttempt(started.id), status: "queued" });
  store.escalations.set(escalation.id, { ...control.getEscalation(escalation.id), status: "calling", decisionId: undefined });

  control.ingestProviderWebhook({
    eventId: "decision-terminal-stale-delivery",
    providerCallId: started.providerCallId,
    outcome: {
      providerCallId: started.providerCallId,
      status: "completed",
      answer: "Proceed.",
      structured: { decision: "proceed" },
    },
  });

  const converged = control.getEscalation(escalation.id);
  assert.equal(converged.status, "resolved");
  assert.equal(converged.decisionId, resolved.decisionId);
  assert.equal(store.decisions.size, 1);
  assert.equal(store.decisionByEscalationId.get(escalation.id), resolved.decisionId);
  assert.equal(control.listAuditEvents(run.id).filter((event) => event.type === "owner_decision_recorded").length, 1);
});

test("callback terminal effects claim one instruction batch even with stale entity status", async () => {
  const store = new InMemoryControlPlaneStore();
  const provider = new FakeCallProvider();
  const control = new ControlPlane(store, provider);
  const agent = control.registerAgent({ name: "terminal-callback-agent", platform: "test", ownerId: "owner-1" });
  const run = control.startRun(agent.id, "Continue unrelated work", "documentation");
  const callback = await control.requestOwnerCallback({
    runId: run.id,
    prompt: "Give me progress and accept steering",
    idempotencyKey: "terminal-callback-1",
  });

  assert.ok(callback.providerCallId);
  provider.complete(callback.providerCallId, {
    providerCallId: callback.providerCallId,
    status: "completed",
    instructions: [
      "Finish the release checklist at the next safe checkpoint.",
      "Do not interrupt the documentation branch.",
    ],
  });

  const completed = await control.reconcileCallback(callback.id);
  assert.equal(completed.status, "completed");
  assert.equal(store.callbackInstructionSetClaims.has(callback.id), true);
  assert.equal(store.instructions.size, 2);

  const originalInstructionIds = [...store.instructions.keys()].sort();

  // Simulate a stale worker observing this attempt as non-terminal. The batch
  // claim, not that stale status, is the correctness boundary for steering.
  store.callAttempts.set(callback.id, { ...completed, status: "queued" });
  control.ingestProviderWebhook({
    eventId: "callback-terminal-stale-delivery",
    providerCallId: callback.providerCallId,
    outcome: {
      providerCallId: callback.providerCallId,
      status: "completed",
      instructions: [
        "Finish the release checklist at the next safe checkpoint.",
        "Do not interrupt the documentation branch.",
      ],
    },
  });

  assert.equal(control.getCallAttempt(callback.id).status, "completed");
  assert.equal(store.instructions.size, 2);
  assert.deepEqual([...store.instructions.keys()].sort(), originalInstructionIds);
  assert.equal(store.callbackInstructionSetClaims.has(callback.id), true);
  assert.equal(control.listAuditEvents(run.id).filter((event) => event.type === "owner_instruction_queued").length, 2);

  const checkpoint = control.checkpoint(run.id);
  assert.equal(checkpoint.queuedInstructions.length, 2);
  assert.equal(checkpoint.run.currentScope, "documentation");
});
