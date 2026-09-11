import assert from "node:assert/strict";
import test from "node:test";
import { FakeCallProvider } from "../src/call-provider.js";
import { ControlPlane } from "../src/control-plane.js";
import { InMemoryControlPlaneStore } from "../src/store.js";

function terminalConflicts(control: ControlPlane, runId: string) {
  return control.listAuditEvents(runId).filter((event) => event.type === "call_attempt_terminal_conflict");
}

test("equivalent decision evidence does not conflict when transport correlation or object key order differs", async () => {
  const store = new InMemoryControlPlaneStore();
  const provider = new FakeCallProvider();
  const control = new ControlPlane(store, provider);
  const agent = control.registerAgent({ name: "semantic-decision-agent", platform: "test", ownerId: "owner-1" });
  const run = control.startRun(agent.id, "Independent work continues", "documentation");
  const escalation = await control.requestOwnerDecision({
    runId: run.id,
    scopeId: "release",
    question: "Proceed?",
    blocking: true,
    idempotencyKey: "semantic-decision-1",
  });
  assert.ok(escalation.callAttemptId);
  const attempt = control.getCallAttempt(escalation.callAttemptId);
  assert.ok(attempt.providerCallId);

  provider.complete(attempt.providerCallId, {
    providerCallId: attempt.providerCallId,
    status: "completed",
    answer: "Proceed.",
    structured: { nested: { beta: 2, alpha: 1 }, choice: "proceed" },
  });
  await control.reconcileEscalation(escalation.id);

  control.ingestProviderWebhook({
    eventId: "evt-semantic-decision-replay",
    providerCallId: attempt.providerCallId,
    outcome: {
      status: "completed",
      answer: "Proceed.",
      structured: { choice: "proceed", nested: { alpha: 1, beta: 2 } },
    },
  });

  assert.equal(terminalConflicts(control, run.id).length, 0);
  assert.equal(store.decisions.size, 1);
});

test("ignored callback metadata and failed diagnostics do not create false terminal conflicts", async () => {
  const store = new InMemoryControlPlaneStore();
  const provider = new FakeCallProvider();
  const control = new ControlPlane(store, provider);
  const agent = control.registerAgent({ name: "semantic-callback-agent", platform: "test", ownerId: "owner-1" });
  const run = control.startRun(agent.id, "Working", "implementation");

  const callback = await control.requestOwnerCallback({
    runId: run.id,
    idempotencyKey: "semantic-callback-1",
  });
  assert.ok(callback.providerCallId);
  provider.complete(callback.providerCallId, {
    providerCallId: callback.providerCallId,
    status: "completed",
    instructions: ["Keep going."],
    structured: { transportShape: "poll" },
  });
  await control.reconcileCallback(callback.id);
  control.ingestProviderWebhook({
    eventId: "evt-semantic-callback-replay",
    providerCallId: callback.providerCallId,
    outcome: {
      status: "completed",
      instructions: ["Keep going."],
      structured: { transportShape: "webhook" },
    },
  });

  const escalation = await control.requestOwnerDecision({
    runId: run.id,
    scopeId: "failed-call",
    question: "This call will fail",
    blocking: false,
    idempotencyKey: "semantic-failed-1",
  });
  assert.ok(escalation.callAttemptId);
  const failedAttempt = control.getCallAttempt(escalation.callAttemptId);
  assert.ok(failedAttempt.providerCallId);
  provider.complete(failedAttempt.providerCallId, {
    providerCallId: failedAttempt.providerCallId,
    status: "failed",
    structured: { failureCode: "poll-code", failureMessage: "poll-safe-diagnostic" },
  });
  await control.reconcileEscalation(escalation.id);
  control.ingestProviderWebhook({
    eventId: "evt-semantic-failed-replay",
    providerCallId: failedAttempt.providerCallId,
    outcome: { status: "failed" },
  });

  assert.equal(terminalConflicts(control, run.id).length, 0);
  assert.equal(store.instructions.size, 1);
  assert.equal(control.getCallAttempt(failedAttempt.id).status, "failed");
});
