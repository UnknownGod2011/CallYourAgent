import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FakeCallProvider, type StartCallInput, type StartCallResult } from "../src/call-provider.js";
import { ControlPlane, type Clock } from "../src/control-plane.js";
import type { AuditEvent } from "../src/domain.js";
import { LifecycleManager } from "../src/lifecycle.js";
import { SqliteControlPlaneStore } from "../src/sqlite-store.js";

class MutableClock implements Clock {
  constructor(private current: Date) {}
  now(): Date { return new Date(this.current); }
  advance(ms: number): void { this.current = new Date(this.current.getTime() + ms); }
}

function withSqliteStore<T>(run: (store: SqliteControlPlaneStore, directory: string) => Promise<T>): Promise<T> {
  const directory = mkdtempSync(join(tmpdir(), "cya-lifecycle-atomicity-"));
  const store = SqliteControlPlaneStore.open(join(directory, "state.db"));
  return run(store, directory).finally(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
}

function failAuditTypeOnce(store: SqliteControlPlaneStore, type: AuditEvent["type"]): () => void {
  const originalSet = store.auditEvents.set.bind(store.auditEvents);
  let failed = false;
  store.auditEvents.set = ((key: string, value: AuditEvent) => {
    if (!failed && value.type === type) {
      failed = true;
      throw new Error(`injected audit failure for ${type}`);
    }
    originalSet(key, value);
    return store.auditEvents;
  }) as typeof store.auditEvents.set;
  return () => {
    store.auditEvents.set = originalSet as typeof store.auditEvents.set;
  };
}

test("SQLite rolls back stalled call state when its lifecycle audit write fails", async () => {
  await withSqliteStore(async (store) => {
    const clock = new MutableClock(new Date("2026-09-09T00:00:00.000Z"));
    const provider = new FakeCallProvider();
    const control = new ControlPlane(store, provider, clock);
    const agent = control.registerAgent({ name: "atomic-stall", platform: "test", ownerId: "owner-1" });
    const run = control.startRun(agent.id, "Working", "documentation");
    const lifecycle = new LifecycleManager(control, store, clock, { maxInProgressCallAgeMs: 1_000 });

    const callback = await control.requestOwnerCallback({ runId: run.id, idempotencyKey: "atomic-stall-callback" });
    const attemptId = callback.id;
    assert.ok(control.getCallAttempt(attemptId).providerCallId);
    clock.advance(1_001);

    const restoreAudit = failAuditTypeOnce(store, "call_attempt_stalled");
    const failedSweep = await lifecycle.sweep();
    restoreAudit();

    assert.equal(failedSweep.staleCallsMarked, 0);
    assert.equal(failedSweep.errors.length, 1);
    assert.equal(control.getCallAttempt(attemptId).status, "queued");
    assert.equal(control.getCallAttempt(attemptId).stalledAt, undefined);
    assert.equal(control.listAuditEvents(run.id).filter((event) => event.type === "call_attempt_stalled").length, 0);

    const successfulSweep = await lifecycle.sweep();
    assert.equal(successfulSweep.errors.length, 0);
    assert.equal(successfulSweep.staleCallsMarked, 1);
    assert.equal(control.getCallAttempt(attemptId).status, "stalled");
    assert.equal(control.listAuditEvents(run.id).filter((event) => event.type === "call_attempt_stalled").length, 1);
  });
});

test("SQLite rolls back recovery scheduling metadata when its lifecycle audit write fails", async () => {
  class AlwaysAmbiguousProvider extends FakeCallProvider {
    readonly seenKeys: string[] = [];
    override async start(input: StartCallInput): Promise<StartCallResult> {
      this.seenKeys.push(input.idempotencyKey);
      throw new Error("connection lost after send");
    }
  }

  await withSqliteStore(async (store) => {
    const clock = new MutableClock(new Date("2026-09-09T01:00:00.000Z"));
    const provider = new AlwaysAmbiguousProvider();
    const control = new ControlPlane(store, provider, clock);
    const agent = control.registerAgent({ name: "atomic-schedule", platform: "test", ownerId: "owner-1" });
    const run = control.startRun(agent.id, "Working", "documentation");
    const lifecycle = new LifecycleManager(control, store, clock, {
      maxAutomaticRecoveryAttempts: 2,
      baseBackoffMs: 1_000,
      maxBackoffMs: 1_000,
    });

    const escalation = await control.requestOwnerDecision({
      runId: run.id,
      scopeId: "release-approval",
      question: "Ship?",
      blocking: true,
      idempotencyKey: "atomic-schedule-decision",
    });
    const attemptId = escalation.callAttemptId!;
    assert.equal(control.getCallAttempt(attemptId).status, "ambiguous");

    const restoreAudit = failAuditTypeOnce(store, "call_recovery_scheduled");
    const failedSweep = await lifecycle.sweep();
    restoreAudit();

    const rolledBack = control.getCallAttempt(attemptId);
    assert.equal(failedSweep.errors.length, 1);
    assert.equal(rolledBack.status, "ambiguous");
    assert.equal(rolledBack.automaticRecoveryAttempts, undefined);
    assert.equal(rolledBack.nextAutomaticRecoveryAt, undefined);
    assert.equal(control.listAuditEvents(run.id).filter((event) => event.type === "call_recovery_scheduled").length, 0);

    const successfulSweep = await lifecycle.sweep();
    const scheduled = control.getCallAttempt(attemptId);
    assert.equal(successfulSweep.errors.length, 0);
    assert.equal(scheduled.automaticRecoveryAttempts, 1);
    assert.equal(scheduled.nextAutomaticRecoveryAt, "2026-09-09T01:00:01.000Z");
    assert.equal(control.listAuditEvents(run.id).filter((event) => event.type === "call_recovery_scheduled").length, 1);
    assert.equal(provider.seenKeys.length, 3);
  });
});

test("SQLite rolls back recovery exhaustion metadata when its lifecycle audit write fails", async () => {
  class AmbiguousOnCreateProvider extends FakeCallProvider {
    override async start(_input: StartCallInput): Promise<StartCallResult> {
      throw new Error("connection lost after send");
    }
  }

  await withSqliteStore(async (store) => {
    const clock = new MutableClock(new Date("2026-09-09T02:00:00.000Z"));
    const provider = new AmbiguousOnCreateProvider();
    const control = new ControlPlane(store, provider, clock);
    const agent = control.registerAgent({ name: "atomic-exhaustion", platform: "test", ownerId: "owner-1" });
    const run = control.startRun(agent.id, "Working", "documentation");
    const lifecycle = new LifecycleManager(control, store, clock, {
      maxAutomaticRecoveryAttempts: 0,
      baseBackoffMs: 1_000,
      maxBackoffMs: 1_000,
    });

    const escalation = await control.requestOwnerDecision({
      runId: run.id,
      scopeId: "release-approval",
      question: "Ship?",
      blocking: true,
      idempotencyKey: "atomic-exhaustion-decision",
    });
    const attemptId = escalation.callAttemptId!;
    assert.equal(control.getCallAttempt(attemptId).status, "ambiguous");

    const restoreAudit = failAuditTypeOnce(store, "call_recovery_exhausted");
    const failedSweep = await lifecycle.sweep();
    restoreAudit();

    assert.equal(failedSweep.errors.length, 1);
    assert.equal(control.getCallAttempt(attemptId).automaticRecoveryExhaustedAt, undefined);
    assert.equal(control.listAuditEvents(run.id).filter((event) => event.type === "call_recovery_exhausted").length, 0);

    const successfulSweep = await lifecycle.sweep();
    assert.equal(successfulSweep.errors.length, 0);
    assert.equal(successfulSweep.recoveriesExhausted, 1);
    assert.equal(control.getCallAttempt(attemptId).automaticRecoveryExhaustedAt, "2026-09-09T02:00:00.000Z");
    assert.equal(control.listAuditEvents(run.id).filter((event) => event.type === "call_recovery_exhausted").length, 1);
  });
});
