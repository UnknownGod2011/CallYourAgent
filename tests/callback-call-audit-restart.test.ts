import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FakeCallProvider } from "../src/call-provider.js";
import { ControlPlane } from "../src/control-plane.js";
import { SqliteControlPlaneStore } from "../src/sqlite-store.js";

test("restart-recovered owner callback preserves one causal call-attempt and steering chain", async () => {
  const directory = mkdtempSync(join(tmpdir(), "cya-callback-audit-restart-"));
  const filename = join(directory, "state.db");
  let firstStore: SqliteControlPlaneStore | undefined;
  let reopenedStore: SqliteControlPlaneStore | undefined;

  try {
    firstStore = SqliteControlPlaneStore.open(filename);
    const firstProvider = new FakeCallProvider({ autoCompleteAfterObservations: 1 });
    const first = new ControlPlane(firstStore, firstProvider);
    const agent = first.registerAgent({ name: "callback-audit-worker", platform: "test", ownerId: "owner-1" });
    const run = first.startRun(agent.id, "Continuing independent work", "documentation");

    const callback = await first.requestOwnerCallback({
      runId: run.id,
      idempotencyKey: "callback-audit-survives-restart",
      prompt: "Give me progress and capture one steering instruction.",
    });
    assert.ok(callback.providerCallId);
    assert.ok(callback.status === "queued" || callback.status === "in_progress");

    const beforeRestart = first.listAuditEvents(run.id).filter((event) => event.callAttemptId === callback.id);
    assert.equal(beforeRestart.filter((event) => event.type === "call_attempt_created").length, 1);
    assert.equal(beforeRestart.filter((event) => event.type === "call_attempt_started").length, 1);
    assert.equal(beforeRestart.filter((event) => event.type === "owner_callback_requested").length, 1);
    assert.equal(beforeRestart.filter((event) => event.type === "call_attempt_completed").length, 0);
    assert.equal(beforeRestart.filter((event) => event.type === "owner_instruction_queued").length, 0);

    firstStore.close();
    firstStore = undefined;

    // Simulate a real process restart: both durable store and fake provider process-local state are rebuilt.
    reopenedStore = SqliteControlPlaneStore.open(filename);
    const restartedProvider = new FakeCallProvider({ autoCompleteAfterObservations: 1 });
    const restarted = new ControlPlane(reopenedStore, restartedProvider);

    const completed = await restarted.reconcileCallback(callback.id);
    assert.equal(completed.status, "completed");
    assert.equal(completed.providerCallId, callback.providerCallId);

    // A repeated terminal reconciliation must be a no-op for durable call and steering state.
    const repeated = await restarted.reconcileCallback(callback.id);
    assert.equal(repeated.status, "completed");
    assert.equal(repeated.providerCallId, callback.providerCallId);

    const checkpoint = restarted.checkpoint(run.id);
    assert.equal(checkpoint.unresolvedBlockingScopes.length, 0);
    assert.equal(checkpoint.queuedInstructions.length, 1);
    const instruction = checkpoint.queuedInstructions[0]!;
    assert.equal(instruction.status, "queued");

    const events = restarted.listAuditEvents(run.id);
    const callbackEvents = events.filter((event) => event.callAttemptId === callback.id);
    const created = callbackEvents.filter((event) => event.type === "call_attempt_created");
    const started = callbackEvents.filter((event) => event.type === "call_attempt_started");
    const requested = callbackEvents.filter((event) => event.type === "owner_callback_requested");
    const completedEvents = callbackEvents.filter((event) => event.type === "call_attempt_completed");
    const queued = callbackEvents.filter((event) => event.type === "owner_instruction_queued");

    assert.equal(created.length, 1, "restart must not duplicate callback call creation");
    assert.equal(started.length, 1, "fake-provider rehydration must not masquerade as another provider start");
    assert.equal(requested.length, 1, "callback request must remain exactly-once across restart");
    assert.equal(completedEvents.length, 1, "terminal reconciliation retry must not duplicate completion");
    assert.equal(queued.length, 1, "terminal reconciliation retry must not duplicate queued steering");
    assert.equal(queued[0]?.instructionId, instruction.id);

    assert.ok(created[0]!.sequence < requested[0]!.sequence);
    assert.ok(requested[0]!.sequence < started[0]!.sequence);
    assert.ok(started[0]!.sequence < completedEvents[0]!.sequence);
    assert.ok(completedEvents[0]!.sequence < queued[0]!.sequence);

    assert.equal(
      callbackEvents.filter(
        (event) => event.type === "call_attempt_ambiguous" || event.type === "call_attempt_failed",
      ).length,
      0,
      "successful restart recovery must not fabricate ambiguous or failed call state",
    );

    const serialized = JSON.stringify(callbackEvents);
    assert.equal(serialized.includes("Give me progress and capture one steering instruction."), false);
    assert.equal(
      serialized.includes("Continue the current plan and report progress at the next safe checkpoint."),
      false,
    );
  } finally {
    if (firstStore) firstStore.close();
    if (reopenedStore) reopenedStore.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
