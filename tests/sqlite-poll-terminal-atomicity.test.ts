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
  const directory = mkdtempSync(join(tmpdir(), "cya-poll-terminal-atomicity-"));
  const store = SqliteControlPlaneStore.open(join(directory, "state.db"));
  return run(store).finally(() => {
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

test("SQLite rolls back a polled callback completion when steering persistence fails", async () => {
  await withSqliteStore(async (store) => {
    const provider = new FakeCallProvider();
    const control = new ControlPlane(store, provider);
    const agent = control.registerAgent({ name: "poll-callback-atomicity", platform: "test", ownerId: "owner-1" });
    const run = control.startRun(agent.id, "Working", "documentation");
    const callback = await control.requestOwnerCallback({
      runId: run.id,
      prompt: "Tell the agent to prepare the release notes",
      idempotencyKey: "poll-callback-atomicity",
    });
    assert.ok(callback.providerCallId);

    provider.complete(callback.providerCallId, {
      providerCallId: callback.providerCallId,
      status: "completed",
      instructions: ["Prepare the release notes before the next checkpoint."],
    });

    const restoreAudit = failAuditTypeOnce(store, "owner_instruction_queued");
    await assert.rejects(
      control.reconcileCallback(callback.id),
      /injected audit failure for owner_instruction_queued/,
    );
    restoreAudit();

    assert.equal(control.getCallAttempt(callback.id).status, "queued");
    assert.equal(control.checkpoint(run.id).queuedInstructions.length, 0);
    assert.equal(control.listAuditEvents(run.id).filter((event) => event.type === "call_attempt_completed").length, 0);
    assert.equal(control.listAuditEvents(run.id).filter((event) => event.type === "owner_instruction_queued").length, 0);

    const completed = await control.reconcileCallback(callback.id);
    assert.equal(completed.status, "completed");
    const queued = control.checkpoint(run.id).queuedInstructions;
    assert.equal(queued.length, 1);
    assert.equal(queued[0]?.text, "Prepare the release notes before the next checkpoint.");
    assert.equal(control.listAuditEvents(run.id).filter((event) => event.type === "call_attempt_completed").length, 1);
    assert.equal(control.listAuditEvents(run.id).filter((event) => event.type === "owner_instruction_queued").length, 1);
  });
});

test("SQLite rolls back a polled decision completion when owner-decision audit persistence fails", async () => {
  await withSqliteStore(async (store) => {
    const provider = new FakeCallProvider();
    const control = new ControlPlane(store, provider);
    const agent = control.registerAgent({ name: "poll-decision-atomicity", platform: "test", ownerId: "owner-1" });
    const run = control.startRun(agent.id, "Working", "documentation");
    const escalation = await control.requestOwnerDecision({
      runId: run.id,
      scopeId: "release-approval",
      question: "Ship this release?",
      blocking: true,
      idempotencyKey: "poll-decision-atomicity",
    });
    assert.ok(escalation.callAttemptId);
    const call = control.getCallAttempt(escalation.callAttemptId);
    assert.ok(call.providerCallId);

    provider.complete(call.providerCallId, {
      providerCallId: call.providerCallId,
      status: "completed",
      answer: "Ship it",
      structured: { decision: "approve" },
    });

    const restoreAudit = failAuditTypeOnce(store, "owner_decision_recorded");
    await assert.rejects(
      control.reconcileEscalation(escalation.id),
      /injected audit failure for owner_decision_recorded/,
    );
    restoreAudit();

    assert.equal(control.getCallAttempt(call.id).status, "queued");
    assert.equal(control.getEscalation(escalation.id).status, "calling");
    assert.equal(control.getDecision(escalation.id), undefined);
    assert.deepEqual(control.checkpoint(run.id).unresolvedBlockingScopes, ["release-approval"]);
    assert.equal(control.listAuditEvents(run.id).filter((event) => event.type === "call_attempt_completed").length, 0);
    assert.equal(control.listAuditEvents(run.id).filter((event) => event.type === "owner_decision_recorded").length, 0);

    const resolved = await control.reconcileEscalation(escalation.id);
    assert.equal(resolved.status, "resolved");
    assert.equal(control.getCallAttempt(call.id).status, "completed");
    assert.equal(control.getDecision(escalation.id)?.answer, "Ship it");
    assert.deepEqual(control.checkpoint(run.id).unresolvedBlockingScopes, []);
    assert.equal(control.listAuditEvents(run.id).filter((event) => event.type === "call_attempt_completed").length, 1);
    assert.equal(control.listAuditEvents(run.id).filter((event) => event.type === "owner_decision_recorded").length, 1);
  });
});
