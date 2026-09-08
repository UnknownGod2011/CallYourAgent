import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FakeCallProvider } from "../src/call-provider.js";
import { ControlPlane, type Clock } from "../src/control-plane.js";
import { LifecycleManager } from "../src/lifecycle.js";
import { SqliteControlPlaneStore } from "../src/sqlite-store.js";

function withDatabase<T>(run: (filename: string) => Promise<T> | T): Promise<T> {
  const directory = mkdtempSync(join(tmpdir(), "cya-sqlite-"));
  const filename = join(directory, "state.db");
  return Promise.resolve(run(filename)).finally(() => rmSync(directory, { recursive: true, force: true }));
}

class MutableClock implements Clock {
  constructor(private current: Date) {}
  now(): Date { return new Date(this.current); }
  advance(ms: number): void { this.current = new Date(this.current.getTime() + ms); }
}

test("SQLite store survives process-style reopen with queued state intact", async () => {
  await withDatabase(async (filename) => {
    const provider = new FakeCallProvider();
    const firstStore = SqliteControlPlaneStore.open(filename);
    const first = new ControlPlane(firstStore, provider);

    const agent = first.registerAgent({ name: "Claude worker", platform: "claude-code", ownerId: "owner-1" });
    const run = first.startRun(agent.id, "Refactoring billing", "billing");
    const escalation = await first.requestOwnerDecision({
      runId: run.id,
      scopeId: "billing",
      question: "Ship the migration now?",
      blocking: true,
      idempotencyKey: "decision-1",
    });
    first.enqueueInstruction(run.id, "Keep the rollback script ready");
    firstStore.close();

    const reopened = SqliteControlPlaneStore.open(filename);
    assert.equal(reopened.agents.get(agent.id)?.name, "Claude worker");
    assert.equal(reopened.runs.get(run.id)?.summary, "Refactoring billing");
    assert.equal(reopened.escalations.get(escalation.id)?.callAttemptId, escalation.callAttemptId);
    assert.equal(reopened.instructions.size, 1);
    assert.equal(reopened.callAttempts.size, 1);
    reopened.close();
  });
});

test("in-progress provider observation survives SQLite reopen and still ages into stalled", async () => {
  await withDatabase(async (filename) => {
    const clock = new MutableClock(new Date("2026-09-08T00:00:00.000Z"));
    const provider = new FakeCallProvider();
    const firstStore = SqliteControlPlaneStore.open(filename);
    const first = new ControlPlane(firstStore, provider, clock);

    const agent = first.registerAgent({ name: "Durable callback worker", platform: "test", ownerId: "owner-1" });
    const run = first.startRun(agent.id, "Working independently", "independent-scope");
    const callback = await first.requestOwnerCallback({
      runId: run.id,
      idempotencyKey: "sqlite-provider-progress",
      prompt: "Give me a progress update",
    });

    assert.equal(callback.status, "queued");
    clock.advance(4_000);
    provider.progress(callback.providerCallId!);
    const progressed = await first.reconcileCallback(callback.id);
    assert.equal(progressed.status, "in_progress");
    assert.equal(progressed.updatedAt, "2026-09-08T00:00:04.000Z");

    const progressEventsBeforeRestart = first.listAuditEvents(run.id)
      .filter((event) => event.type === "call_attempt_progressed");
    assert.equal(progressEventsBeforeRestart.length, 1);
    const progressSequence = progressEventsBeforeRestart[0]!.sequence;
    firstStore.close();

    clock.advance(4_000);
    const reopenedStore = SqliteControlPlaneStore.open(filename);
    const reopened = new ControlPlane(reopenedStore, provider, clock);
    const lifecycle = new LifecycleManager(reopened, reopenedStore, clock, { maxInProgressCallAgeMs: 5_000 });

    const durableProgress = reopened.getCallAttempt(callback.id);
    assert.equal(durableProgress.status, "in_progress");
    assert.equal(durableProgress.updatedAt, "2026-09-08T00:00:04.000Z");
    const progressEventsAfterRestart = reopened.listAuditEvents(run.id)
      .filter((event) => event.type === "call_attempt_progressed");
    assert.equal(progressEventsAfterRestart.length, 1);
    assert.equal(progressEventsAfterRestart[0]!.sequence, progressSequence);

    const beforeTimeout = await lifecycle.sweep();
    assert.equal(beforeTimeout.staleCallsMarked, 0);
    assert.equal(reopened.getCallAttempt(callback.id).status, "in_progress");
    assert.equal(reopened.getCallAttempt(callback.id).updatedAt, "2026-09-08T00:00:04.000Z");
    assert.equal(
      reopened.listAuditEvents(run.id).filter((event) => event.type === "call_attempt_progressed").length,
      1,
    );

    clock.advance(1_001);
    const afterTimeout = await lifecycle.sweep();
    const stalled = reopened.getCallAttempt(callback.id);
    assert.equal(afterTimeout.staleCallsMarked, 1);
    assert.equal(stalled.status, "stalled");
    assert.equal(stalled.stalledAt, "2026-09-08T00:00:09.001Z");
    assert.equal(
      reopened.listAuditEvents(run.id).filter((event) => event.type === "call_attempt_progressed").length,
      1,
    );
    assert.equal(
      reopened.listAuditEvents(run.id).filter((event) => event.type === "call_attempt_stalled").length,
      1,
    );
    reopenedStore.close();
  });
});

test("transaction rollback restores in-memory mirrors and persisted rows", async () => {
  await withDatabase((filename) => {
    const store = SqliteControlPlaneStore.open(filename);

    assert.throws(() => {
      store.transaction(() => {
        store.processedWebhookEventIds.add("evt-rollback");
        store.callbackByIdempotencyKey.set("callback-rollback", "attempt-1");
        throw new Error("simulate domain failure");
      });
    }, /simulate domain failure/);

    assert.equal(store.processedWebhookEventIds.has("evt-rollback"), false);
    assert.equal(store.callbackByIdempotencyKey.has("callback-rollback"), false);
    store.close();

    const reopened = SqliteControlPlaneStore.open(filename);
    assert.equal(reopened.processedWebhookEventIds.has("evt-rollback"), false);
    assert.equal(reopened.callbackByIdempotencyKey.has("callback-rollback"), false);
    reopened.close();
  });
});

test("provider call ids are unique at the SQL layer", async () => {
  await withDatabase((filename) => {
    const store = SqliteControlPlaneStore.open(filename);
    const base = {
      purpose: "owner_callback" as const,
      correlationId: "run-1",
      provider: "fake",
      providerCallId: "provider-call-1",
      status: "queued" as const,
      idempotencyKey: "callback:key",
      request: { task: "callback", metadata: { runId: "run-1" } },
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    };

    store.callAttempts.set("attempt-1", { ...base, id: "attempt-1" });
    assert.throws(() => store.callAttempts.set("attempt-2", { ...base, id: "attempt-2", idempotencyKey: "callback:key-2" }));
    assert.equal(store.callAttempts.has("attempt-2"), false);
    store.close();
  });
});
