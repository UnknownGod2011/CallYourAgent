import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FakeCallProvider, type StartCallInput } from "../src/call-provider.js";
import { ControlPlane, IDEMPOTENCY_CONFLICT_MESSAGE } from "../src/control-plane.js";
import { SqliteControlPlaneStore } from "../src/sqlite-store.js";

function withDatabase<T>(run: (filename: string) => Promise<T> | T): Promise<T> {
  const directory = mkdtempSync(join(tmpdir(), "cya-sqlite-idempotency-race-"));
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

test("SQLite callback idempotency binds the first payload while provider start is still in flight", async () => {
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
      const agent = control.registerAgent({ name: "callback-race-agent", platform: "test", ownerId: "owner-1" });
      const run = control.startRun(agent.id, "Working on release prep", "documentation");
      const idempotencyKey = "sqlite-callback-payload-race-1";

      const winningPromise = control.requestOwnerCallback({
        runId: run.id,
        idempotencyKey,
        prompt: "Give me the current release progress",
      });
      await gate.startEntered;

      await assert.rejects(
        control.requestOwnerCallback({
          runId: run.id,
          idempotencyKey,
          prompt: "Stop the release and switch to another task",
        }),
        (error: unknown) => error instanceof Error && error.message === IDEMPOTENCY_CONFLICT_MESSAGE,
      );

      assert.equal(provider.starts, 1);
      assert.equal(store.callAttempts.size, 1);
      const durableAttemptId = store.callbackByIdempotencyKey.get(idempotencyKey);
      assert.ok(durableAttemptId);
      const reservedAttempt = store.callAttempts.get(durableAttemptId);
      assert.ok(reservedAttempt);
      assert.match(reservedAttempt.request.task, /Give me the current release progress/);
      assert.doesNotMatch(reservedAttempt.request.task, /Stop the release/);

      gate.releaseStart();
      const winner = await winningPromise;
      assert.equal(winner.id, durableAttemptId);
      assert.ok(winner.providerCallId);
      assert.equal(provider.starts, 1);

      const events = control.listAuditEvents(run.id);
      assert.equal(events.filter((event) => event.type === "owner_callback_requested").length, 1);
      assert.equal(events.filter((event) => event.type === "call_attempt_created").length, 1);
      assert.equal(events.filter((event) => event.type === "call_attempt_started").length, 1);
    } finally {
      gate.releaseStart();
      store.close();
    }
  });
});

test("SQLite decision idempotency binds the first logical request while its call starts", async () => {
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
      const agent = control.registerAgent({ name: "decision-race-agent", platform: "test", ownerId: "owner-1" });
      const run = control.startRun(agent.id, "Preparing production release", "documentation");
      const idempotencyKey = "sqlite-decision-payload-race-1";

      const winningPromise = control.requestOwnerDecision({
        runId: run.id,
        scopeId: "production-release",
        question: "Should we deploy the current release?",
        context: "All checks are green",
        blocking: true,
        priority: "high",
        idempotencyKey,
      });
      await gate.startEntered;

      await assert.rejects(
        control.requestOwnerDecision({
          runId: run.id,
          scopeId: "database-migration",
          question: "Should we run the destructive migration instead?",
          context: "Different operation",
          blocking: false,
          priority: "normal",
          idempotencyKey,
        }),
        (error: unknown) => error instanceof Error && error.message === IDEMPOTENCY_CONFLICT_MESSAGE,
      );

      assert.equal(provider.starts, 1);
      assert.equal(store.escalations.size, 1);
      assert.equal(store.callAttempts.size, 1);
      const durableEscalationId = store.escalationByIdempotencyKey.get(idempotencyKey);
      assert.ok(durableEscalationId);
      const escalation = store.escalations.get(durableEscalationId);
      assert.ok(escalation);
      assert.equal(escalation.scopeId, "production-release");
      assert.equal(escalation.question, "Should we deploy the current release?");
      assert.equal(escalation.blocking, true);
      assert.deepEqual(control.checkpoint(run.id).unresolvedBlockingScopes, ["production-release"]);

      gate.releaseStart();
      const winner = await winningPromise;
      assert.equal(winner.id, durableEscalationId);
      assert.ok(winner.callAttemptId);
      assert.equal(provider.starts, 1);

      const events = control.listAuditEvents(run.id);
      assert.equal(events.filter((event) => event.type === "escalation_created").length, 1);
      assert.equal(events.filter((event) => event.type === "call_attempt_created").length, 1);
      assert.equal(events.filter((event) => event.type === "call_attempt_started").length, 1);
    } finally {
      gate.releaseStart();
      store.close();
    }
  });
});
