import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FakeCallProvider, type StartCallInput } from "../src/call-provider.js";
import { ControlPlane } from "../src/control-plane.js";
import { SqliteControlPlaneStore } from "../src/sqlite-store.js";

function withDatabase<T>(run: (filename: string) => Promise<T> | T): Promise<T> {
  const directory = mkdtempSync(join(tmpdir(), "cya-sqlite-reservation-"));
  const filename = join(directory, "state.db");
  return Promise.resolve(run(filename)).finally(() => rmSync(directory, { recursive: true, force: true }));
}

function createGate() {
  let signalStart!: () => void;
  let releaseStart!: () => void;
  const startEntered = new Promise<void>((resolve) => { signalStart = resolve; });
  const release = new Promise<void>((resolve) => { releaseStart = resolve; });
  return { signalStart, releaseStart, startEntered, release };
}

test("SQLite transaction reserves one callback identity before provider start completes", async () => {
  await withDatabase(async (filename) => {
    const gate = createGate();

    class GatedProvider extends FakeCallProvider {
      starts = 0;

      override async start(input: StartCallInput) {
        this.starts += 1;
        gate.signalStart();
        await gate.release;
        return super.start(input);
      }
    }

    const store = SqliteControlPlaneStore.open(filename);
    try {
      const provider = new GatedProvider();
      const control = new ControlPlane(store, provider);
      const agent = control.registerAgent({ name: "sqlite-callback-agent", platform: "test", ownerId: "owner-1" });
      const run = control.startRun(agent.id, "Validating durable callback reservation", "integration");
      const request = {
        runId: run.id,
        idempotencyKey: "sqlite-callback-concurrent-1",
        prompt: "Give me current progress",
      };

      const firstPromise = control.requestOwnerCallback(request);
      await gate.startEntered;

      const retry = await control.requestOwnerCallback(request);
      assert.equal(provider.starts, 1);
      assert.equal(store.callAttempts.size, 1);
      assert.equal(store.callbackByIdempotencyKey.get(request.idempotencyKey), retry.id);
      assert.equal(retry.providerCallId, undefined);

      const beforeReleaseEvents = control.listAuditEvents(run.id);
      assert.equal(beforeReleaseEvents.filter((event) => event.type === "call_attempt_created").length, 1);
      assert.equal(beforeReleaseEvents.filter((event) => event.type === "call_attempt_started").length, 0);

      gate.releaseStart();
      const first = await firstPromise;

      assert.equal(first.id, retry.id);
      assert.ok(first.providerCallId);
      assert.equal(provider.starts, 1);
      assert.equal(store.callAttempts.size, 1);

      const events = control.listAuditEvents(run.id);
      assert.equal(events.filter((event) => event.type === "call_attempt_created").length, 1);
      assert.equal(events.filter((event) => event.type === "call_attempt_started").length, 1);
      assert.equal(events.filter((event) => event.type === "owner_callback_requested").length, 1);
    } finally {
      store.close();
    }
  });
});

test("SQLite decision reconciliation cannot reserve a second call while provider start is in flight", async () => {
  await withDatabase(async (filename) => {
    const gate = createGate();

    class GatedProvider extends FakeCallProvider {
      starts = 0;

      override async start(input: StartCallInput) {
        this.starts += 1;
        gate.signalStart();
        await gate.release;
        return super.start(input);
      }
    }

    const store = SqliteControlPlaneStore.open(filename);
    try {
      const provider = new GatedProvider();
      const control = new ControlPlane(store, provider);
      const agent = control.registerAgent({ name: "sqlite-decision-agent", platform: "test", ownerId: "owner-1" });
      const run = control.startRun(agent.id, "Preparing a release", "documentation");

      const requestPromise = control.requestOwnerDecision({
        runId: run.id,
        scopeId: "release-approval",
        question: "Should this release go to production?",
        blocking: true,
        idempotencyKey: "sqlite-decision-concurrent-1",
      });
      await gate.startEntered;

      const reservedEscalation = [...store.escalations.values()][0]!;
      assert.equal(reservedEscalation.status, "calling");
      assert.ok(reservedEscalation.callAttemptId);
      assert.equal(store.callAttempts.size, 1);

      const reconciliationWhileStarting = await control.reconcileEscalation(reservedEscalation.id);
      assert.equal(reconciliationWhileStarting.id, reservedEscalation.id);
      assert.equal(reconciliationWhileStarting.callAttemptId, reservedEscalation.callAttemptId);
      assert.equal(provider.starts, 1);
      assert.equal(store.callAttempts.size, 1);
      assert.deepEqual(control.checkpoint(run.id).unresolvedBlockingScopes, ["release-approval"]);

      const beforeReleaseEvents = control.listAuditEvents(run.id);
      assert.equal(beforeReleaseEvents.filter((event) => event.type === "call_attempt_created").length, 1);
      assert.equal(beforeReleaseEvents.filter((event) => event.type === "call_attempt_started").length, 0);

      gate.releaseStart();
      const requested = await requestPromise;

      assert.equal(requested.id, reservedEscalation.id);
      assert.equal(requested.callAttemptId, reservedEscalation.callAttemptId);
      assert.equal(provider.starts, 1);
      assert.equal(store.callAttempts.size, 1);
      assert.ok(store.callAttempts.get(requested.callAttemptId!)?.providerCallId);

      const events = control.listAuditEvents(run.id);
      assert.equal(events.filter((event) => event.type === "escalation_created").length, 1);
      assert.equal(events.filter((event) => event.type === "call_attempt_created").length, 1);
      assert.equal(events.filter((event) => event.type === "call_attempt_started").length, 1);
    } finally {
      store.close();
    }
  });
});
