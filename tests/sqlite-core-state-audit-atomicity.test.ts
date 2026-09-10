import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FakeCallProvider } from "../src/call-provider.js";
import { ControlPlane } from "../src/control-plane.js";
import type { AuditEvent } from "../src/domain.js";
import { SqliteControlPlaneStore } from "../src/sqlite-store.js";

async function withSqliteStore<T>(run: (store: SqliteControlPlaneStore) => Promise<T> | T): Promise<T> {
  const directory = mkdtempSync(join(tmpdir(), "cya-core-state-audit-atomicity-"));
  const store = SqliteControlPlaneStore.open(join(directory, "state.db"));
  try {
    return await run(store);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

function failAuditOnce(store: SqliteControlPlaneStore, type: AuditEvent["type"]): () => void {
  const originalSet = store.auditEvents.set.bind(store.auditEvents);
  let failed = false;
  store.auditEvents.set = ((key: string, value: AuditEvent) => {
    if (!failed && value.type === type) {
      failed = true;
      throw new Error(`injected ${type} audit failure`);
    }
    originalSet(key, value);
    return store.auditEvents;
  }) as typeof store.auditEvents.set;
  return () => {
    store.auditEvents.set = originalSet as typeof store.auditEvents.set;
  };
}

test("SQLite rolls back agent registration when agent_registered audit persistence fails", async () => {
  await withSqliteStore((store) => {
    const control = new ControlPlane(store, new FakeCallProvider());
    const restore = failAuditOnce(store, "agent_registered");

    assert.throws(
      () => control.registerAgent({ name: "atomic-agent", platform: "test", ownerId: "owner-1" }),
      /injected agent_registered audit failure/,
    );
    restore();

    assert.equal(store.agents.size, 0);
    assert.equal([...store.auditEvents.values()].filter((event) => event.type === "agent_registered").length, 0);

    const agent = control.registerAgent({ name: "atomic-agent", platform: "test", ownerId: "owner-1" });
    assert.equal(store.agents.get(agent.id)?.id, agent.id);
    assert.equal([...store.auditEvents.values()].filter((event) => event.type === "agent_registered").length, 1);
  });
});

test("SQLite rolls back run creation when run_started audit persistence fails", async () => {
  await withSqliteStore((store) => {
    const control = new ControlPlane(store, new FakeCallProvider());
    const agent = control.registerAgent({ name: "atomic-run", platform: "test", ownerId: "owner-1" });
    const restore = failAuditOnce(store, "run_started");

    assert.throws(
      () => control.startRun(agent.id, "Starting release", "release"),
      /injected run_started audit failure/,
    );
    restore();

    assert.equal(store.runs.size, 0);
    assert.equal([...store.auditEvents.values()].filter((event) => event.type === "run_started").length, 0);

    const run = control.startRun(agent.id, "Starting release", "release");
    assert.equal(store.runs.get(run.id)?.id, run.id);
    assert.equal(control.listAuditEvents(run.id).filter((event) => event.type === "run_started").length, 1);
  });
});

test("SQLite rolls back heartbeat state when run_status_reported audit persistence fails", async () => {
  await withSqliteStore((store) => {
    const control = new ControlPlane(store, new FakeCallProvider());
    const agent = control.registerAgent({ name: "atomic-heartbeat", platform: "test", ownerId: "owner-1" });
    const run = control.startRun(agent.id, "Initial work", "documentation");
    const before = control.getRun(run.id);
    const restore = failAuditOnce(store, "run_status_reported");

    assert.throws(
      () => control.heartbeat(run.id, { summary: "Deploying", currentScope: "production-deploy" }),
      /injected run_status_reported audit failure/,
    );
    restore();

    assert.deepEqual(control.getRun(run.id), before);
    assert.equal(control.listAuditEvents(run.id).filter((event) => event.type === "run_status_reported").length, 0);

    const updated = control.heartbeat(run.id, { summary: "Deploying", currentScope: "production-deploy" });
    assert.equal(updated.summary, "Deploying");
    assert.equal(updated.currentScope, "production-deploy");
    assert.equal(control.listAuditEvents(run.id).filter((event) => event.type === "run_status_reported").length, 1);
  });
});

test("SQLite rolls back queued steering when owner_instruction_queued audit persistence fails", async () => {
  await withSqliteStore((store) => {
    const control = new ControlPlane(store, new FakeCallProvider());
    const agent = control.registerAgent({ name: "atomic-instruction", platform: "test", ownerId: "owner-1" });
    const run = control.startRun(agent.id, "Working", "documentation");
    const restore = failAuditOnce(store, "owner_instruction_queued");

    assert.throws(
      () => control.enqueueInstruction(run.id, "Prioritize the release checklist"),
      /injected owner_instruction_queued audit failure/,
    );
    restore();

    assert.equal(store.instructions.size, 0);
    assert.equal(control.checkpoint(run.id).queuedInstructions.length, 0);
    assert.equal(control.listAuditEvents(run.id).filter((event) => event.type === "owner_instruction_queued").length, 0);

    const instruction = control.enqueueInstruction(run.id, "Prioritize the release checklist");
    assert.equal(store.instructions.get(instruction.id)?.status, "queued");
    assert.deepEqual(control.checkpoint(run.id).queuedInstructions.map((item) => item.id), [instruction.id]);
    assert.equal(control.listAuditEvents(run.id).filter((event) => event.type === "owner_instruction_queued").length, 1);
  });
});
