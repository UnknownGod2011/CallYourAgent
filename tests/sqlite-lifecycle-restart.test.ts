import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FakeCallProvider, type StartCallInput, type StartCallResult } from "../src/call-provider.js";
import { ControlPlane, type Clock } from "../src/control-plane.js";
import { LifecycleManager } from "../src/lifecycle.js";
import { SqliteControlPlaneStore } from "../src/sqlite-store.js";

class FixedClock implements Clock {
  constructor(private readonly current: Date) {}
  now(): Date { return new Date(this.current); }
}

class AlwaysAmbiguousProvider extends FakeCallProvider {
  readonly seenKeys: string[] = [];
  override async start(input: StartCallInput): Promise<StartCallResult> {
    this.seenKeys.push(input.idempotencyKey);
    throw new Error("connection lost after send");
  }
}

function tempDatabase(prefix: string): { directory: string; databasePath: string } {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  return { directory, databasePath: join(directory, "state.db") };
}

test("SQLite restart preserves recovery scheduling state and its audit event together", async () => {
  const { directory, databasePath } = tempDatabase("cya-lifecycle-restart-schedule-");
  const clock = new FixedClock(new Date("2026-09-09T03:00:00.000Z"));
  const provider = new AlwaysAmbiguousProvider();
  let store = SqliteControlPlaneStore.open(databasePath);

  try {
    const control = new ControlPlane(store, provider, clock);
    const agent = control.registerAgent({ name: "restart-schedule", platform: "test", ownerId: "owner-1" });
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
      idempotencyKey: "restart-schedule-decision",
    });
    const attemptId = escalation.callAttemptId!;
    assert.equal(control.getCallAttempt(attemptId).status, "ambiguous");

    const sweep = await lifecycle.sweep();
    assert.equal(sweep.errors.length, 0);
    assert.equal(sweep.recoveriesAttempted, 1);
    assert.equal(control.getCallAttempt(attemptId).automaticRecoveryAttempts, 1);
    assert.equal(control.getCallAttempt(attemptId).nextAutomaticRecoveryAt, "2026-09-09T03:00:01.000Z");
    assert.equal(control.listAuditEvents(run.id).filter((event) => event.type === "call_recovery_scheduled").length, 1);

    store.close();
    store = SqliteControlPlaneStore.open(databasePath);
    const restartedControl = new ControlPlane(store, new AlwaysAmbiguousProvider(), clock);
    const restartedAttempt = restartedControl.getCallAttempt(attemptId);

    assert.equal(restartedAttempt.status, "ambiguous");
    assert.equal(restartedAttempt.automaticRecoveryAttempts, 1);
    assert.equal(restartedAttempt.nextAutomaticRecoveryAt, "2026-09-09T03:00:01.000Z");
    assert.equal(restartedAttempt.automaticRecoveryExhaustedAt, undefined);
    assert.equal(restartedControl.listAuditEvents(run.id).filter((event) => event.type === "call_recovery_scheduled").length, 1);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("SQLite restart preserves recovery exhaustion state and its audit event together", async () => {
  const { directory, databasePath } = tempDatabase("cya-lifecycle-restart-exhausted-");
  const clock = new FixedClock(new Date("2026-09-09T04:00:00.000Z"));
  let store = SqliteControlPlaneStore.open(databasePath);

  try {
    const control = new ControlPlane(store, new AlwaysAmbiguousProvider(), clock);
    const agent = control.registerAgent({ name: "restart-exhausted", platform: "test", ownerId: "owner-1" });
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
      idempotencyKey: "restart-exhausted-decision",
    });
    const attemptId = escalation.callAttemptId!;

    const sweep = await lifecycle.sweep();
    assert.equal(sweep.errors.length, 0);
    assert.equal(sweep.recoveriesExhausted, 1);
    assert.equal(control.getCallAttempt(attemptId).automaticRecoveryExhaustedAt, "2026-09-09T04:00:00.000Z");
    assert.equal(control.listAuditEvents(run.id).filter((event) => event.type === "call_recovery_exhausted").length, 1);

    store.close();
    store = SqliteControlPlaneStore.open(databasePath);
    const restartedControl = new ControlPlane(store, new AlwaysAmbiguousProvider(), clock);
    const restartedAttempt = restartedControl.getCallAttempt(attemptId);

    assert.equal(restartedAttempt.status, "ambiguous");
    assert.equal(restartedAttempt.nextAutomaticRecoveryAt, undefined);
    assert.equal(restartedAttempt.automaticRecoveryExhaustedAt, "2026-09-09T04:00:00.000Z");
    assert.equal(restartedControl.listAuditEvents(run.id).filter((event) => event.type === "call_recovery_exhausted").length, 1);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
