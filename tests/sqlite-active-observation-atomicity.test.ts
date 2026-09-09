import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FakeCallProvider } from "../src/call-provider.js";
import { ControlPlane } from "../src/control-plane.js";
import type { AuditEvent } from "../src/domain.js";
import { SqliteControlPlaneStore } from "../src/sqlite-store.js";

function withSqliteStore<T>(run: (store: SqliteControlPlaneStore) => Promise<T>): Promise<T> {
  const directory = mkdtempSync(join(tmpdir(), "cya-active-observation-atomicity-"));
  const store = SqliteControlPlaneStore.open(join(directory, "state.db"));
  return run(store).finally(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
}

function failProgressAuditOnce(store: SqliteControlPlaneStore): () => void {
  const originalSet = store.auditEvents.set.bind(store.auditEvents);
  let failed = false;
  store.auditEvents.set = ((key: string, value: AuditEvent) => {
    if (!failed && value.type === "call_attempt_progressed") {
      failed = true;
      throw new Error("injected call progress audit failure");
    }
    originalSet(key, value);
    return store.auditEvents;
  }) as typeof store.auditEvents.set;
  return () => {
    store.auditEvents.set = originalSet as typeof store.auditEvents.set;
  };
}

function progressEvents(control: ControlPlane, runId: string, callAttemptId: string): AuditEvent[] {
  return control.listAuditEvents(runId).filter(
    (event) => event.type === "call_attempt_progressed" && event.callAttemptId === callAttemptId,
  );
}

test("SQLite rolls back callback queued-to-in-progress state when progress audit persistence fails", async () => {
  await withSqliteStore(async (store) => {
    const provider = new FakeCallProvider();
    const control = new ControlPlane(store, provider);
    const agent = control.registerAgent({ name: "callback-progress", platform: "test", ownerId: "owner-1" });
    const run = control.startRun(agent.id, "Working", "documentation");
    const callback = await control.requestOwnerCallback({
      runId: run.id,
      idempotencyKey: "callback-progress-atomicity",
    });

    assert.equal(callback.status, "queued");
    assert.ok(callback.providerCallId);
    provider.progress(callback.providerCallId);

    const restoreAudit = failProgressAuditOnce(store);
    await assert.rejects(
      control.reconcileCallback(callback.id),
      /injected call progress audit failure/,
    );
    restoreAudit();

    assert.equal(control.getCallAttempt(callback.id).status, "queued");
    assert.equal(progressEvents(control, run.id, callback.id).length, 0);

    const progressed = await control.reconcileCallback(callback.id);
    assert.equal(progressed.status, "in_progress");
    assert.equal(progressEvents(control, run.id, callback.id).length, 1);

    const repeated = await control.reconcileCallback(callback.id);
    assert.equal(repeated.status, "in_progress");
    assert.equal(progressEvents(control, run.id, callback.id).length, 1);
  });
});

test("SQLite rolls back decision-call queued-to-in-progress state when progress audit persistence fails", async () => {
  await withSqliteStore(async (store) => {
    const provider = new FakeCallProvider();
    const control = new ControlPlane(store, provider);
    const agent = control.registerAgent({ name: "decision-progress", platform: "test", ownerId: "owner-1" });
    const run = control.startRun(agent.id, "Working", "documentation");
    const escalation = await control.requestOwnerDecision({
      runId: run.id,
      scopeId: "release-approval",
      question: "Ship the release?",
      blocking: true,
      idempotencyKey: "decision-progress-atomicity",
    });
    const callAttemptId = escalation.callAttemptId!;
    const attempt = control.getCallAttempt(callAttemptId);

    assert.equal(attempt.status, "queued");
    assert.ok(attempt.providerCallId);
    provider.progress(attempt.providerCallId);

    const restoreAudit = failProgressAuditOnce(store);
    await assert.rejects(
      control.reconcileEscalation(escalation.id),
      /injected call progress audit failure/,
    );
    restoreAudit();

    assert.equal(control.getCallAttempt(callAttemptId).status, "queued");
    assert.equal(control.getEscalation(escalation.id).status, "calling");
    assert.deepEqual(control.checkpoint(run.id).unresolvedBlockingScopes, ["release-approval"]);
    assert.equal(control.getRun(run.id).currentScope, "documentation");
    assert.equal(progressEvents(control, run.id, callAttemptId).length, 0);

    const reconciled = await control.reconcileEscalation(escalation.id);
    assert.equal(reconciled.status, "calling");
    assert.equal(control.getCallAttempt(callAttemptId).status, "in_progress");
    assert.deepEqual(control.checkpoint(run.id).unresolvedBlockingScopes, ["release-approval"]);
    assert.equal(control.getRun(run.id).currentScope, "documentation");
    assert.equal(progressEvents(control, run.id, callAttemptId).length, 1);

    await control.reconcileEscalation(escalation.id);
    assert.equal(progressEvents(control, run.id, callAttemptId).length, 1);
  });
});
