import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FakeCallProvider } from "../src/call-provider.js";
import { ControlPlane } from "../src/control-plane.js";
import type { AuditEvent } from "../src/domain.js";
import { SqliteControlPlaneStore } from "../src/sqlite-store.js";

async function withSqliteStore<T>(run: (store: SqliteControlPlaneStore) => Promise<T>): Promise<T> {
  const directory = mkdtempSync(join(tmpdir(), "cya-decision-create-atomicity-"));
  const store = SqliteControlPlaneStore.open(join(directory, "state.db"));
  try {
    return await run(store);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

function failEscalationCreatedAuditOnce(store: SqliteControlPlaneStore): () => void {
  const originalSet = store.auditEvents.set.bind(store.auditEvents);
  let failed = false;
  store.auditEvents.set = ((key: string, value: AuditEvent) => {
    if (!failed && value.type === "escalation_created") {
      failed = true;
      throw new Error("injected escalation creation audit failure");
    }
    originalSet(key, value);
    return store.auditEvents;
  }) as typeof store.auditEvents.set;
  return () => {
    store.auditEvents.set = originalSet as typeof store.auditEvents.set;
  };
}

function failIdempotencyBindingOnce(store: SqliteControlPlaneStore): () => void {
  const originalBind = store.bindEscalationIdempotencyKey.bind(store);
  let failed = false;
  store.bindEscalationIdempotencyKey = ((key: string, escalationId: string) => {
    if (!failed && key === "decision-create-mapping-failure") {
      failed = true;
      throw new Error("injected escalation idempotency binding failure");
    }
    return originalBind(key, escalationId);
  }) as typeof store.bindEscalationIdempotencyKey;
  return () => {
    store.bindEscalationIdempotencyKey = originalBind as typeof store.bindEscalationIdempotencyKey;
  };
}

function decisionRequest(runId: string, idempotencyKey: string) {
  return {
    runId,
    scopeId: "release-approval",
    question: "Ship the release?",
    blocking: true,
    priority: "high" as const,
    idempotencyKey,
  };
}

test("SQLite rolls back escalation and idempotency mapping when escalation_created audit fails", async () => {
  await withSqliteStore(async (store) => {
    const provider = new FakeCallProvider();
    const control = new ControlPlane(store, provider);
    const agent = control.registerAgent({ name: "decision-create-audit", platform: "test", ownerId: "owner-1" });
    const run = control.startRun(agent.id, "Working", "documentation");

    const restoreAudit = failEscalationCreatedAuditOnce(store);
    await assert.rejects(
      control.requestOwnerDecision(decisionRequest(run.id, "decision-create-audit-failure")),
      /injected escalation creation audit failure/,
    );
    restoreAudit();

    assert.equal(store.escalations.size, 0);
    assert.equal(store.escalationByIdempotencyKey.size, 0);
    assert.equal(store.callAttempts.size, 0);
    assert.equal(control.listAuditEvents(run.id).filter((event) => event.type === "escalation_created").length, 0);
    assert.deepEqual(control.checkpoint(run.id).unresolvedBlockingScopes, []);

    const created = await control.requestOwnerDecision(decisionRequest(run.id, "decision-create-audit-failure"));
    assert.equal(created.status, "calling");
    assert.ok(created.callAttemptId);
    assert.equal(store.escalations.size, 1);
    assert.equal(store.escalationByIdempotencyKey.get("decision-create-audit-failure"), created.id);
    assert.equal(store.callAttempts.size, 1);
    assert.equal(control.listAuditEvents(run.id).filter((event) => event.type === "escalation_created").length, 1);
    assert.deepEqual(control.checkpoint(run.id).unresolvedBlockingScopes, ["release-approval"]);

    const retry = await control.requestOwnerDecision(decisionRequest(run.id, "decision-create-audit-failure"));
    assert.equal(retry.id, created.id);
    assert.equal(store.escalations.size, 1);
    assert.equal(store.callAttempts.size, 1);
    assert.equal(control.listAuditEvents(run.id).filter((event) => event.type === "escalation_created").length, 1);
  });
});

test("SQLite rolls back escalation when atomic idempotency binding fails", async () => {
  await withSqliteStore(async (store) => {
    const provider = new FakeCallProvider();
    const control = new ControlPlane(store, provider);
    const agent = control.registerAgent({ name: "decision-create-mapping", platform: "test", ownerId: "owner-1" });
    const run = control.startRun(agent.id, "Working", "documentation");

    const restoreBinding = failIdempotencyBindingOnce(store);
    await assert.rejects(
      control.requestOwnerDecision(decisionRequest(run.id, "decision-create-mapping-failure")),
      /injected escalation idempotency binding failure/,
    );
    restoreBinding();

    assert.equal(store.escalations.size, 0);
    assert.equal(store.escalationByIdempotencyKey.size, 0);
    assert.equal(store.callAttempts.size, 0);
    assert.equal(control.listAuditEvents(run.id).filter((event) => event.type === "escalation_created").length, 0);
    assert.deepEqual(control.checkpoint(run.id).unresolvedBlockingScopes, []);

    const created = await control.requestOwnerDecision(decisionRequest(run.id, "decision-create-mapping-failure"));
    assert.equal(created.status, "calling");
    assert.ok(created.callAttemptId);
    assert.equal(store.escalations.size, 1);
    assert.equal(store.escalationByIdempotencyKey.get("decision-create-mapping-failure"), created.id);
    assert.equal(store.callAttempts.size, 1);
    assert.equal(control.listAuditEvents(run.id).filter((event) => event.type === "escalation_created").length, 1);
    assert.deepEqual(control.checkpoint(run.id).unresolvedBlockingScopes, ["release-approval"]);
  });
});
