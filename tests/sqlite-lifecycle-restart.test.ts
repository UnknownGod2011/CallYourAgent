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

class RecoverOnSecondStartProvider extends FakeCallProvider {
  startCalls = 0;
  override async start(input: StartCallInput): Promise<StartCallResult> {
    this.startCalls += 1;
    if (this.startCalls === 1) throw new Error("connection lost after send");
    return super.start(input);
  }
}

class RehydrateOnlyProvider extends FakeCallProvider {
  startCalls = 0;
  override async start(_input: StartCallInput): Promise<StartCallResult> {
    this.startCalls += 1;
    throw new Error("start must not be replayed after durable recovery");
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

test("restart after successful ambiguous recovery does not replay provider create when lifecycle bookkeeping was not written", async () => {
  const { directory, databasePath } = tempDatabase("cya-lifecycle-restart-recovered-");
  const clock = new FixedClock(new Date("2026-09-09T05:00:00.000Z"));
  const recoveringProvider = new RecoverOnSecondStartProvider();
  let store = SqliteControlPlaneStore.open(databasePath);

  try {
    const control = new ControlPlane(store, recoveringProvider, clock);
    const agent = control.registerAgent({ name: "restart-recovered", platform: "test", ownerId: "owner-1" });
    const run = control.startRun(agent.id, "Working", "documentation");
    const callback = await control.requestOwnerCallback({
      runId: run.id,
      idempotencyKey: "restart-recovered-callback",
    });
    assert.equal(callback.status, "ambiguous");

    const recovered = await control.recoverCallAttempt(callback.id);
    assert.equal(recoveringProvider.startCalls, 2);
    assert.equal(recovered.status, "queued");
    assert.ok(recovered.providerCallId);
    assert.equal(recovered.automaticRecoveryAttempts, undefined);
    const providerCallId = recovered.providerCallId;

    // Simulate process exit at the exact bookkeeping boundary: provider recovery
    // has been durably persisted, but LifecycleManager has not yet written its
    // automaticRecoveryAttempts metadata.
    store.close();
    store = SqliteControlPlaneStore.open(databasePath);
    const restartedProvider = new RehydrateOnlyProvider();
    const restartedControl = new ControlPlane(store, restartedProvider, clock);
    const lifecycle = new LifecycleManager(restartedControl, store, clock, {
      maxAutomaticRecoveryAttempts: 2,
      baseBackoffMs: 1_000,
      maxBackoffMs: 1_000,
      maxInProgressCallAgeMs: 60_000,
    });

    const beforeSweep = restartedControl.getCallAttempt(callback.id);
    assert.equal(beforeSweep.status, "queued");
    assert.equal(beforeSweep.providerCallId, providerCallId);
    assert.equal(beforeSweep.automaticRecoveryAttempts, undefined);

    const sweep = await lifecycle.sweep();
    assert.equal(sweep.errors.length, 0);
    assert.equal(sweep.recoveriesAttempted, 0);
    assert.equal(restartedProvider.startCalls, 0);
    assert.equal(restartedControl.getCallAttempt(callback.id).providerCallId, providerCallId);
    assert.equal(restartedControl.getCallAttempt(callback.id).status, "queued");
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
