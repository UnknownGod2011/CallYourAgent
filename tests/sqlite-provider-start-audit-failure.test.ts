import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FakeCallProvider, type StartCallInput, type StartCallResult } from "../src/call-provider.js";
import { ControlPlane } from "../src/control-plane.js";
import type { AuditEvent } from "../src/domain.js";
import { SqliteControlPlaneStore } from "../src/sqlite-store.js";

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

class CountingProvider extends FakeCallProvider {
  starts = 0;

  override async start(input: StartCallInput): Promise<StartCallResult> {
    this.starts += 1;
    return super.start(input);
  }
}

class AmbiguousThenAcceptedProvider extends FakeCallProvider {
  starts = 0;

  override async start(input: StartCallInput): Promise<StartCallResult> {
    this.starts += 1;
    if (this.starts === 1) throw new Error("connection lost after send");
    return super.start(input);
  }
}

test("SQLite keeps an accepted provider identity when the initial started audit write fails", async () => {
  const directory = mkdtempSync(join(tmpdir(), "cya-provider-audit-initial-"));
  const dbPath = join(directory, "state.db");
  let store = SqliteControlPlaneStore.open(dbPath);

  try {
    const provider = new CountingProvider();
    const control = new ControlPlane(store, provider);
    const agent = control.registerAgent({ name: "audit-initial", platform: "test", ownerId: "owner-1" });
    const run = control.startRun(agent.id, "Working", "documentation");
    const idempotencyKey = "audit-initial-callback";

    const restoreAudit = failAuditTypeOnce(store, "call_attempt_started");
    await assert.rejects(
      control.requestOwnerCallback({ runId: run.id, idempotencyKey }),
      /injected audit failure for call_attempt_started/,
    );
    restoreAudit();

    const attemptId = store.callbackByIdempotencyKey.get(idempotencyKey);
    assert.ok(attemptId);
    const accepted = control.getCallAttempt(attemptId);
    assert.equal(accepted.status, "queued");
    assert.ok(accepted.providerCallId);
    assert.equal(accepted.lastError, undefined);
    assert.equal(provider.starts, 1);
    assert.equal(control.listAuditEvents(run.id).filter((event) => event.type === "call_attempt_ambiguous").length, 0);
    assert.equal(control.listAuditEvents(run.id).filter((event) => event.type === "call_attempt_started").length, 0);

    const retried = await control.requestOwnerCallback({ runId: run.id, idempotencyKey });
    assert.equal(retried.id, accepted.id);
    assert.equal(retried.providerCallId, accepted.providerCallId);
    assert.equal(provider.starts, 1);

    store.close();
    store = SqliteControlPlaneStore.open(dbPath);
    const restarted = new ControlPlane(store, new FakeCallProvider());
    const durable = restarted.getCallAttempt(accepted.id);
    assert.equal(durable.status, "queued");
    assert.equal(durable.providerCallId, accepted.providerCallId);
    assert.equal(durable.lastError, undefined);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("SQLite keeps a recovered provider identity when the recovery started audit write fails", async () => {
  const directory = mkdtempSync(join(tmpdir(), "cya-provider-audit-recovery-"));
  const dbPath = join(directory, "state.db");
  let store = SqliteControlPlaneStore.open(dbPath);

  try {
    const provider = new AmbiguousThenAcceptedProvider();
    const control = new ControlPlane(store, provider);
    const agent = control.registerAgent({ name: "audit-recovery", platform: "test", ownerId: "owner-1" });
    const run = control.startRun(agent.id, "Working", "documentation");
    const callback = await control.requestOwnerCallback({ runId: run.id, idempotencyKey: "audit-recovery-callback" });

    assert.equal(callback.status, "ambiguous");
    assert.equal(callback.providerCallId, undefined);
    assert.equal(provider.starts, 1);

    const restoreAudit = failAuditTypeOnce(store, "call_attempt_started");
    await assert.rejects(
      control.recoverCallAttempt(callback.id),
      /injected audit failure for call_attempt_started/,
    );
    restoreAudit();

    const recovered = control.getCallAttempt(callback.id);
    assert.equal(recovered.status, "queued");
    assert.ok(recovered.providerCallId);
    assert.equal(recovered.lastError, undefined);
    assert.equal(provider.starts, 2);
    assert.equal(control.listAuditEvents(run.id).filter((event) => event.type === "call_attempt_started").length, 0);

    const secondRecovery = await control.recoverCallAttempt(callback.id);
    assert.equal(secondRecovery.providerCallId, recovered.providerCallId);
    assert.equal(secondRecovery.status, "queued");
    assert.equal(provider.starts, 2);

    store.close();
    store = SqliteControlPlaneStore.open(dbPath);
    const restarted = new ControlPlane(store, new FakeCallProvider());
    const durable = restarted.getCallAttempt(callback.id);
    assert.equal(durable.status, "queued");
    assert.equal(durable.providerCallId, recovered.providerCallId);
    assert.equal(durable.lastError, undefined);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
