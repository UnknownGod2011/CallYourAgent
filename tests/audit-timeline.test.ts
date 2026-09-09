import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FakeCallProvider } from "../src/call-provider.js";
import { ControlPlane } from "../src/control-plane.js";
import { SqliteControlPlaneStore } from "../src/sqlite-store.js";
import { InMemoryControlPlaneStore } from "../src/store.js";

function setup() {
  const store = new InMemoryControlPlaneStore();
  const provider = new FakeCallProvider();
  const control = new ControlPlane(store, provider);
  const agent = control.registerAgent({ name: "demo-agent", platform: "claude-code", ownerId: "owner-1" });
  const run = control.startRun(agent.id, "Implementing checkout", "checkout");
  return { store, provider, control, agent, run };
}

test("audit timeline explains asynchronous decision and callback steering without storing transcript content", async () => {
  const { store, provider, control, run } = setup();
  control.heartbeat(run.id, { summary: "Checkout branch needs pricing approval", currentScope: "checkout" });

  const escalation = await control.requestOwnerDecision({
    runId: run.id,
    scopeId: "checkout",
    question: "Use the new enterprise price?",
    context: "Sensitive customer-specific context that should not be copied into audit metadata",
    blocking: true,
    priority: "high",
    idempotencyKey: "audit-decision-1",
  });
  const decisionAttempt = store.callAttempts.get(escalation.callAttemptId!)!;
  provider.complete(decisionAttempt.providerCallId!, {
    status: "completed",
    answer: "Yes, use the new enterprise price",
    structured: { approved: true },
  });
  await control.reconcileEscalation(escalation.id);

  const callback = await control.requestOwnerCallback({ runId: run.id, idempotencyKey: "audit-callback-1" });
  provider.complete(callback.providerCallId!, { status: "completed", instructions: ["Add a rollback note before deploy"] });
  await control.reconcileCallback(callback.id);
  control.checkpoint(run.id, true);

  const events = control.listAuditEvents(run.id);
  const types = events.map((event) => event.type);
  assert.ok(types.includes("run_started"));
  assert.ok(types.includes("run_status_reported"));
  assert.ok(types.includes("escalation_created"));
  assert.ok(types.includes("call_attempt_created"));
  assert.ok(types.includes("call_attempt_started"));
  assert.ok(types.includes("call_attempt_completed"));
  assert.ok(types.includes("owner_decision_recorded"));
  assert.ok(types.includes("owner_callback_requested"));
  assert.ok(types.includes("owner_instruction_queued"));
  assert.ok(types.includes("owner_instruction_consumed"));

  const callbackEvents = events.filter((event) => event.callAttemptId === callback.id);
  const callbackCreated = callbackEvents.filter((event) => event.type === "call_attempt_created");
  const callbackStarted = callbackEvents.filter((event) => event.type === "call_attempt_started");
  const callbackRequested = callbackEvents.filter((event) => event.type === "owner_callback_requested");
  const callbackCompleted = callbackEvents.filter((event) => event.type === "call_attempt_completed");
  const callbackInstructions = callbackEvents.filter((event) => event.type === "owner_instruction_queued");
  assert.equal(callbackCreated.length, 1);
  assert.equal(callbackStarted.length, 1);
  assert.equal(callbackRequested.length, 1);
  assert.equal(callbackCompleted.length, 1);
  assert.equal(callbackInstructions.length, 1);
  assert.ok(callbackCreated[0].sequence < callbackStarted[0].sequence);
  assert.ok(callbackStarted[0].sequence < callbackRequested[0].sequence);
  assert.ok(callbackRequested[0].sequence < callbackCompleted[0].sequence);
  assert.ok(callbackCompleted[0].sequence < callbackInstructions[0].sequence);
  assert.ok(callbackInstructions[0].instructionId);

  const serialized = JSON.stringify(events);
  assert.equal(serialized.includes("Sensitive customer-specific context"), false);
  assert.equal(serialized.includes("Yes, use the new enterprise price"), false);
  assert.equal(serialized.includes("Add a rollback note before deploy"), false);
});

test("SQLite audit timeline survives close and reopen", async () => {
  const directory = mkdtempSync(join(tmpdir(), "cya-audit-"));
  const filename = join(directory, "state.db");
  try {
    const provider = new FakeCallProvider();
    const firstStore = SqliteControlPlaneStore.open(filename);
    const first = new ControlPlane(firstStore, provider);
    const agent = first.registerAgent({ name: "worker", platform: "test", ownerId: "owner-1" });
    const run = first.startRun(agent.id, "Running durable workflow", "backend");
    first.heartbeat(run.id, { summary: "Still working", currentScope: "backend" });
    const before = first.listAuditEvents(run.id);
    assert.equal(before.length, 2);
    firstStore.close();

    const reopenedStore = SqliteControlPlaneStore.open(filename);
    const reopened = new ControlPlane(reopenedStore, provider);
    assert.deepEqual(reopened.listAuditEvents(run.id).map((event) => event.type), ["run_started", "run_status_reported"]);
    reopenedStore.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
