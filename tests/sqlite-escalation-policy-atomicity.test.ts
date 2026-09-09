import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CallPolicy } from "../src/call-policy.js";
import { FakeCallProvider } from "../src/call-provider.js";
import { ControlPlane, type Clock } from "../src/control-plane.js";
import type { AuditEvent } from "../src/domain.js";
import { SqliteControlPlaneStore } from "../src/sqlite-store.js";

class MutableClock implements Clock {
  constructor(private current: Date) {}
  now(): Date { return new Date(this.current); }
  set(value: string): void { this.current = new Date(value); }
}

async function withSqliteStore<T>(run: (store: SqliteControlPlaneStore) => Promise<T>): Promise<T> {
  const directory = mkdtempSync(join(tmpdir(), "cya-policy-atomicity-"));
  const store = SqliteControlPlaneStore.open(join(directory, "state.db"));
  try {
    return await run(store);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
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

test("SQLite rolls back escalation expiry when the expiry audit write fails", async () => {
  await withSqliteStore(async (store) => {
    const clock = new MutableClock(new Date("2026-09-10T01:00:00.000Z"));
    const control = new ControlPlane(
      store,
      new FakeCallProvider(),
      clock,
      new CallPolicy({ minimumDecisionPriority: "critical" }),
    );
    const agent = control.registerAgent({ name: "expiry-atomicity", platform: "test", ownerId: "owner-1" });
    const run = control.startRun(agent.id, "Working", "documentation");
    const escalation = await control.requestOwnerDecision({
      runId: run.id,
      scopeId: "release-approval",
      question: "Ship?",
      blocking: true,
      priority: "normal",
      idempotencyKey: "expiry-atomicity",
      expiresAt: "2026-09-10T01:01:00.000Z",
    });
    assert.equal(escalation.status, "pending");
    assert.equal(escalation.deferredReason, "below_priority_gate");

    clock.set("2026-09-10T01:02:00.000Z");
    const restoreAudit = failAuditTypeOnce(store, "escalation_expired");
    await assert.rejects(control.reconcileEscalation(escalation.id), /injected audit failure/);
    restoreAudit();

    const rolledBack = control.getEscalation(escalation.id);
    assert.equal(rolledBack.status, "pending");
    assert.equal(rolledBack.deferredReason, "below_priority_gate");
    assert.equal(control.listAuditEvents(run.id).filter((event) => event.type === "escalation_expired").length, 0);
    assert.deepEqual(control.checkpoint(run.id).unresolvedBlockingScopes, ["release-approval"]);

    const expired = await control.reconcileEscalation(escalation.id);
    assert.equal(expired.status, "expired");
    assert.equal(control.listAuditEvents(run.id).filter((event) => event.type === "escalation_expired").length, 1);
    assert.deepEqual(control.checkpoint(run.id).unresolvedBlockingScopes, []);
  });
});

test("SQLite rolls back policy deferral state when the deferral audit write fails", async () => {
  await withSqliteStore(async (store) => {
    const clock = new MutableClock(new Date("2026-09-10T02:00:00.000Z"));
    const control = new ControlPlane(
      store,
      new FakeCallProvider(),
      clock,
      new CallPolicy({ minimumDecisionPriority: "high" }),
    );
    const agent = control.registerAgent({ name: "deferral-atomicity", platform: "test", ownerId: "owner-1" });
    const run = control.startRun(agent.id, "Working", "documentation");

    const restoreAudit = failAuditTypeOnce(store, "call_policy_deferred");
    await assert.rejects(control.requestOwnerDecision({
      runId: run.id,
      scopeId: "release-approval",
      question: "Ship?",
      blocking: true,
      priority: "normal",
      idempotencyKey: "deferral-atomicity",
    }), /injected audit failure/);
    restoreAudit();

    const persisted = [...store.escalations.values()].find((item) => item.idempotencyKey === "deferral-atomicity");
    assert.ok(persisted);
    assert.equal(persisted.status, "pending");
    assert.equal(persisted.deferredReason, undefined);
    assert.equal(persisted.callAttemptId, undefined);
    assert.equal(control.listAuditEvents(run.id).filter((event) => event.type === "call_policy_deferred").length, 0);

    const deferred = await control.reconcileEscalation(persisted.id);
    assert.equal(deferred.status, "pending");
    assert.equal(deferred.deferredReason, "below_priority_gate");
    assert.equal(control.listAuditEvents(run.id).filter((event) => event.type === "call_policy_deferred").length, 1);
  });
});

test("SQLite rolls back policy release together with call reservation when reservation audit fails", async () => {
  await withSqliteStore(async (store) => {
    const clock = new MutableClock(new Date("2026-09-10T10:00:00.000Z"));
    const provider = new FakeCallProvider();
    const control = new ControlPlane(
      store,
      provider,
      clock,
      new CallPolicy({
        quietHours: { startHour: 9, endHour: 17, timeZone: "UTC", bypassPriority: "critical" },
      }),
    );
    const agent = control.registerAgent({ name: "release-atomicity", platform: "test", ownerId: "owner-1" });
    const run = control.startRun(agent.id, "Working", "documentation");
    const escalation = await control.requestOwnerDecision({
      runId: run.id,
      scopeId: "release-approval",
      question: "Ship?",
      blocking: true,
      priority: "normal",
      idempotencyKey: "release-atomicity",
    });
    assert.equal(escalation.deferredReason, "quiet_hours");
    assert.equal(store.callAttempts.size, 0);

    clock.set("2026-09-10T18:00:00.000Z");
    const restoreAudit = failAuditTypeOnce(store, "call_attempt_created");
    await assert.rejects(control.reconcileEscalation(escalation.id), /injected audit failure/);
    restoreAudit();

    const rolledBack = control.getEscalation(escalation.id);
    assert.equal(rolledBack.status, "pending");
    assert.equal(rolledBack.deferredReason, "quiet_hours");
    assert.equal(rolledBack.callAttemptId, undefined);
    assert.equal(store.callAttempts.size, 0);
    assert.equal(control.listAuditEvents(run.id).filter((event) => event.type === "call_policy_released").length, 0);
    assert.equal(control.listAuditEvents(run.id).filter((event) => event.type === "call_attempt_created").length, 0);
    assert.deepEqual(control.checkpoint(run.id).unresolvedBlockingScopes, ["release-approval"]);

    const calling = await control.reconcileEscalation(escalation.id);
    assert.equal(calling.status, "calling");
    assert.equal(calling.deferredReason, undefined);
    assert.ok(calling.callAttemptId);
    assert.equal(store.callAttempts.size, 1);
    assert.equal(control.listAuditEvents(run.id).filter((event) => event.type === "call_policy_released").length, 1);
    assert.equal(control.listAuditEvents(run.id).filter((event) => event.type === "call_attempt_created").length, 1);
    assert.deepEqual(control.checkpoint(run.id).unresolvedBlockingScopes, ["release-approval"]);
  });
});
