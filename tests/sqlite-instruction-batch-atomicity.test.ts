import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FakeCallProvider } from "../src/call-provider.js";
import { ControlPlane } from "../src/control-plane.js";
import type { AuditEvent } from "../src/domain.js";
import { SqliteControlPlaneStore } from "../src/sqlite-store.js";

function failSecondConsumptionAuditOnce(store: SqliteControlPlaneStore): () => void {
  const originalSet = store.auditEvents.set.bind(store.auditEvents);
  let consumedWrites = 0;
  let failed = false;
  store.auditEvents.set = ((key: string, value: AuditEvent) => {
    if (value.type === "owner_instruction_consumed") {
      consumedWrites += 1;
      if (!failed && consumedWrites === 2) {
        failed = true;
        throw new Error("injected second instruction consumption audit failure");
      }
    }
    originalSet(key, value);
    return store.auditEvents;
  }) as typeof store.auditEvents.set;
  return () => {
    store.auditEvents.set = originalSet as typeof store.auditEvents.set;
  };
}

test("SQLite rolls back an entire multi-instruction acknowledgement batch and retry consumes each instruction exactly once", () => {
  const directory = mkdtempSync(join(tmpdir(), "cya-instruction-batch-atomicity-"));
  const databasePath = join(directory, "state.db");
  let store = SqliteControlPlaneStore.open(databasePath);

  try {
    let control = new ControlPlane(store, new FakeCallProvider());
    const agent = control.registerAgent({ name: "batch-ack-agent", platform: "test", ownerId: "owner-1" });
    const run = control.startRun(agent.id, "Working", "implementation");
    const first = control.enqueueInstruction(run.id, "First owner instruction");
    const second = control.enqueueInstruction(run.id, "Second owner instruction");
    const third = control.enqueueInstruction(run.id, "Third owner instruction");
    const instructionIds = [first.id, second.id, third.id];

    const restore = failSecondConsumptionAuditOnce(store);
    assert.throws(
      () => control.acknowledgeInstructions(run.id, instructionIds),
      /injected second instruction consumption audit failure/,
    );
    restore();

    assert.deepEqual(
      instructionIds.map((id) => store.instructions.get(id)?.status),
      ["queued", "queued", "queued"],
      "a failed audit in the middle of the batch must roll back every instruction mutation",
    );
    assert.equal(
      control.listAuditEvents(run.id).filter((event) => event.type === "owner_instruction_consumed").length,
      0,
      "a failed batch must not leave partial consumption audit history",
    );
    assert.deepEqual(
      control.checkpoint(run.id).queuedInstructions.map((instruction) => instruction.id),
      instructionIds,
      "the full batch must remain available at the next safe checkpoint",
    );

    store.close();
    store = SqliteControlPlaneStore.open(databasePath);
    control = new ControlPlane(store, new FakeCallProvider());

    assert.deepEqual(
      control.checkpoint(run.id).queuedInstructions.map((instruction) => instruction.id),
      instructionIds,
      "rollback must remain durable across SQLite close/reopen",
    );

    const acknowledged = control.acknowledgeInstructions(run.id, instructionIds);
    assert.deepEqual(acknowledged.map((instruction) => instruction.id), instructionIds);
    assert.deepEqual(
      instructionIds.map((id) => store.instructions.get(id)?.status),
      ["consumed", "consumed", "consumed"],
    );

    for (const instructionId of instructionIds) {
      assert.equal(
        control.listAuditEvents(run.id).filter((event) =>
          event.type === "owner_instruction_consumed" && event.instructionId === instructionId,
        ).length,
        1,
        `instruction ${instructionId} must have exactly one durable consumption audit`,
      );
    }

    control.acknowledgeInstructions(run.id, [third.id, first.id, second.id]);
    assert.equal(
      control.listAuditEvents(run.id).filter((event) => event.type === "owner_instruction_consumed").length,
      3,
      "idempotent acknowledgement retry must not duplicate consumption audits",
    );
    assert.equal(control.checkpoint(run.id).queuedInstructions.length, 0);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
