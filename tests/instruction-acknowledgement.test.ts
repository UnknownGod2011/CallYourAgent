import assert from "node:assert/strict";
import test from "node:test";
import { FakeCallProvider } from "../src/call-provider.js";
import { ControlPlane } from "../src/control-plane.js";
import { InMemoryControlPlaneStore } from "../src/store.js";

function setup() {
  const store = new InMemoryControlPlaneStore();
  const control = new ControlPlane(store, new FakeCallProvider());
  const agent = control.registerAgent({ name: "ack-agent", platform: "test", ownerId: "owner-1" });
  const run = control.startRun(agent.id, "Working", "scope-a");
  return { store, control, run };
}

test("explicit acknowledgement consumes only exact instruction ids", () => {
  const { store, control, run } = setup();
  const first = control.enqueueInstruction(run.id, "First instruction");
  const checkpoint = control.checkpoint(run.id);
  assert.deepEqual(checkpoint.queuedInstructions.map((item) => item.id), [first.id]);

  const later = control.enqueueInstruction(run.id, "Arrived after checkpoint");
  const acknowledged = control.acknowledgeInstructions(run.id, checkpoint.queuedInstructions.map((item) => item.id));

  assert.equal(acknowledged.length, 1);
  assert.equal(acknowledged[0]?.id, first.id);
  assert.equal(store.instructions.get(first.id)?.status, "consumed");
  assert.equal(store.instructions.get(later.id)?.status, "queued");
  assert.deepEqual(control.checkpoint(run.id).queuedInstructions.map((item) => item.id), [later.id]);
});

test("instruction acknowledgement is idempotent and does not duplicate audit events", () => {
  const { control, run } = setup();
  const instruction = control.enqueueInstruction(run.id, "Apply owner steering");

  control.acknowledgeInstructions(run.id, [instruction.id, instruction.id]);
  control.acknowledgeInstructions(run.id, [instruction.id]);

  const consumedEvents = control.listAuditEvents(run.id).filter((event) =>
    event.type === "owner_instruction_consumed" && event.instructionId === instruction.id,
  );
  assert.equal(consumedEvents.length, 1);
});

test("instruction acknowledgement rejects cross-run ids atomically", () => {
  const { store, control, run } = setup();
  const first = control.enqueueInstruction(run.id, "Run one instruction");
  const secondAgent = control.registerAgent({ name: "other", platform: "test", ownerId: "owner-1" });
  const secondRun = control.startRun(secondAgent.id, "Other run");
  const foreign = control.enqueueInstruction(secondRun.id, "Other run instruction");

  assert.throws(() => control.acknowledgeInstructions(run.id, [first.id, foreign.id]), /does not belong to run/);
  assert.equal(store.instructions.get(first.id)?.status, "queued");
  assert.equal(store.instructions.get(foreign.id)?.status, "queued");
});
