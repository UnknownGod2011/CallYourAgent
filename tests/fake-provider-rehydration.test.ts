import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FakeCallProvider } from "../src/call-provider.js";
import { ControlPlane } from "../src/control-plane.js";
import { SqliteControlPlaneStore } from "../src/sqlite-store.js";

function withDatabase<T>(run: (filename: string) => Promise<T> | T): Promise<T> {
  const directory = mkdtempSync(join(tmpdir(), "cya-fake-rehydrate-"));
  const filename = join(directory, "state.db");
  return Promise.resolve(run(filename)).finally(() => rmSync(directory, { recursive: true, force: true }));
}

test("queued fake callback rehydrates from durable call state after process restart", async () => {
  await withDatabase(async (filename) => {
    const firstStore = SqliteControlPlaneStore.open(filename);
    const firstProvider = new FakeCallProvider({ autoCompleteAfterObservations: 1 });
    const first = new ControlPlane(firstStore, firstProvider);
    const agent = first.registerAgent({ name: "restart-worker", platform: "test", ownerId: "owner-1" });
    const run = first.startRun(agent.id, "Working on release", "release");
    const callback = await first.requestOwnerCallback({
      runId: run.id,
      idempotencyKey: "callback-survives-provider-restart",
      prompt: "Give me a status update",
    });

    assert.equal(callback.status, "queued");
    assert.ok(callback.providerCallId);
    assert.equal(firstStore.callAttempts.size, 1);
    assert.equal(first.listAuditEvents(run.id).filter((event) => event.type === "call_attempt_started").length, 1);
    firstStore.close();

    // A real process restart constructs a fresh fake provider with no in-memory calls.
    const reopenedStore = SqliteControlPlaneStore.open(filename);
    const restartedProvider = new FakeCallProvider({ autoCompleteAfterObservations: 1 });
    const restarted = new ControlPlane(reopenedStore, restartedProvider);

    const completed = await restarted.reconcileCallback(callback.id);
    assert.equal(completed.status, "completed");
    assert.equal(completed.providerCallId, callback.providerCallId);
    assert.equal(reopenedStore.callAttempts.size, 1);

    const checkpoint = restarted.checkpoint(run.id);
    assert.equal(checkpoint.queuedInstructions.length, 1);
    assert.equal(
      checkpoint.queuedInstructions[0]?.text,
      "Continue the current plan and report progress at the next safe checkpoint.",
    );
    assert.equal(
      restarted.listAuditEvents(run.id).filter((event) => event.type === "call_attempt_started").length,
      1,
      "rehydration must not masquerade as a second provider create",
    );
    reopenedStore.close();
  });
});

test("fake rehydration preserves persisted in-progress state rather than constructor defaults", async () => {
  await withDatabase(async (filename) => {
    const firstStore = SqliteControlPlaneStore.open(filename);
    const firstProvider = new FakeCallProvider({ initialStatus: "in_progress" });
    const first = new ControlPlane(firstStore, firstProvider);
    const agent = first.registerAgent({ name: "dialing-worker", platform: "test", ownerId: "owner-1" });
    const run = first.startRun(agent.id, "Waiting on owner", "approval");
    const callback = await first.requestOwnerCallback({
      runId: run.id,
      idempotencyKey: "callback-in-progress-restart",
    });

    assert.equal(callback.status, "in_progress");
    firstStore.close();

    const reopenedStore = SqliteControlPlaneStore.open(filename);
    const restartedProvider = new FakeCallProvider({ initialStatus: "queued" });
    const restarted = new ControlPlane(reopenedStore, restartedProvider);
    const observed = await restarted.reconcileCallback(callback.id);

    assert.equal(observed.status, "in_progress");
    assert.equal(observed.providerCallId, callback.providerCallId);
    assert.equal(
      restarted.listAuditEvents(run.id).filter((event) => event.type === "call_attempt_progressed").length,
      0,
      "restoring persisted provider state must not invent a queued-to-in-progress transition",
    );
    reopenedStore.close();
  });
});

test("fake provider rejects rehydration when durable identity does not match the idempotency key", async () => {
  const provider = new FakeCallProvider();
  await assert.rejects(
    async () => provider.rehydrate({
      providerCallId: "fake_call_000000000000000000000000",
      status: "queued",
      idempotencyKey: "different-logical-call",
      purpose: "owner_callback",
      task: "Call owner",
      metadata: {},
    }),
    /does not match persisted idempotency key/,
  );
});
